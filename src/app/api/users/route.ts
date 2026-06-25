import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

// Fake domain used to satisfy Supabase Auth email requirement for username-based accounts.
// Must never be a real domain — .local is a non-routable mDNS TLD.
const FAKE_DOMAIN = 'struttura.local'

// GET /api/users?role=consulente_lavoro
// Returns all profiles with the given role. Manager-only.
export async function GET(request: Request) {
  const caller = await getUserAdminContext()
  if (!caller || caller.role !== 'manager') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { searchParams } = new URL(request.url)
  const role = searchParams.get('role')
  if (!role) return NextResponse.json({ error: 'role mancante' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, username, last_active_at, consultant_restaurant_ids, can_view_hours')
    .eq('role', role)
    .order('full_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

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

  const body2 = body
  const consultant_restaurant_ids: string[] = body2.consultant_restaurant_ids ?? []
  const can_view_hours: boolean = body2.can_view_hours ?? false

  if (!username || !password || !full_name || !role) {
    return NextResponse.json({ error: 'Campi obbligatori mancanti' }, { status: 400 })
  }
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: 'Username: solo lettere minuscole, numeri, punti, trattini e underscore' },
      { status: 400 }
    )
  }
  const requiresDept = role !== 'manager' && role !== 'consulente_lavoro'
  if (requiresDept && !department) {
    return NextResponse.json({ error: 'Il reparto è obbligatorio' }, { status: 400 })
  }

  // Direttore (capo_servizio): cannot create managers or consulenti, confined to own restaurant.
  if (caller.role !== 'manager') {
    if (role === 'manager' || role === 'consulente_lavoro') {
      return NextResponse.json({ error: 'Non autorizzato a creare questo ruolo' }, { status: 403 })
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
      department: role === 'consulente_lavoro' ? null : (department || null),
      restaurant_id: restaurant_id || null,
      can_post_bulletin: can_post_bulletin ?? false,
      is_direttore: isDirettore,
      consultant_restaurant_ids: role === 'consulente_lavoro' ? consultant_restaurant_ids : [],
      can_view_hours: role === 'consulente_lavoro' ? can_view_hours : false,
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

  const patchBody = await request.json()
  const { id, full_name, role, can_post_bulletin, department } = patchBody
  let { restaurant_id, is_direttore } = patchBody
  const consultant_restaurant_ids: string[] = patchBody.consultant_restaurant_ids ?? []
  const can_view_hours: boolean = patchBody.can_view_hours ?? false

  // ── Campi AI scheduling ─────────────────────────────────────────────
  const weekly_rest_days: number               = patchBody.weekly_rest_days ?? 1
  const preferred_rest_day: number | null      = patchBody.preferred_rest_day ?? null
  const primary_slot_ids: string[]             = patchBody.primary_slot_ids ?? []
  const secondary_departments                  = patchBody.secondary_departments ?? []
  const weekly_hours_target: number | null     = patchBody.weekly_hours_target ?? null
  const can_substitute_capo_servizio: boolean  = patchBody.can_substitute_capo_servizio ?? false

  if (!id || !full_name || !role) {
    return NextResponse.json({ error: 'Campi obbligatori mancanti' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Direttore: confined to its own restaurant, cannot manage managers or consulenti.
  if (caller.role !== 'manager') {
    const { data: target } = await admin
      .from('profiles').select('role, restaurant_id').eq('id', id).single()
    if (!target || target.restaurant_id !== caller.restaurant_id || target.role === 'manager' || target.role === 'consulente_lavoro') {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
    if (role === 'manager' || role === 'consulente_lavoro') {
      return NextResponse.json({ error: 'Non autorizzato a promuovere a questo ruolo' }, { status: 403 })
    }
    restaurant_id = caller.restaurant_id
    is_direttore = false
  }
  const isDirettore = role === 'capo_servizio' ? is_direttore === true : false

  // secondary_departments è editabile solo dal manager (non dal direttore)
  const isCallerManager = caller.role === 'manager'

  const { data: profile, error } = await admin
    .from('profiles')
    .update({
      full_name,
      role,
      department: role === 'consulente_lavoro' ? null : (department || null),
      restaurant_id: restaurant_id || null,
      can_post_bulletin: can_post_bulletin ?? false,
      is_direttore: isDirettore,
      consultant_restaurant_ids: role === 'consulente_lavoro' ? consultant_restaurant_ids : [],
      can_view_hours: role === 'consulente_lavoro' ? can_view_hours : false,
      // AI scheduling
      weekly_rest_days,
      preferred_rest_day,
      primary_slot_ids,
      secondary_departments: isCallerManager ? secondary_departments : undefined,
      weekly_hours_target: weekly_hours_target || null,
      can_substitute_capo_servizio,
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
