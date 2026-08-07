import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import webpush from 'web-push'

// Invia una notifica di prova ai SOLI dispositivi di chi la richiede, e
// riporta esattamente cosa è successo per ognuno. Serve a rispondere alla
// domanda "le notifiche arrivano?" senza dover aspettare un evento reale:
// distingue i tre casi che altrimenti si confondono in un silenzio unico —
// nessun dispositivo registrato, chiavi VAPID sbagliate, push service che
// rifiuta l'endpoint.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  if (!process.env.VAPID_EMAIL || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json(
      { error: 'Chiavi VAPID non configurate sul server: le notifiche push non possono partire.' },
      { status: 503 }
    )
  }

  const admin = createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key')
    .eq('user_id', user.id)

  if (!subs?.length) {
    return NextResponse.json({
      inviate: 0,
      dispositivi: 0,
      messaggio: 'Nessun dispositivo registrato per il tuo account: attiva le notifiche dal banner.',
    })
  }

  webpush.setVapidDetails(
    process.env.VAPID_EMAIL,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )

  const payload = JSON.stringify({
    title: 'inTurno — notifica di prova',
    body:  'Se leggi questo messaggio le notifiche push funzionano.',
    url:   '/',
  })

  type Sub = { id: string; endpoint: string; p256dh: string; auth_key: string }
  const esiti = await Promise.all(
    (subs as Sub[]).map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        )
        return { ok: true as const }
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode
        // Stessa pulizia della consegna reale: un endpoint morto va tolto,
        // così il dispositivo si ri-registra alla prossima apertura.
        if (status === 410 || status === 404) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id)
        }
        return { ok: false as const, status: status ?? null, errore: err instanceof Error ? err.message : String(err) }
      }
    })
  )

  const inviate = esiti.filter(e => e.ok).length
  const falliti = esiti.filter(e => !e.ok)

  return NextResponse.json({
    inviate,
    dispositivi: subs.length,
    messaggio: inviate > 0
      ? `Notifica inviata a ${inviate} dispositiv${inviate === 1 ? 'o' : 'i'} su ${subs.length}.`
      : 'Nessun invio riuscito: il servizio push ha rifiutato tutti i dispositivi registrati.',
    errori: falliti.map(f => ({ status: f.status, errore: f.errore })),
  })
}
