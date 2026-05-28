import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

// Fake domain used to satisfy Supabase Auth email requirement for username-based accounts.
// Must never be a real domain — .local is a non-routable mDNS TLD.
const FAKE_DOMAIN = 'struttura.local'

const USERNAME_RE = /^[a-z0-9._-]+$/

export function usernameToEmail(username: string): string {
  return `${username}@${FAKE_DOMAIN}`
}

interface Caller {
  id: string
  role: string
  restaurant_id: string | null
  is_direttore: boolean
}

// Authorises a user-management request. Managers have full access; a
// "Direttore" (capo_servizio with is_direttore) is allowed but confined to
// its own restaurant (enforced by the callers below). Returns null otherwise.
async function getUserAdminContext(): Promise<Caller | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore')
    .eq('id', user.id)
    .single()
  if (!profile) return null

  const isManager = profile.role === 'manager'
  const isDirettore = profile.role === 'capo_servizio' && profile.is_direttore === true
  if (!isManager && !isDirettore) return null

  return {
    id: user.id,
    role: profile.role,
    restaurant_id: profile.restaurant_id,
    is_direttore: profile.is_direttore === true,
  }
}

export async function POST(request: Request) {
  const caller = await getUserAdminContext()
  if (!caller) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const body = await request.json()
  const { username, password, full_name, role, can_post_bulletin, department } = body
  let { restaurant_id, is_direttore } = body

  if (!username || !password || !full_name || !role) {
    return NextResponse.json({ error: 'Campi obbligatori mancanti' }, { status: 400 })
  }
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: 'Username: solo lettere minuscole, numeri, punti, trattini e underscore' },
      { status: 400 }
    )
  }
  if (role !== 'manager' && !department) {
    return NextResponse.json({ error: 'Il reparto è obbligatorio' }, { status: 400 })
  }

  // Direttore (capo_servizio): cannot create managers, and is confined to its
  // own restaurant. Only a manager may grant the is_direttore flag.
  if (caller.role !== 'manager') {
    if (role === 'manager') {
      return NextResponse.json({ error: 'Non autorizzato a creare manager' }, { status: 403 })
    }
    restaurant_id = caller.restaurant_id
    is_direttore = false
  }
  // is_direttore only applies to capo_servizio
  const isDirettore = role === 'capo_servizio' ? is_direttore === true : false

  const email = usernameToEmail(username)
  const admin = createAdminClient()

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role },
  })

  if (authError) {
    // Make the "User already registered" error friendlier
    const msg = authError.message.includes('already registered')
      ? 'Username già in uso'
      : authError.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .upsert({
      id: authData.user.id,
      full_name,
      username,
      role,
      department: department || null,
      restaurant_id: restaurant_id || null,
      can_post_bulletin: can_post_bulletin ?? false,
      is_direttore: isDirettore,
    })
    .select('*, restaurant:restaurants(id, name)')
    .single()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  return NextResponse.json(profile, { status: 201 })
}

export async function PATCH(request: Request) {
  const caller = await getUserAdminContext()
  if (!caller) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const body = await request.json()
  const { id, full_name, role, can_post_bulletin, department } = body
  let { restaurant_id, is_direttore } = body

  if (!id || !full_name || !role) {
    return NextResponse.json({ error: 'Campi obbligatori mancanti' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Direttore: confined to its own restaurant, cannot manage managers, and
  // cannot change a user's restaurant. Only a manager may grant is_direttore.
  if (caller.role !== 'manager') {
    const { data: target } = await admin
      .from('profiles').select('role, restaurant_id').eq('id', id).single()
    if (!target || target.restaurant_id !== caller.restaurant_id || target.role === 'manager') {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
    if (role === 'manager') {
      return NextResponse.json({ error: 'Non autorizzato a promuovere a manager' }, { status: 403 })
    }
    restaurant_id = caller.restaurant_id
    is_direttore = false
  }
  const isDirettore = role === 'capo_servizio' ? is_direttore === true : false

  const { data: profile, error } = await admin
    .from('profiles')
    .update({
      full_name,
      role,
      department: department || null,
      restaurant_id: restaurant_id || null,
      can_post_bulletin: can_post_bulletin ?? false,
      is_direttore: isDirettore,
    })
    .eq('id', id)
    .select('*, restaurant:restaurants(id, name)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(profile)
}

export async function DELETE(request: Request) {
  const caller = await getUserAdminContext()
  if (!caller) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const admin = createAdminClient()

  // Direttore: can only delete users within its own restaurant, never managers.
  if (caller.role !== 'manager') {
    const { data: target } = await admin
      .from('profiles').select('role, restaurant_id').eq('id', id).single()
    if (!target || target.restaurant_id !== caller.restaurant_id || target.role === 'manager') {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
  }

  const { error } = await admin.auth.admin.deleteUser(id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
