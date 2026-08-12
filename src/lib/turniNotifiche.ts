'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import webpush from 'web-push'

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

// Notifica push + in-app un insieme di dipendenti per un evento sui loro
// turni (creazione/modifica/pubblicazione bozza IA). Best-effort: il turno
// è già salvato quando questa funzione viene chiamata, quindi un errore qui
// non deve mai propagarsi al chiamante.
export async function notificaTurniDipendenti(
  userIds: string[],
  title: string,
  message: string,
  link = '/home/miei-turni',
): Promise<void> {
  const ids = [...new Set(userIds)]
  if (!ids.length) return

  try {
    const admin = createAdminClient()

    const [, { data: subs }] = await Promise.all([
      admin.from('notifications').insert(ids.map(user_id => ({ user_id, title, message, link }))),
      admin.from('push_subscriptions').select('endpoint, p256dh, auth_key').in('user_id', ids),
    ])

    if (!subs?.length) return
    await Promise.allSettled(
      (subs as { endpoint: string; p256dh: string; auth_key: string }[]).map(async sub => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            JSON.stringify({ title, body: message, url: link }),
          )
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode
          if (status === 410 || status === 404) {
            await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          }
        }
      })
    )
  } catch (err) {
    console.error('[notificaTurniDipendenti] invio notifica fallito:', err)
  }
}
