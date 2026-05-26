import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import webpush from 'web-push'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'manager') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { bulletinId } = await request.json()
  if (!bulletinId) return NextResponse.json({ error: 'bulletinId mancante' }, { status: 400 })

  const admin = createAdminClient()

  const { data: bulletin } = await admin
    .from('bulletins')
    .select('title, body, target, target_roles, target_user_ids, restaurant_id')
    .eq('id', bulletinId)
    .single()

  if (!bulletin) return NextResponse.json({ error: 'Bulletin non trovato' }, { status: 404 })

  type SubRow = { id: string; endpoint: string; p256dh: string; auth_key: string }
  let subscriptions: SubRow[] = []

  if (bulletin.target === 'all') {
    const { data } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
    subscriptions = (data ?? []) as SubRow[]
  } else if (bulletin.target === 'users' && bulletin.target_user_ids?.length) {
    const { data } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .in('user_id', bulletin.target_user_ids)
    subscriptions = (data ?? []) as SubRow[]
  } else if (bulletin.target === 'role' && bulletin.target_roles?.length) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id')
      .in('role', bulletin.target_roles)
    if (profiles?.length) {
      const { data } = await admin
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth_key')
        .in('user_id', profiles.map((p: { id: string }) => p.id))
      subscriptions = (data ?? []) as SubRow[]
    }
  } else if (bulletin.target === 'restaurant' && bulletin.restaurant_id) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id')
      .eq('restaurant_id', bulletin.restaurant_id)
    if (profiles?.length) {
      const { data } = await admin
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth_key')
        .in('user_id', profiles.map((p: { id: string }) => p.id))
      subscriptions = (data ?? []) as SubRow[]
    }
  }

  if (!subscriptions.length) return NextResponse.json({ sent: 0 })

  webpush.setVapidDetails(
    process.env.VAPID_EMAIL!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )

  const payload = JSON.stringify({
    title: bulletin.title,
    body: bulletin.body,
    url: '/',
  })

  let sent = 0

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        )
        sent++
      } catch (err: unknown) {
        // Rimuovi solo subscription definitivamente scadute/non valide (410 Gone, 404 Not Found)
        const status = (err as { statusCode?: number }).statusCode
        if (status === 410 || status === 404) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id)
        }
      }
    })
  )

  return NextResponse.json({ sent })
}
