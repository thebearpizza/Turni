import { createAdminClient } from '@/lib/supabase/admin'
import { interpretaEmail, type EmailPrenotazione } from '@/lib/cassa/prenotazioniParsing'
import { servizioDaOrario, normalizzaOrario } from '@/lib/cassa/prenotazioniAgenda'
import { abbinaInsegna, localeDaIgnorare, type Insegna, type LocaleIgnorato } from '@/lib/cassa/prenotazioniLocali'
import { estraiDaLinkTheFork } from '@/lib/cassa/prenotazioniTheForkLink'
import { chiaveCliente } from '@/lib/cassa/prenotazioniImport'

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
  // plain/html grezzi prima della scelta di quale usare come `testo`:
  // non servono all'interpretazione, solo a poter capire in seguito
  // perché il testo scelto era sbagliato, senza dover riprodurre la
  // stessa mail per vederlo di nuovo.
  debug?:     { plain: string; html: string }
}

// Tutto ciò che si sa già di una prenotazione a cui manca solo l'orario
// — abbastanza per compilare in anticipo il modulo di completamento in
// coda, così il manager tocca "Completa" e aggiunge solo quel campo
// invece di ridigitare nome, telefono, persone e sconto da zero.
export interface DatiParziali {
  restaurant_id:       string
  insegna:             string | null
  origine:             'thefork' | 'restoo'
  riferimento_esterno: string | null
  data:                string
  nome:                string
  cognome:             string | null
  persone:             number
  bambini:             number
  sconto_percentuale:  number | null
  telefono:            string | null
  email:               string | null
  note:                string | null
}

// Il minimo che serve per annunciare l'arrivo di una prenotazione (push +
// notifica in-app): sottoinsieme di DatiParziali, ma con l'orario — che lì
// non c'è mai per definizione — perché qui serve dire anche "confermata
// per le 20:30", non solo "in coda".
export interface DettagliNotifica {
  restaurant_id: string
  origine:       'thefork' | 'restoo'
  nome:          string
  cognome:       string | null
  data:          string
  orario:        string | null
  persone:       number
  // Id della riga di log, aggiunto dal chiamante DOPO registraEsito()
  // (qui non esiste ancora): solo quando presente la notifica può
  // linkare dritto al completamento di QUESTA prenotazione invece che
  // alla tab Prenotazioni in generale.
  logId?:        string
}

export interface EsitoMail {
  esito:   'importata' | 'ignorata' | 'errore' | 'incompleta'
  evento?: EmailPrenotazione['evento']
  errore?: string
  prenotazione_id?: string
  // Presente solo quando esito === 'incompleta'.
  parziale?: DatiParziali
  // true solo per un inserimento nuovo (non per l'aggiornamento di una
  // prenotazione già in agenda): è quello che decide se vale la pena
  // avvisare — una modifica a qualcosa che il manager conosce già non è
  // "è arrivata una prenotazione".
  nuova?: boolean
  // Presente quando c'è qualcosa da annunciare (nuova === true oppure
  // esito === 'incompleta').
  dettagli?: DettagliNotifica
}

export type AdminClient = ReturnType<typeof createAdminClient>

// Una mail di cancellazione può riguardare una prenotazione mai arrivata
// in agenda perché ferma in coda (esito 'incompleta': mancava l'orario) —
// senza questa ricerca la cancellazione la ignora e basta (nulla da
// eliminare in prenotazioni), e la voce di coda resta ad aspettare per
// sempre un orario che non arriverà mai, dato che una notifica futura
// non la riguarderà più. Stesso criterio a due livelli già usato sopra
// per `esistenteId`: prima il riferimento del gestionale (il più
// affidabile), poi giorno + cliente.
async function trovaVoceInCoda(
  admin: AdminClient,
  restaurantId: string,
  riferimento: string | null,
  data: string,
  nome: string,
  cognome: string | null
): Promise<string | null> {
  const { data: righe } = await admin
    .from('prenotazioni_email_log')
    .select('id, payload')
    .eq('esito', 'incompleta')
    .eq('payload->parziale->>restaurant_id', restaurantId)

  const voci = (righe ?? [])
    .map(r => ({ id: r.id as string, parziale: (r.payload as { parziale?: DatiParziali } | null)?.parziale }))
    .filter((v): v is { id: string; parziale: DatiParziali } => !!v.parziale)

  if (riferimento) {
    const perRiferimento = voci.find(v => v.parziale.riferimento_esterno === riferimento)
    if (perRiferimento) return perRiferimento.id
  }

  const chiave = chiaveCliente(nome, cognome)
  const perCliente = voci.find(v => v.parziale.data === data && chiaveCliente(v.parziale.nome, v.parziale.cognome) === chiave)
  return perCliente?.id ?? null
}

export async function lavoraMail(
  admin: AdminClient,
  insegne: Insegna[],
  ignorati: LocaleIgnorato[],
  msg: MessaggioPrenotazione
): Promise<EsitoMail> {
  const daModello = await interpretaEmail(msg)

  if (!daModello.e_prenotazione) return { esito: 'ignorata' }

  // Le notifiche "Nuova prenotazione" di TheFork non scrivono affatto
  // data e orario nel corpo — solo dietro il link "Vedi i dettagli",
  // passato da un redirect di tracciamento. Quel link porta comunque
  // solo alla pagina del GIORNO (mai l'orario), ma la data lì dentro è
  // certa: preferirla a quella eventualmente indovinata dal modello da
  // un testo che non la contiene affatto. Lo stesso per il codice
  // prenotazione, più affidabile di quanto il testo libero possa offrire.
  //
  // L'URL vive SOLO nell'href, mai nel testo visibile: `msg.testo` è già
  // ripulito dall'HTML (sceglieCorpoMail/stripHtml), quindi cercare il
  // link lì non trova mai nulla — va cercato nell'HTML grezzo, prima che
  // gli attributi dei tag vengano scartati. Per questo si usa `debug.html`
  // (e, per sicurezza, anche `debug.plain`) invece di `testo`.
  const grezzo = [msg.debug?.html, msg.debug?.plain, msg.testo].filter(Boolean).join('\n')
  const daLink = estraiDaLinkTheFork(grezzo)
  const letta = {
    ...daModello,
    data:        daLink?.data ?? daModello.data,
    riferimento: daLink?.riferimento ?? daModello.riferimento,
  }

  // Prima di tutto il resto: se la notifica riguarda un altro locale del
  // gruppo si scarta e basta. Ogni locale ha il proprio libro visite e
  // questa agenda è solo di Porto Rotondo — mescolarle la renderebbe
  // inutilizzabile proprio durante il servizio.
  const escluso = localeDaIgnorare(ignorati, [letta.locale, msg.oggetto])
  if (escluso) {
    return { esito: 'ignorata', evento: letta.evento, errore: `Locale escluso (${escluso.termine})` }
  }

  // Senza nome o data non c'è nulla di azionabile — nemmeno una voce in
  // coda avrebbe senso, perché mancherebbe chi è o per quando. Resta un
  // errore semplice, non recuperabile dal manager senza riaprire la mail.
  if (!letta.nome || !letta.data) {
    const mancanti = [!letta.nome && 'nome', !letta.data && 'data'].filter(Boolean).join(', ')
    return { esito: 'errore', evento: letta.evento, errore: `Manca ${mancanti}: dati insufficienti per l'agenda` }
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
  // gestionale (il più affidabile), poi — sempre, anche quando il primo
  // ha trovato qualcosa oppure no — per giorno + nome (e cognome, se
  // noto), SENZA pretendere che l'origine coincida. Pretenderlo sembrava
  // più sicuro ma in pratica faceva perdere cancellazioni e modifiche
  // vere: una prenotazione importata da file prima che l'import
  // distinguesse TheFork/Restoo resta con origine 'import' per sempre,
  // e una mail di TheFork che la cancella o la modifica non la troverebbe
  // mai se il confronto pretendesse anche origine = 'thefork'. Prima di
  // decidere se manca l'orario, apposta: una notifica di modifica o
  // cancellazione riguarda quasi sempre qualcosa già in agenda e spesso
  // non riporta affatto l'orario — se la prenotazione esiste già, quel
  // dato non serve indovinarlo, c'è già scritto in agenda.
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
  }

  if (!esistenteId) {
    // Insegna abbinata sempre nel filtro: due prenotazioni dello stesso
    // cliente lo stesso giorno ma per Crunch! e Benthos sono due tavoli
    // diversi, non un doppione da scegliere a caso.
    let query = admin
      .from('prenotazioni')
      .select('id, orario')
      .eq('restaurant_id', abbinamento.restaurant_id)
      .eq('insegna', abbinamento.codice)
      .eq('data', letta.data)
      .ilike('nome', letta.nome)
      .neq('stato', 'eliminata')
    if (letta.cognome) query = query.ilike('cognome', letta.cognome)
    const { data: candidate } = await query.order('orario')
    const righe = candidate ?? []

    if (righe.length === 1) {
      esistenteId = righe[0].id
    } else if (righe.length > 1 && letta.orario) {
      const servizioNoto = servizioDaOrario(letta.orario)
      const filtrate = righe.filter(r => servizioDaOrario(r.orario) === servizioNoto)
      if (filtrate.length === 1) esistenteId = filtrate[0].id
    }

    // Ambiguità non risolta (o mail senza orario per disambiguare): meglio
    // non toccare nulla che modificare/cancellare la prenotazione sbagliata
    // — una cancellata per errore non si recupera.
    if (righe.length > 1 && !esistenteId) {
      return {
        esito: 'errore',
        evento: letta.evento,
        errore: `Più prenotazioni di ${letta.nome}${letta.cognome ? ' ' + letta.cognome : ''} il ${letta.data}: aggancio ambiguo, nessuna modificata`,
      }
    }
  }

  if (letta.evento === 'cancellazione') {
    if (esistenteId) {
      await admin.from('prenotazioni').update({ stato: 'eliminata' }).eq('id', esistenteId)
      return { esito: 'importata', evento: letta.evento, prenotazione_id: esistenteId }
    }
    // Non ancora in agenda: potrebbe essere proprio la prenotazione ferma
    // in coda che questa mail sta cancellando — niente da eliminare in
    // prenotazioni, ma la voce di coda va comunque chiusa.
    const codaId = await trovaVoceInCoda(admin, abbinamento.restaurant_id, letta.riferimento, letta.data, letta.nome, letta.cognome)
    if (codaId) await admin.from('prenotazioni_email_log').update({ esito: 'ignorata' }).eq('id', codaId)
    return { esito: 'ignorata', evento: letta.evento }
  }

  // Se la prenotazione esiste già ma questa mail non porta un orario
  // nuovo (le notifiche di modifica di TheFork non lo scrivono quasi
  // mai), si aggiornano solo i campi che la mail conosce davvero — orario
  // e servizio restano quelli già in agenda, non vanno né indovinati né
  // azzerati. È il caso reale che mandava in coda una semplice modifica
  // coperti di una prenotazione già confermata, invece di aggiornarla.
  if (esistenteId) {
    const campi: Record<string, unknown> = {
      insegna:             abbinamento.codice,
      riferimento_esterno: letta.riferimento,
      nome:                letta.nome,
      cognome:             letta.cognome,
      persone,
      bambini,
      sconto_percentuale:  letta.sconto_percentuale,
      telefono:            letta.telefono,
      email:               letta.email,
      note,
    }
    if (letta.orario) {
      const orarioNoto = normalizzaOrario(letta.orario)
      campi.orario = orarioNoto
      campi.servizio = servizioDaOrario(orarioNoto)
    }
    // Una modifica non deve resuscitare né retrocedere lo stato di sala
    // (seduta/no show) deciso dal personale: si aggiornano solo i dati
    // della prenotazione.
    await admin.from('prenotazioni').update(campi).eq('id', esistenteId)
    return { esito: 'importata', evento: letta.evento, prenotazione_id: esistenteId }
  }

  // Nessuna prenotazione già in agenda: se questa mail non porta
  // l'orario non si può nemmeno dedurre il servizio (pranzo/cena dipende
  // dall'ora), e indovinarlo rischierebbe di piazzare la prenotazione nel
  // servizio sbagliato, invisibile a chi gestisce quello giusto — peggio
  // che non mostrarla affatto. Resta "incompleta": compare nella coda
  // della tab Prenotazioni con tutto ciò che si sa già, pronta perché il
  // manager aggiunga solo l'orario mancante.
  if (!letta.orario) {
    return {
      esito: 'incompleta',
      evento: letta.evento,
      errore: 'Manca orario: in coda per completamento manuale',
      parziale: {
        restaurant_id:       abbinamento.restaurant_id,
        insegna:             abbinamento.codice,
        origine,
        riferimento_esterno: letta.riferimento,
        data:                letta.data,
        nome:                letta.nome,
        cognome:             letta.cognome,
        persone,
        bambini,
        sconto_percentuale:  letta.sconto_percentuale,
        telefono:            letta.telefono,
        email:               letta.email,
        note,
      },
      dettagli: {
        restaurant_id: abbinamento.restaurant_id,
        origine,
        nome:          letta.nome,
        cognome:       letta.cognome,
        data:          letta.data,
        orario:        null,
        persone,
      },
    }
  }

  const orario = normalizzaOrario(letta.orario)

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

  const { data: creata, error } = await admin
    .from('prenotazioni')
    .insert({ ...campi, stato: 'confermata' })
    .select('id')
    .single()

  if (error) return { esito: 'errore', evento: letta.evento, errore: error.message }
  return {
    esito: 'importata',
    evento: letta.evento,
    prenotazione_id: creata.id,
    nuova: true,
    dettagli: {
      restaurant_id: abbinamento.restaurant_id,
      origine,
      nome:          letta.nome,
      cognome:       letta.cognome,
      data:          letta.data,
      orario,
      persone,
    },
  }
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
// ciò che alimenta l'idempotenza (message_id UNIQUE per origine), la
// diagnostica in-app e, per l'esito 'incompleta', la coda di
// completamento manuale. Restituisce l'id della riga: la notifica push,
// quando l'esito è 'incompleta', lo usa per portare chi tocca la notifica
// dritto al modulo di completamento di QUESTA prenotazione — il log non
// esiste ancora finché lavoraMail() non è tornata, quindi quel link si
// costruisce solo qui, dopo l'insert.
export async function registraEsito(
  admin: AdminClient,
  opts: {
    origine:   'gmail' | 'cloudmailin'
    messageId: string
    threadId?: string | null
    msg:       MessaggioPrenotazione
    esito:     EsitoMail
  }
): Promise<string | null> {
  const { data } = await admin.from('prenotazioni_email_log').insert({
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
    // senza dover risalire alla casella. `parziale` alimenta la coda di
    // completamento quando presente; `debug` le parti plain/html grezze,
    // per capire perché `testo` è quello che è quando non torna.
    payload: {
      testo:    opts.msg.testo,
      parziale: opts.esito.parziale ?? null,
      debug:    opts.msg.debug ?? null,
    },
  }).select('id').single()
  return data?.id ?? null
}
