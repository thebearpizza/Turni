import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cercaMessaggi, leggiMessaggio, gmailConfigurato } from '@/lib/gmail'
import { aiConfigurata } from '@/lib/cassa/prenotazioniParsing'
import { queryMittenti, MAX_MESSAGGI } from '@/lib/cassa/prenotazioniMail'
import { lavoraMail, caricaConfigurazioneLocali, registraEsito, type EsitoMail } from '@/lib/cassa/prenotazioniEmailProcessing'
import { notificaNuovaPrenotazione } from '@/lib/cassa/prenotazioniNotifiche'

// Legge la casella su cui TheFork e Restoo recapitano le notifiche e
// riversa le prenotazioni nell'agenda. Invocata dal cron di Vercel e,
// su richiesta, dal tasto "Aggiorna" della tab Prenotazioni.
//
// Via di ingresso "a interrogazione": serve solo finché non è attivo il
// webhook di posta in entrata (vedi /api/cassa/prenotazioni/webhook, che
// riceve le mail in tempo reale invece di andarle a cercare). Le due vie
// condividono la stessa logica di interpretazione — prenotazioniEmailProcessing.ts
// — e scrivono nello stesso log, quindi possono restare attive insieme
// senza produrre doppioni: message_id è univoco per fonte.
//
// Interpretare N mail con l'AI richiede più dei 10s di default.
export const maxDuration = 60

async function sincronizza() {
  if (!gmailConfigurato()) {
    return NextResponse.json({ error: 'Casella mail non configurata' }, { status: 503 })
  }
  if (!aiConfigurata()) {
    return NextResponse.json({ error: 'Chiave AI non configurata' }, { status: 503 })
  }

  const admin = createAdminClient()
  const { insegne, ignorati } = await caricaConfigurazioneLocali(admin)

  let ids: string[]
  try {
    ids = await cercaMessaggi(queryMittenti(), MAX_MESSAGGI)
  } catch (err) {
    console.error('[cassa/prenotazioni] Lettura casella fallita:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Lettura casella fallita' },
      { status: 502 }
    )
  }

  // Scarta subito le mail già lavorate: è ciò che rende la funzione
  // idempotente e mantiene il costo di un giro a vuoto vicino a zero.
  const { data: giaViste } = await admin
    .from('prenotazioni_email_log')
    .select('message_id')
    .eq('origine', 'gmail')
    .in('message_id', ids)

  const visti = new Set((giaViste ?? []).map(r => r.message_id as string))
  const daLavorare = ids.filter(id => !visti.has(id))

  const conteggio = { lette: daLavorare.length, importate: 0, ignorate: 0, incomplete: 0, errori: 0 }

  for (const id of daLavorare) {
    let msg
    try {
      msg = await leggiMessaggio(id)
    } catch (err) {
      console.error(`[cassa/prenotazioni] Messaggio ${id} non leggibile:`, err)
      conteggio.errori++
      continue
    }

    let esito: EsitoMail
    try {
      esito = await lavoraMail(admin, insegne, ignorati, msg)
    } catch (err) {
      esito = { esito: 'errore', errore: err instanceof Error ? err.message : String(err) }
    }

    if (esito.esito === 'importata') conteggio.importate++
    else if (esito.esito === 'ignorata') conteggio.ignorate++
    else if (esito.esito === 'incompleta') conteggio.incomplete++
    else conteggio.errori++

    const logId = await registraEsito(admin, { origine: 'gmail', messageId: msg.id, threadId: msg.threadId, msg, esito })

    // Solo per un arrivo vero (nuova in agenda o in coda), non per
    // l'aggiornamento di una prenotazione già nota. In sequenza col resto
    // del ciclo: il cron ha 60s di margine, e batch di N mail non devono
    // sparare N notifiche in parallelo l'una sull'altra.
    if (esito.dettagli && (esito.nuova || esito.esito === 'incompleta')) {
      // logId solo per l'esito 'incompleta': è quello che serve alla
      // notifica per linkare dritto al completamento di questa voce.
      const dettagli = esito.esito === 'incompleta' && logId ? { ...esito.dettagli, logId } : esito.dettagli
      await notificaNuovaPrenotazione(dettagli)
    }
  }

  return NextResponse.json(conteggio)
}

// Cron di Vercel: arriva senza sessione utente, autenticato dal segreto
// condiviso nell'header Authorization.
export async function GET(request: Request) {
  const atteso = process.env.CRON_SECRET
  if (!atteso) return NextResponse.json({ error: 'CRON_SECRET non configurato' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${atteso}`) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  return sincronizza()
}

// Aggiornamento manuale dalla tab Prenotazioni: solo manager.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'manager') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  return sincronizza()
}
