import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cercaMessaggi, leggiMessaggio, gmailConfigurato } from '@/lib/gmail'
import { interpretaEmail, aiConfigurata, type EmailPrenotazione } from '@/lib/cassa/prenotazioniParsing'
import { servizioDaOrario, normalizzaOrario } from '@/lib/cassa/prenotazioniAgenda'
import { abbinaInsegna, localeDaIgnorare, type Insegna, type LocaleIgnorato } from '@/lib/cassa/prenotazioniLocali'

// Legge la casella su cui TheFork e Restoo recapitano le notifiche e
// riversa le prenotazioni nell'agenda. Invocata dal cron di Vercel e,
// su richiesta, dal tasto "Aggiorna" della tab Prenotazioni.
//
// Interpretare N mail con l'AI richiede più dei 10s di default.
export const maxDuration = 60

// Mittenti da cui possono arrivare notifiche di prenotazione. Volutamente
// larga: il filtro fine (è davvero una prenotazione?) lo fa l'AI, qui si
// vuole solo evitare di dare in pasto al modello l'intera casella.
const MITTENTI = [
  'thefork.com',
  'theforkmanager.com',
  'restaurant-information.com',
  'lafourchette.com',
  'restoo.me',
  'restoo.it',
]

// Finestra di sicurezza: si rileggono sempre gli ultimi giorni e si
// scartano per gmail_message_id le mail già lavorate. Nessuno stato di
// avanzamento da mantenere, e un fermo del cron di qualche ora si
// recupera da solo al primo giro utile.
const GIORNI_FINESTRA = 3
const MAX_MESSAGGI = 60

interface Esito {
  esito:   'importata' | 'ignorata' | 'errore'
  evento?: EmailPrenotazione['evento']
  errore?: string
  prenotazione_id?: string
}

type AdminClient = ReturnType<typeof createAdminClient>

async function lavoraMail(
  admin: AdminClient,
  insegne: Insegna[],
  ignorati: LocaleIgnorato[],
  msg: { id: string; mittente: string; oggetto: string; testo: string; ricevutaAt: string | null }
): Promise<Esito> {
  const letta = await interpretaEmail(msg)

  if (!letta.e_prenotazione) return { esito: 'ignorata' }

  // Prima di tutto il resto: se la notifica riguarda un altro locale del
  // gruppo si scarta e basta. Ogni locale ha il proprio libro visite e
  // questa agenda è solo di Porto Rotondo — mescolarle la renderebbe
  // inutilizzabile proprio durante il servizio.
  const escluso = localeDaIgnorare(ignorati, [letta.locale, msg.oggetto])
  if (escluso) {
    return { esito: 'ignorata', evento: letta.evento, errore: `Locale escluso (${escluso.termine})` }
  }

  // Senza data e orario non c'è una riga di agenda da scrivere: la mail
  // resta nel log come errore, così è rileggibile invece che persa.
  if (!letta.data || !letta.orario || !letta.nome) {
    return { esito: 'errore', evento: letta.evento, errore: 'Dati insufficienti: manca nome, data o orario' }
  }

  // Allow-list stretta: si importa solo ciò che corrisponde a un'insegna
  // configurata. Nessun ripiego su un locale "probabile" — una
  // prenotazione non attribuita con certezza resta fuori dall'agenda.
  const abbinamento = abbinaInsegna(insegne, letta.locale)
  if (!abbinamento) {
    return {
      esito: 'errore',
      evento: letta.evento,
      errore: `Locale non riconosciuto: ${letta.locale ?? '(assente)'}`,
    }
  }

  const origine = letta.fonte ?? (/restoo/i.test(msg.mittente) ? 'restoo' : 'thefork')
  const orario = normalizzaOrario(letta.orario)

  // Aggancio a una prenotazione già in agenda: prima per riferimento del
  // gestionale (l'unico davvero affidabile), poi — quando la mail non ne
  // riporta uno — per nome + giorno, che è il criterio con cui il
  // personale stesso riconoscerebbe la stessa prenotazione.
  let esistenteId: string | null = null

  if (letta.riferimento) {
    const { data } = await admin
      .from('prenotazioni')
      .select('id')
      .eq('restaurant_id', abbinamento.restaurant_id)
      .eq('origine', origine)
      .eq('riferimento_esterno', letta.riferimento)
      .maybeSingle()
    esistenteId = data?.id ?? null
  } else {
    const { data } = await admin
      .from('prenotazioni')
      .select('id')
      .eq('restaurant_id', abbinamento.restaurant_id)
      .eq('origine', origine)
      .eq('data', letta.data)
      .ilike('nome', letta.nome)
      .neq('stato', 'eliminata')
      .limit(1)
    esistenteId = data?.[0]?.id ?? null
  }

  if (letta.evento === 'cancellazione') {
    if (!esistenteId) return { esito: 'ignorata', evento: letta.evento }
    await admin.from('prenotazioni').update({ stato: 'eliminata' }).eq('id', esistenteId)
    return { esito: 'importata', evento: letta.evento, prenotazione_id: esistenteId }
  }

  const campi = {
    restaurant_id:       abbinamento.restaurant_id,
    insegna:             abbinamento.codice,
    origine,
    riferimento_esterno: letta.riferimento,
    data:                letta.data,
    orario,
    servizio:            servizioDaOrario(orario),
    nome:                letta.nome,
    cognome:             letta.cognome,
    persone:             letta.persone ?? 1,
    bambini:             letta.bambini ?? 0,
    sconto_percentuale:  letta.sconto_percentuale,
    telefono:            letta.telefono,
    email:               letta.email,
    note:                letta.note,
  }

  if (esistenteId) {
    // Una modifica non deve resuscitare né retrocedere lo stato di sala
    // (seduta/no show) deciso dal personale: si aggiornano solo i dati
    // della prenotazione.
    await admin.from('prenotazioni').update(campi).eq('id', esistenteId)
    return { esito: 'importata', evento: letta.evento, prenotazione_id: esistenteId }
  }

  const { data: creata, error } = await admin
    .from('prenotazioni')
    .insert({ ...campi, stato: 'confermata' })
    .select('id')
    .single()

  if (error) return { esito: 'errore', evento: letta.evento, errore: error.message }
  return { esito: 'importata', evento: letta.evento, prenotazione_id: creata.id }
}

async function sincronizza() {
  if (!gmailConfigurato()) {
    return NextResponse.json({ error: 'Casella mail non configurata' }, { status: 503 })
  }
  if (!aiConfigurata()) {
    return NextResponse.json({ error: 'Chiave AI non configurata' }, { status: 503 })
  }

  const admin = createAdminClient()

  const [{ data: insegne }, { data: ignorati }] = await Promise.all([
    admin.from('prenotazioni_insegne').select('restaurant_id, codice, termini, priorita'),
    admin.from('prenotazioni_locali_ignorati').select('termine, motivo'),
  ])

  const query = `(${MITTENTI.map(m => `from:${m}`).join(' OR ')}) newer_than:${GIORNI_FINESTRA}d`

  let ids: string[]
  try {
    ids = await cercaMessaggi(query, MAX_MESSAGGI)
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
    .select('gmail_message_id')
    .in('gmail_message_id', ids)

  const visti = new Set((giaViste ?? []).map(r => r.gmail_message_id as string))
  const daLavorare = ids.filter(id => !visti.has(id))

  const conteggio = { lette: daLavorare.length, importate: 0, ignorate: 0, errori: 0 }

  for (const id of daLavorare) {
    let msg
    try {
      msg = await leggiMessaggio(id)
    } catch (err) {
      console.error(`[cassa/prenotazioni] Messaggio ${id} non leggibile:`, err)
      conteggio.errori++
      continue
    }

    let esito: Esito
    try {
      esito = await lavoraMail(
        admin,
        (insegne ?? []) as Insegna[],
        (ignorati ?? []) as LocaleIgnorato[],
        msg,
      )
    } catch (err) {
      esito = { esito: 'errore', errore: err instanceof Error ? err.message : String(err) }
    }

    if (esito.esito === 'importata') conteggio.importate++
    else if (esito.esito === 'ignorata') conteggio.ignorate++
    else conteggio.errori++

    await admin.from('prenotazioni_email_log').insert({
      gmail_message_id: msg.id,
      gmail_thread_id:  msg.threadId,
      ricevuta_at:      msg.ricevutaAt,
      mittente:         msg.mittente,
      oggetto:          msg.oggetto,
      esito:            esito.esito,
      evento:           esito.evento ?? null,
      errore:           esito.errore ?? null,
      prenotazione_id:  esito.prenotazione_id ?? null,
      // Il testo della mail resta nel log: è ciò che permette di
      // rileggere una notifica non interpretata dopo aver migliorato il
      // parser, senza dover risalire alla casella.
      payload:          { testo: msg.testo },
    })
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
