import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'

const BUCKET = 'clock_in_proofs'

// POST /api/clock-in-fallback
// Multipart FormData: photo (File) + type ('in' | 'out')
// Creates an attendance row flagged for manager approval with the proof photo.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('restaurant_id')
    .eq('id', user.id)
    .single()

  if (!profile?.restaurant_id) {
    return NextResponse.json({ error: 'Nessun ristorante associato al profilo' }, { status: 400 })
  }

  const formData = await request.formData()
  const photo = formData.get('photo') as File | null
  const type  = formData.get('type') as string | null

  if (!photo) return NextResponse.json({ error: 'Foto mancante' }, { status: 400 })
  if (!['in', 'out'].includes(type ?? '')) {
    return NextResponse.json({ error: 'Tipo mancante (in/out)' }, { status: 400 })
  }
  if (photo.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'La foto non può superare 10 MB' }, { status: 413 })
  }

  // Upload photo — store under {userId}/{timestamp}.jpg
  const ext = photo.name.split('.').pop() ?? 'jpg'
  const storagePath = `${user.id}/${Date.now()}.${ext}`
  const arrayBuffer = await photo.arrayBuffer()

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: photo.type || 'image/jpeg',
      upsert: false,
    })

  if (uploadErr) {
    return NextResponse.json({ error: 'Errore upload foto: ' + uploadErr.message }, { status: 500 })
  }

  const nowUtc = new Date().toISOString()

  if (type === 'in') {
    // Guard: cannot open a second shift
    const { data: openShift } = await supabase
      .from('attendances')
      .select('id')
      .eq('user_id', user.id)
      .is('check_out', null)
      .maybeSingle()

    if (openShift) {
      // Clean up the photo we just uploaded
      await supabase.storage.from(BUCKET).remove([storagePath])
      return NextResponse.json({ error: 'Hai già un turno aperto' }, { status: 409 })
    }

    const { data: attendance, error } = await supabase
      .from('attendances')
      .insert({
        user_id:                user.id,
        restaurant_id:          profile.restaurant_id,
        check_in:               nowUtc,
        fallback_photo_path:    storagePath,
        needs_manager_approval: true,
      })
      .select()
      .single()

    if (error) {
      await supabase.storage.from(BUCKET).remove([storagePath])
      return NextResponse.json({ error: 'Errore registrazione' }, { status: 500 })
    }

    revalidatePath('/dashboard')
    revalidatePath('/presenze')
    revalidatePath('/approvazioni')
    return NextResponse.json({ attendance }, { status: 201 })
  } else {
    // type === 'out'
    const { data: openAttendance } = await supabase
      .from('attendances')
      .select('*')
      .eq('user_id', user.id)
      .is('check_out', null)
      .order('check_in', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!openAttendance) {
      await supabase.storage.from(BUCKET).remove([storagePath])
      return NextResponse.json({ error: 'Nessun turno aperto trovato' }, { status: 404 })
    }

    const { data: attendance, error } = await supabase
      .from('attendances')
      .update({
        check_out:              nowUtc,
        fallback_photo_path:    storagePath,
        needs_manager_approval: true,
      })
      .eq('id', openAttendance.id)
      .select()
      .single()

    if (error) {
      await supabase.storage.from(BUCKET).remove([storagePath])
      return NextResponse.json({ error: 'Errore registrazione uscita' }, { status: 500 })
    }

    return NextResponse.json({ attendance })
  }
}
