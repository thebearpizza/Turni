import { createAdminClient } from '@/lib/supabase/admin'
import webpush from 'web-push'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { ORIGINE_LABEL, normalizzaOrario, nomeCompleto } from '@/lib/cassa/prenotazioniAgenda'
import type { DettagliNotifica } from '@/lib/cassa/prenotazioniEmailProcessing'

const TZ = 'Europe/Rome'

// Notifica push + in-app ai manager del locale quando arriva una
// prenotazione nuova da TheFork/Restoo (webhook o sync Gmail) — confermata
// in agenda, o messa in coda perché manca solo l'orario. Non per
// aggiornamenti a una prenotazione già nota né per cancellazioni: sono
// eventi diversi da "è arrivata una prenotazione". Fire-and-forget dalle
// route di ingresso mail: un errore qui non deve mai far fallire
// l'elaborazione, che ha già scritto (o messo in coda) la prenotazione.
export async function notificaNuovaPrenotazione(dettagli: DettagliNotifica): Promise<void> {
  try {
    const admin = createAdminClient()

    const { data: restaurant } = await admin
      .from('restaurants')
      .select('name, is_demo')
      .eq('id', dettagli.restaurant_id)
      .maybeSingle()
    if (!restaurant) return

    const { data: managers } = await admin
      .from('profiles')
      .select('id, managed_restaurant_ids')
      .eq('role', 'manager')

    const targetManagers = ((managers ?? []) as { id: string; managed_restaurant_ids: string[] | null }[]).filter(m =>
      m.managed_restaurant_ids === null
        ? !restaurant.is_demo
        : m.managed_restaurant_ids.includes(dettagli.restaurant_id)
    )
    if (targetManagers.length === 0) return

    const dataLabel = formatInTimeZone(`${dettagli.data}T12:00:00Z`, TZ, 'EEE d MMM', { locale: it })
    const nome = nomeCompleto(dettagli)
    const paxLabel = `${dettagli.persone} pax`

    const title = dettagli.orario ? `Nuova prenotazione — ${restaurant.name}` : `Da completare — ${restaurant.name}`
    const message = dettagli.orario
      ? `${nome} · ${dataLabel} ${normalizzaOrario(dettagli.orario)} · ${paxLabel} · ${ORIGINE_LABEL[dettagli.origine] ?? dettagli.origine}`
      : `${nome} · ${dataLabel} · ${paxLabel} · manca l'orario (${ORIGINE_LABEL[dettagli.origine] ?? dettagli.origine})`
    // Safari/iOS ignora i pulsanti azione nelle notifiche push (tenerla
    // premuta o tirarla giù non mostra alcuna azione personalizzata,
    // solo "Visualizza" — limite della piattaforma, non della notifica
    // qui inviata): il modo più vicino a "scegli l'orario dalla notifica"
    // è che il tocco porti dritto al modulo di completamento di QUESTA
    // prenotazione invece che alla tab in generale, pronto per scrivere
    // l'orario — il servizio (pranzo/cena) si deduce da solo da quello.
    const link = dettagli.logId ? `/cassa/prenotazioni?completa=${dettagli.logId}` : '/cassa/prenotazioni'

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

    webpush.setVapidDetails(
      process.env.VAPID_EMAIL!,
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    )

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
    // Best-effort: la prenotazione è già salvata (o in coda), un errore
    // nella notifica non deve propagarsi.
  }
}
