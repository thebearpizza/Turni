import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function PUT(request: Request) {
  // ── Security Level 1: caller must be an authenticated manager ──────────
  const supabase = await createClient()
  const { data: { user: caller } } = await supabase.auth.getUser()

  if (!caller) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single()

  if (callerProfile?.role !== 'manager') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  // ── Parse body ──────────────────────────────────────────────────────────
  const { id: targetId, password } = await request.json()

  if (!targetId || !password) {
    return NextResponse.json({ error: 'Campi obbligatori mancanti' }, { status: 400 })
  }
  if (typeof password !== 'string' || password.length < 6) {
    return NextResponse.json({ error: 'La password deve essere di almeno 6 caratteri' }, { status: 400 })
  }

  // ── Security Level 2: target must NOT be a manager ─────────────────────
  // Using admin client so RLS doesn't interfere with this lookup.
  const admin = createAdminClient()

  const { data: targetProfile } = await admin
    .from('profiles')
    .select('role, full_name')
    .eq('id', targetId)
    .single()

  if (!targetProfile) {
    return NextResponse.json({ error: 'Utente non trovato' }, { status: 404 })
  }
  if (targetProfile.role === 'manager') {
    return NextResponse.json(
      { error: 'Non puoi modificare la password di un altro Manager' },
      { status: 403 }
    )
  }

  // ── Update password via Admin API (never exposed client-side) ──────────
  const { error } = await admin.auth.admin.updateUserById(targetId, { password })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
