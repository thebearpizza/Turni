import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

async function checkManager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return profile?.role === 'manager' ? supabase : null
}

export async function POST(request: Request) {
  const supabase = await checkManager()
  if (!supabase) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { email, password, full_name, role, restaurant_id, can_post_bulletin } = await request.json()

  if (!email || !password || !full_name || !role) {
    return NextResponse.json({ error: 'Campi obbligatori mancanti' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role },
  })

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .upsert({
      id: authData.user.id,
      full_name,
      role,
      restaurant_id: restaurant_id || null,
      can_post_bulletin: can_post_bulletin ?? false,
    })
    .select('*, restaurant:restaurants(id, name)')
    .single()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  return NextResponse.json(profile, { status: 201 })
}

export async function PATCH(request: Request) {
  const supabase = await checkManager()
  if (!supabase) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { id, full_name, role, restaurant_id, can_post_bulletin } = await request.json()

  if (!id || !full_name || !role) {
    return NextResponse.json({ error: 'Campi obbligatori mancanti' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: profile, error } = await admin
    .from('profiles')
    .update({ full_name, role, restaurant_id: restaurant_id || null, can_post_bulletin: can_post_bulletin ?? false })
    .eq('id', id)
    .select('*, restaurant:restaurants(id, name)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(profile)
}

export async function DELETE(request: Request) {
  const supabase = await checkManager()
  if (!supabase) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.deleteUser(id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
