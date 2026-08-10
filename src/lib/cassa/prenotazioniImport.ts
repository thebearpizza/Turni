import { servizioDaOrario, normalizzaOrario } from '@/lib/cassa/prenotazioniAgenda'
import { abbinaInsegna, insegnaPrincipale, type Insegna } from '@/lib/cassa/prenotazioniLocali'
import type { RigaImportata } from '@/lib/cassa/prenotazioniParsing'
import type { DatiParziali } from '@/lib/cassa/prenotazioniEmailProcessing'
import type { PrenotazioneStato } from '@/types'

// Tutto ciò che va fatto sulle righe lette dall'AI prima di mostrarle in
// anteprima: coperti, doppioni e quadratura col riepilogo del documento.
// Vive qui e non nella route perché è la parte su cui un errore non si
// vede — un coperto sbagliato non fa fallire nulla, arriva solo un tavolo
// più grande del previsto — e quindi è la parte che va testata.

export interface PrenotazioneEsistente {
  data:    string
  orario:  string
  nome:    string
  cognome: string | null
}

// Una voce in coda di completamento (esito 'incompleta' in
// prenotazioni_email_log): TheFork/Restoo non scrivevano l'orario nella
// notifica, ma l'export completo del libro visite ce l'ha per forza —
// se un giorno il locale importa quell'export, l'orario mancante si trova
// lì, senza dover ricompilare a mano ciò che si sa già.
export interface VoceCoda {
  logId:    string
  parziale: DatiParziali
}

export interface RigaPreparata {
  restaurant_id:      string
  insegna:            string | null
  // Sempre la fonte vera (TheFork/Restoo), mai un generico "import": il
  // manager la dichiara scegliendo da quale gestionale viene il file
  // caricato, così la riga usa la stessa icona F/R delle prenotazioni
  // arrivate via mail — nessuna terza icona per "importata".
  origine:            DatiParziali['origine']
  riferimento_esterno: string | null
  data:               string
  orario:             string
  servizio:           ReturnType<typeof servizioDaOrario>
  nome:               string
  cognome:            string | null
  persone:            number
  bambini:            number
  sconto_percentuale: number | null
  telefono:           string | null
  email:              string | null
  note:               string | null
  stato:              PrenotazioneStato
  // Solo anteprima: non sono colonne della tabella.
  duplicato:          string | null
  avviso:             string | null
  // Presente quando questa riga completa una voce in coda: dopo l'insert
  // va anche aggiornato il log (esito → importata) con l'id della riga.
  completaLogId:      string | null
}

export interface Verifica {
  paxCalcolati:         number
  paxDichiarati:        number | null
  righeLette:           number
  righeDichiarate:      number | null
  quadra:               boolean
  confrontoDisponibile: boolean
}

// Una voce di coda il cui giorno compare nell'export ma che nessuna riga
// importata ha completato: se il file contiene almeno una prenotazione
// per quel giorno lo si tratta come l'elenco vero di ciò che è ancora
// attivo — quindi questa è quasi certamente una prenotazione cancellata
// prima di ricevere un orario (mai più trovabile in un futuro export,
// che per definizione lista solo le prenotazioni ancora attive), non
// una che aspetta semplicemente un file più recente. Segnalata, non
// chiusa in automatico: un export incompleto per quel giorno la
// farebbe sparire a torto.
export interface VoceCodaOrfana {
  logId:   string
  nome:    string
  cognome: string | null
  data:    string
  persone: number
}

// Chiave di confronto per i doppioni: stesso giorno e stesso cliente.
// Volutamente NON include l'orario — reimportare un export dopo che una
// prenotazione è stata spostata deve riconoscerla come la stessa, non
// crearne una seconda.
export function chiaveCliente(nome: string, cognome: string | null | undefined): string {
  return `${nome} ${cognome ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function preparaImport(opts: {
  // Ogni riga porta già con sé la fonte vera del proprio file (thefork o
  // restoo): un unico import può caricare file di entrambi i gestionali
  // insieme, quindi la fonte non può più essere un valore unico per
  // l'intera chiamata — va dichiarata riga per riga da chi la costruisce
  // (la route, in base a quale dei due selettori file l'ha ricevuta).
  righe:            (RigaImportata & { fonte: DatiParziali['origine'] })[]
  paxDichiarati:    number | null
  righeDichiarate:  number | null
  restaurantId:     string
  insegne:          Insegna[]
  esistenti:        PrenotazioneEsistente[]
  // Voci in coda dello stesso locale a cui manca solo l'orario: se
  // l'export importato ne contiene una (stesso giorno, stesso cliente),
  // questa riga la completa invece di generarne una seconda.
  coda:             VoceCoda[]
}): { prenotazioni: RigaPreparata[]; scartate: number; verifica: Verifica; codaSenzaRiscontro: VoceCodaOrfana[] } {
  const insegnaDefault = insegnaPrincipale(opts.insegne)?.codice ?? null

  const complete = opts.righe.filter(r => r.nome && r.data && r.orario)

  const inAgenda = new Map<string, PrenotazioneEsistente>()
  for (const e of opts.esistenti) {
    inAgenda.set(`${e.data}|${chiaveCliente(e.nome, e.cognome)}`, e)
  }

  const inCoda = new Map<string, VoceCoda>()
  for (const v of opts.coda) {
    inCoda.set(`${v.parziale.data}|${chiaveCliente(v.parziale.nome, v.parziale.cognome)}`, v)
  }

  const vistiNelFile = new Set<string>()

  const prenotazioni = complete.map<RigaPreparata>(r => {
    const orario = normalizzaOrario(r.orario!)
    const bambini = r.bambini ?? 0
    // persone = coperti TOTALI, bambini inclusi: "10/9" sul libro visite
    // sono 19 a tavola. Quando i coperti non sono stati letti si lascia 0
    // e si segnala: uno zero in agenda si vede, un "1" di ripiego no.
    const persone = r.adulti != null ? r.adulti + bambini : 0

    const chiave = `${r.data}|${chiaveCliente(r.nome!, r.cognome)}`
    let duplicato: string | null = null

    const gia = inAgenda.get(chiave)
    if (gia) {
      duplicato = normalizzaOrario(gia.orario) !== orario
        ? `Già in agenda alle ${normalizzaOrario(gia.orario)}`
        : 'Già in agenda'
    } else if (vistiNelFile.has(chiave)) {
      duplicato = 'Ripetuta più volte in questo import'
    } else {
      vistiNelFile.add(chiave)
    }

    // Non ancora in agenda: forse è proprio la prenotazione che aspettava
    // solo l'orario. Se la voce in coda coincide si eredita la sua fonte
    // vera (origine + riferimento_esterno) invece di "import" — così una
    // futura mail di modifica da TheFork/Restoo la ritrova ancora.
    const daCoda = !gia ? inCoda.get(chiave) : undefined

    return {
      restaurant_id:      opts.restaurantId,
      insegna:            abbinaInsegna(opts.insegne, r.locale)?.codice ?? insegnaDefault,
      origine:            daCoda?.parziale.origine ?? r.fonte,
      riferimento_esterno: daCoda?.parziale.riferimento_esterno ?? null,
      data:               r.data!,
      orario,
      servizio:           servizioDaOrario(orario),
      nome:               r.nome!,
      cognome:            r.cognome,
      persone,
      bambini,
      sconto_percentuale: r.sconto_percentuale,
      telefono:           r.telefono,
      email:              r.email,
      note:               r.note,
      stato:              (r.stato ?? 'confermata') as PrenotazioneStato,
      duplicato,
      avviso:             r.adulti == null ? 'Coperti non letti dal file: da inserire a mano' : null,
      completaLogId:      daCoda?.logId ?? null,
    }
  })

  // Quadratura col riepilogo del documento ("7 prenotazioni / 47 PAX"):
  // è l'unico modo per accorgersi di un coperto letto male prima che
  // finisca in agenda, invece di fidarsi della lettura.
  const paxCalcolati = prenotazioni.reduce((tot, p) => tot + p.persone, 0)
  const quadraPax   = opts.paxDichiarati == null || opts.paxDichiarati === paxCalcolati
  const quadraRighe = opts.righeDichiarate == null || opts.righeDichiarate === prenotazioni.length

  const giorniCoperti = new Set(prenotazioni.map(p => p.data))
  const logIdAbbinati = new Set(prenotazioni.map(p => p.completaLogId).filter((id): id is string => id !== null))
  const codaSenzaRiscontro: VoceCodaOrfana[] = opts.coda
    .filter(v => giorniCoperti.has(v.parziale.data) && !logIdAbbinati.has(v.logId))
    .map(v => ({ logId: v.logId, nome: v.parziale.nome, cognome: v.parziale.cognome, data: v.parziale.data, persone: v.parziale.persone }))

  return {
    prenotazioni,
    scartate: opts.righe.length - complete.length,
    verifica: {
      paxCalcolati,
      paxDichiarati:   opts.paxDichiarati,
      righeLette:      prenotazioni.length,
      righeDichiarate: opts.righeDichiarate,
      quadra:          quadraPax && quadraRighe,
      // Nessun riepilogo nel documento → non c'è nulla con cui
      // confrontarsi, e va detto invece di far passare la lettura per
      // verificata.
      confrontoDisponibile: opts.paxDichiarati != null || opts.righeDichiarate != null,
    },
    codaSenzaRiscontro,
  }
}
