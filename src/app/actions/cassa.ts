'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
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
// ChiusuraCassaClient.tsx dopo il salvataggio riuscito: qualunque errore qui non
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

// "Invia sollecito" del manager (Cassa › Chiusure, chiusura mancante):
// notifica in-app + push ai cassieri del locale perché inviino la
// chiusura di quel giorno. Il controllo di autorizzazione è esplicito
// (manager che gestisce il locale): la scrittura passa poi dal client
// admin, perché la RLS non permette di creare notifiche per altri.
export async function sollecitaChiusura(restaurantId: string, data: string): Promise<{ ok: true; inviati: number } | { ok: false; errore: string }> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, errore: 'Data non valida' }
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, errore: 'Non autenticato' }
    const { data: profilo } = await supabase.from('profiles').select('role, managed_restaurant_ids').eq('id', user.id).single()
    if (profilo?.role !== 'manager') return { ok: false, errore: 'Non autorizzato' }
    const gestiti = profilo.managed_restaurant_ids as string[] | null
    // La RLS di restaurants mostra al manager solo i locali che gestisce:
    // se non lo vede, non può sollecitarne il personale.
    const { data: locale } = await supabase.from('restaurants').select('id, name').eq('id', restaurantId).maybeSingle()
    if (!locale || (gestiti !== null && !gestiti.includes(restaurantId))) return { ok: false, errore: 'Non autorizzato' }

    const admin = createAdminClient()
    const { data: cassieri } = await admin.from('profiles').select('id').eq('role', 'cassiere').eq('restaurant_id', restaurantId)
    const ids = ((cassieri ?? []) as { id: string }[]).map(c => c.id)
    if (!ids.length) return { ok: false, errore: 'Nessun cassiere associato al locale' }

    const dataLabel = formatInTimeZone(`${data}T12:00:00Z`, TZ, 'EEEE d MMMM', { locale: it })
    const title = 'Chiusura da inviare'
    const message = `Manca la chiusura cassa di ${dataLabel} (${locale.name}): inviala appena puoi.`
    const link = '/cassa/chiusura'
    const { error } = await admin.from('notifications').insert(ids.map(id => ({ user_id: id, title, message, link })))
    if (error) return { ok: false, errore: error.message }

    const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth_key').in('user_id', ids)
    await Promise.allSettled(((subs ?? []) as { endpoint: string; p256dh: string; auth_key: string }[]).map(async sub => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, JSON.stringify({ title, body: message, url: link }))
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 410 || status === 404) await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      }
    }))
    return { ok: true, inviati: ids.length }
  } catch {
    return { ok: false, errore: 'Invio non riuscito' }
  }
}
