import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

const BUCKET = 'clock_in_proofs'

// POST /api/presenze/fallback-approve
// Body: { attendanceId: string, action: 'approve' | 'reject' }
// Manager-only. On approve: clears the photo flag, deletes the file from storage.
// On reject: deletes the attendance row and the file from storage.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore')
    .eq('id', user.id)
    .single()

  const isManager   = callerProfile?.role === 'manager'
  const isDirettore = callerProfile?.role === 'capo_servizio' && callerProfile.is_direttore === true
  if (!isManager && !isDirettore) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { attendanceId, action } = await request.json()
  if (!attendanceId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Load the attendance to get the photo path and verify restaurant scope
  const { data: attendance } = await admin
    .from('attendances')
    .select('id, restaurant_id, fallback_photo_path, needs_manager_approval')
    .eq('id', attendanceId)
    .single()

  if (!attendance) {
    return NextResponse.json({ error: 'Timbratura non trovata' }, { status: 404 })
  }
  if (!attendance.needs_manager_approval) {
    return NextResponse.json({ error: 'Questa timbratura non richiede approvazione' }, { status: 400 })
  }

  // Direttore is scoped to their own restaurant
  if (isDirettore && attendance.restaurant_id !== callerProfile?.restaurant_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const photoPath = attendance.fallback_photo_path as string | null

  if (action === 'approve') {
    // Clear the approval flag and wipe the photo reference
    const { error } = await admin
      .from('attendances')
      .update({
        needs_manager_approval: false,
        fallback_photo_path:    null,
      })
      .eq('id', attendanceId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Delete the physical file from storage to free space
    if (photoPath) {
      await admin.storage.from(BUCKET).remove([photoPath])
    }

    return NextResponse.json({ success: true, action: 'approved' })
  } else {
    // reject — delete the whole attendance row first, then the file
    const { error } = await admin
      .from('attendances')
      .delete()
      .eq('id', attendanceId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (photoPath) {
      await admin.storage.from(BUCKET).remove([photoPath])
    }

    return NextResponse.json({ success: true, action: 'rejected' })
  }
}
