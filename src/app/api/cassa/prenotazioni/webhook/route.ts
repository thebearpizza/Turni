import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { aiConfigurata } from '@/lib/cassa/prenotazioniParsing'
import { lavoraMail, caricaConfigurazioneLocali, registraEsito, type EsitoMail } from '@/lib/cassa/prenotazioniEmailProcessing'
import { estraiMessaggioCloudMailin } from '@/lib/cassa/prenotazioniWebhook'

// Riceve in tempo reale le mail di notifica che CloudMailin inoltra
// dall'indirizzo di posta in entrata dedicato a questa agenda —
// l'alternativa, senza dominio da comprare, al polling di una casella
// Gmail (vedi /sync). Stessa logica di interpretazione delle mail,
// stesso log: le due vie possono restare attive insieme senza produrre
// doppioni, message_id è univoco per origine.
//
// Autenticazione: un segreto nella query string del "Target URL"
// configurato su CloudMailin, non un header — resta impostabile dalla
// sola UI del loro pannello, senza bisogno di header personalizzati che
// quel pannello non offre.
export const maxDuration = 30

export async function POST(request: Request) {
  const atteso = process.env.PRENOTAZIONI_WEBHOOK_SECRET
  if (!atteso) {
    return NextResponse.json({ error: 'PRENOTAZIONI_WEBHOOK_SECRET non configurato' }, { status: 503 })
  }

  const url = new URL(request.url)
  if (url.searchParams.get('secret') !== atteso) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  if (!aiConfigurata()) {
    return NextResponse.json({ error: 'Chiave AI non configurata' }, { status: 503 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo della richiesta non è JSON valido' }, { status: 400 })
  }

  const estratto = estraiMessaggioCloudMailin(payload)
  if (!estratto) {
    return NextResponse.json({ error: 'Payload email non riconosciuto' }, { status: 400 })
  }
  const { messageId, msg } = estratto

  const admin = createAdminClient()

  // Idempotenza PRIMA della chiamata AI: se CloudMailin non riceve un 2xx
  // in tempo ripete la consegna, e senza questo controllo ogni ripetizione
  // costerebbe una nuova chiamata al modello invece di essere gratuita.
  const { data: giaVista } = await admin
    .from('prenotazioni_email_log')
    .select('id')
    .eq('origine', 'cloudmailin')
    .eq('message_id', messageId)
    .maybeSingle()
  if (giaVista) return NextResponse.json({ ok: true, duplicato: true })

  const { insegne, ignorati } = await caricaConfigurazioneLocali(admin)

  let esito: EsitoMail
  try {
    esito = await lavoraMail(admin, insegne, ignorati, msg)
  } catch (err) {
    esito = { esito: 'errore', errore: err instanceof Error ? err.message : String(err) }
  }

  await registraEsito(admin, { origine: 'cloudmailin', messageId, msg, esito })

  // Sempre 200 se si è arrivati fin qui, anche per un esito 'errore' di
  // interpretazione: quell'errore è nostro (mail non capita), non un
  // motivo per far ritentare CloudMailin all'infinito la stessa consegna.
  return NextResponse.json({ ok: true, esito: esito.esito })
}
