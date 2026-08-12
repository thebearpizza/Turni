import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const subscription = await request.json()
  const { endpoint, keys } = subscription

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Subscription non valida' }, { status: 400 })
  }

  // Un browser/device riusa lo stesso endpoint per ogni utente che vi fa
  // login: se un utente precedente non si è disiscritto correttamente al
  // logout, la sua riga per questo endpoint andrebbe rimossa qui, altrimenti
  // le notifiche continuerebbero ad arrivargli sullo stesso dispositivo.
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).neq('user_id', user.id)

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      user_id: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth_key: keys.auth,
    }, { onConflict: 'user_id,endpoint' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { endpoint } = await request.json()
  await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint)

  return NextResponse.json({ success: true })
}
