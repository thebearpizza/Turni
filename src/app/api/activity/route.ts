import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/activity
// Updates last_active_at for the authenticated user.
// The client throttles this to at most once every 3–5 minutes.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { error } = await supabase
    .from('profiles')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
