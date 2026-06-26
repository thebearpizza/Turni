import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { createDemoData } from '@/lib/demoData'
import { sendNewRegistrationAlert } from '@/lib/email'

const NAME_RE = /^[A-Za-zÀ-ÿ\s'-]{2,60}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 })

  const { full_name, email, password } = body as { full_name?: string; email?: string; password?: string }

  if (!full_name || !NAME_RE.test(full_name.trim())) {
    return NextResponse.json({ error: 'Nome non valido (solo lettere, 2-60 caratteri)' }, { status: 400 })
  }
  if (!email || !EMAIL_RE.test(email.trim().toLowerCase())) {
    return NextResponse.json({ error: 'Email non valida' }, { status: 400 })
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'Password troppo corta (minimo 8 caratteri)' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verifica che l'email non sia già registrata
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('username', email.trim().toLowerCase())
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'Email già registrata' }, { status: 409 })
  }

  // Crea l'auth user con email reale
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email:         email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name.trim(), role: 'manager' },
  })

  if (authErr || !authData.user) {
    if (authErr?.message?.includes('already been registered')) {
      return NextResponse.json({ error: 'Email già registrata' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Errore durante la registrazione' }, { status: 500 })
  }

  const userId = authData.user.id

  // Crea il profilo manager in stato pending
  const { error: profileErr } = await admin.from('profiles').insert({
    id:                        userId,
    full_name:                 full_name.trim(),
    username:                  email.trim().toLowerCase(),
    role:                      'manager',
    department:                null,
    restaurant_id:             null,
    account_status:            'pending',
    managed_restaurant_ids:    null,
    can_post_bulletin:         true,
    is_direttore:              false,
    consultant_restaurant_ids: [],
    can_view_hours:            true,
    weekly_rest_days:          1,
    primary_slot_ids:          [],
    secondary_departments:     [],
  })

  if (profileErr) {
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: 'Errore creazione profilo' }, { status: 500 })
  }

  // Crea i dati demo in background (non blocca la risposta)
  createDemoData(userId).catch(err => {
    console.error('[register] Errore creazione demo data:', err)
  })

  // Notifica via email + notifica in-app all'admin
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://turni.vercel.app'
  sendNewRegistrationAlert({
    fullName:   full_name.trim(),
    email:      email.trim().toLowerCase(),
    approveUrl: `${appUrl}/account-pendenti`,
  }).catch(() => {})

  // Notifica in-app: cerca tutti i manager platform-owner
  const { data: adminManagers } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'manager')
    .is('managed_restaurant_ids', null)
    .neq('id', userId)

  if (adminManagers?.length) {
    await admin.from('notifications').insert(
      adminManagers.map(m => ({
        user_id: m.id,
        title:   'Nuova richiesta di accesso',
        message: `${full_name.trim()} (${email.trim().toLowerCase()}) ha richiesto l'accesso.`,
        link:    '/account-pendenti',
      }))
    )
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
