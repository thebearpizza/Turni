import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import webpush from 'web-push'

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { taskId, event } = await request.json() as { taskId: string; event: 'created' | 'updated' }
  if (!taskId || !event) return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 })

  const admin = createAdminClient()

  const { data: task } = await admin
    .from('ods_tasks')
    .select('title, department, restaurant_id, assigned_to')
    .eq('id', taskId)
    .single()

  if (!task) return NextResponse.json({ ok: true })

  // Determine target user IDs
  let targetIds: string[] = []

  if (task.assigned_to) {
    // Specific assignment → notify only that person
    targetIds = [task.assigned_to]
  } else {
    // Department task → notify all staff in that department + restaurant
    const { data: staff } = await admin
      .from('profiles')
      .select('id')
      .eq('restaurant_id', task.restaurant_id)
      .eq('department', task.department)
      .in('role', ['dipendente', 'capo_servizio'])

    targetIds = (staff ?? []).map(s => s.id)
  }

  if (!targetIds.length) return NextResponse.json({ ok: true })

  // Fetch push subscriptions
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key, user_id')
    .in('user_id', targetIds)

  if (!subs?.length) return NextResponse.json({ ok: true })

  const isCreated = event === 'created'
  const title = isCreated ? 'Nuovo ordine di servizio' : 'Ordine di servizio aggiornato'
  const body = task.assigned_to && isCreated
    ? `Hai una nuova mansione assegnata: "${task.title}"`
    : `Istruzione ${event === 'created' ? 'aggiunta' : 'aggiornata'} per il reparto ${task.department}: "${task.title}"`

  const payload = JSON.stringify({ title, body, url: '/ods' })

  await Promise.allSettled(
    subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload,
        )
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 410 || status === 404) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
      }
    })
  )

  return NextResponse.json({ ok: true })
}
