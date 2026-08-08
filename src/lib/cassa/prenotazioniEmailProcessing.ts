import { createAdminClient } from '@/lib/supabase/admin'
import { interpretaEmail, type EmailPrenotazione } from '@/lib/cassa/prenotazioniParsing'
import { servizioDaOrario, normalizzaOrario } from '@/lib/cassa/prenotazioniAgenda'
import { abbinaInsegna, localeDaIgnorare, type Insegna, type LocaleIgnorato } from '@/lib/cassa/prenotazioniLocali'

// Cosa fare con UNA mail di notifica, indipendentemente da come è
// arrivata — letta a intervalli da una casella Gmail o consegnata subito
// da un webhook di posta in entrata (CloudMailin). Il trasporto cambia,
// il significato di "nuova prenotazione da TheFork" no: questa funzione
// vive qui, non dentro una singola route, apposta perché due percorsi
// diversi non finiscano per interpretare la stessa mail in due modi.

export interface MessaggioPrenotazione {
  mittente:   string
  oggetto:    string
  testo:      string
  ricevutaAt: string | null
}

export interface EsitoMail {
  esito:   'importata' | 'ignorata' | 'errore'
  evento?: EmailPrenotazione['evento']
  errore?: string
  prenotazione_id?: string
}

export type AdminClient = ReturnType<typeof createAdminClient>

export async function lavoraMail(
  admin: AdminClient,
  insegne: Insegna[],
  ignorati: LocaleIgnorato[],
  msg: MessaggioPrenotazione
): Promise<EsitoMail> {
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

  // Coperti TOTALI, bambini inclusi: la notifica scrive "10/9" per 10
  // adulti e 9 bambini, ma a tavola sono 19. Se i coperti non sono stati
  // letti si mette 0 e lo si scrive nelle note: la prenotazione deve
  // comunque comparire in agenda — un cliente invisibile è peggio di un
  // numero da correggere — ma lo zero rende l'errore impossibile da non
  // vedere, mentre un "1" di ripiego passerebbe inosservato.
  const bambini = letta.bambini ?? 0
  const persone = letta.adulti != null ? letta.adulti + bambini : 0
  const note = letta.adulti != null
    ? letta.note
    : ['⚠ Coperti non letti dalla notifica: da verificare', letta.note].filter(Boolean).join(' — ')

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
    persone,
    bambini,
    sconto_percentuale:  letta.sconto_percentuale,
    telefono:            letta.telefono,
    email:               letta.email,
    note,
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

// Righe di prenotazioni_insegne / prenotazioni_locali_ignorati, lette una
// volta e passate a lavoraMail: entrambe le vie d'ingresso ne hanno
// bisogno, quindi il caricamento vive qui invece che duplicato.
export async function caricaConfigurazioneLocali(
  admin: AdminClient
): Promise<{ insegne: Insegna[]; ignorati: LocaleIgnorato[] }> {
  const [{ data: insegne }, { data: ignorati }] = await Promise.all([
    admin.from('prenotazioni_insegne').select('restaurant_id, codice, termini, priorita, principale'),
    admin.from('prenotazioni_locali_ignorati').select('termine, motivo'),
  ])
  return {
    insegne: (insegne ?? []) as Insegna[],
    ignorati: (ignorati ?? []) as LocaleIgnorato[],
  }
}

// Registra l'esito nel log, qualunque sia stata la via d'ingresso — è
// ciò che alimenta sia l'idempotenza (message_id UNIQUE) sia la
// diagnostica in-app.
export async function registraEsito(
  admin: AdminClient,
  opts: {
    origine:   'gmail' | 'cloudmailin'
    messageId: string
    threadId?: string | null
    msg:       MessaggioPrenotazione
    esito:     EsitoMail
  }
): Promise<void> {
  await admin.from('prenotazioni_email_log').insert({
    origine:      opts.origine,
    message_id:   opts.messageId,
    thread_id:    opts.threadId ?? null,
    ricevuta_at:  opts.msg.ricevutaAt,
    mittente:     opts.msg.mittente,
    oggetto:      opts.msg.oggetto,
    esito:        opts.esito.esito,
    evento:       opts.esito.evento ?? null,
    errore:       opts.esito.errore ?? null,
    prenotazione_id: opts.esito.prenotazione_id ?? null,
    // Il testo della mail resta nel log: è ciò che permette di rileggere
    // una notifica non interpretata dopo aver migliorato il parser,
    // senza dover risalire alla casella.
    payload: { testo: opts.msg.testo },
  })
}
