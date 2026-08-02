'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import webpush from 'web-push'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

const TZ = 'Europe/Rome'

interface ChiusuraNotificaRow {
  restaurant_id: string
  data: string
  totale_entrate: number
  entrate_contanti: number
  entrate_pos: number
  entrate_bonifico: number
  restaurant: { name: string; is_demo: boolean } | null
}

// Notifica push + in-app ai manager del ristorante quando una chiusura cassa
// viene confermata per la prima volta (bozza → confermata) — non per le
// correzioni successive di una chiusura già confermata, già notificate a
// parte da richiedi-modifica/modifica-approve. Chiamata fire-and-forget da
// QuadraturaFase.tsx dopo il salvataggio riuscito: qualunque errore qui non
// deve mai bloccare il flusso di chi sta chiudendo la cassa, quindi non
// rilancia mai eccezioni verso il chiamante.
export async function notificaChiusuraConfermata(chiusuraId: string): Promise<void> {
  try {
    const admin = createAdminClient()

    const { data: chiusura } = await admin
      .from('cassa_chiusure')
      .select('restaurant_id, data, totale_entrate, entrate_contanti, entrate_pos, entrate_bonifico, restaurant:restaurants(name, is_demo)')
      .eq('id', chiusuraId)
      .maybeSingle()
    if (!chiusura) return
    const row = chiusura as unknown as ChiusuraNotificaRow
    if (!row.restaurant) return

    const { data: managers } = await admin
      .from('profiles')
      .select('id, managed_restaurant_ids')
      .eq('role', 'manager')

    const targetManagers = ((managers ?? []) as { id: string; managed_restaurant_ids: string[] | null }[]).filter(m =>
      m.managed_restaurant_ids === null
        ? !row.restaurant!.is_demo
        : m.managed_restaurant_ids.includes(row.restaurant_id)
    )
    if (targetManagers.length === 0) return

    const dataLabel = formatInTimeZone(`${row.data}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })
    const euro = (n: number) => `€ ${Number(n).toFixed(2)}`
    const title = `Chiusura "${row.restaurant.name}"`
    const message = `${dataLabel} — Totale ${euro(row.totale_entrate)} · Contanti ${euro(row.entrate_contanti)} · POS ${euro(row.entrate_pos)} · Bonifico ${euro(row.entrate_bonifico)}`
    const link = '/cassa/lista-chiusure'

    const managerIds = targetManagers.map(m => m.id)
    const [, { data: subs }] = await Promise.all([
      admin.from('notifications').insert(
        targetManagers.map(m => ({ user_id: m.id, title, message, link }))
      ),
      admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth_key, user_id')
        .in('user_id', managerIds),
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
  } catch {
    // Best-effort: la chiusura è già salvata, un errore nella notifica non deve propagarsi.
  }
}
