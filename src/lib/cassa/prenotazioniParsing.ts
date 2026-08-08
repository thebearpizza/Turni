import { generateObject, type ModelMessage } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'

// Interpretazione AI delle prenotazioni, sia quelle che arrivano via
// mail dai due libri visite sia quelle importate da un file.
//
// Perché AI e non espressioni regolari: TheFork e Restoo hanno layout
// mail diversi fra loro, li cambiano senza preavviso e le stesse mail
// esistono in più varianti (nuova prenotazione, modifica, disdetta,
// promemoria). Un parser a regole andrebbe riscritto a ogni restyling e
// fallirebbe in silenzio; qui invece il testo grezzo resta salvato nel
// log, quindi una mail non interpretata si può sempre rileggere dopo.

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash-lite'

// L'import da file legge una tabella fitta di numeri che si somigliano
// (coperti, numero di tavolo, storico visite, orario): usa la coppia
// "estrazione", la stessa delle fatture, così si può alzare a Pro senza
// toccare il resto delle funzioni AI.
const GEMINI_MODEL_ESTRAZIONE = process.env.GEMINI_MODEL_ESTRAZIONE || 'gemini-2.5-flash'
const GEMINI_FALLBACK_MODEL_ESTRAZIONE = process.env.GEMINI_FALLBACK_MODEL_ESTRAZIONE || 'gemini-2.5-flash-lite'

export function aiConfigurata(): boolean {
  return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
}

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /429|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(message)
}

async function generaConFallback<T>(
  schema: z.ZodType<T>,
  messages: ModelMessage[],
  modelli: { model: string; fallback: string } = { model: GEMINI_MODEL, fallback: GEMINI_FALLBACK_MODEL }
) {
  try {
    return await generateObject({ model: google(modelli.model), schema, messages, temperature: 0, maxRetries: 1 })
  } catch (err) {
    if (!isRateLimitError(err) || modelli.fallback === modelli.model) throw err
    console.warn(`[cassa/prenotazioni] Quota esaurita per ${modelli.model}, passo a ${modelli.fallback}`)
    return generateObject({ model: google(modelli.fallback), schema, messages, temperature: 0, maxRetries: 1 })
  }
}

// Come i libri visite scrivono i coperti, e con quali altri numeri della
// stessa riga si confondono. Ripetuto in entrambi i prompt perché è
// l'unico campo su cui un errore è invisibile a valle: un nome sbagliato
// si nota, "1 coperto" invece di 5 no, finché il tavolo non arriva.
const REGOLE_COPERTI =
  'COPERTI — leggi questo campo con la massima attenzione, è quello su cui non è ammesso sbagliare.\n' +
  'I coperti sono scritti in due modi soltanto:\n' +
  '  • un numero singolo, es. "5" → 5 adulti, 0 bambini;\n' +
  '  • due numeri separati da barra, es. "10/9" o "3/1" → il PRIMO sono gli adulti, il SECONDO i bambini ' +
  '(10/9 = 10 adulti e 9 bambini). Non è una frazione, non è un intervallo, non è "tavolo/persone".\n' +
  'Nella stessa riga compaiono altri numeri che NON sono i coperti e non vanno mai confusi con essi:\n' +
  '  • il numero di TAVOLO, di solito isolato in un riquadro a destra o preceduto dalla parola "TAVOLO";\n' +
  '  • lo storico del cliente, scritto come numero seguito da "g" (es. "3 g", "20 g", "0 g"): indica quante ' +
  'volte è già venuto, non quante persone sono;\n' +
  '  • l\'orario di arrivo (es. 20:00, 21:30) e il numero di telefono;\n' +
  '  • fasce d\'età o note tipo "60+".\n' +
  'Se il campo coperti non è leggibile con certezza, lascia adulti a null: NON tirare a indovinare e non ' +
  'mettere 1 come ripiego. Un valore mancante viene segnalato, un valore inventato no.'


// ── Campi comuni a una prenotazione letta da qualsiasi fonte ─────────
const CampiPrenotazione = {
  nome: z.string().nullable().describe('Nome di battesimo del cliente. null se non deducibile.'),
  cognome: z.string().nullable().describe('Cognome del cliente, null se non indicato o se il nome è riportato come unica stringa non separabile.'),
  data: z.string().nullable().describe(
    'Data della prenotazione in formato yyyy-MM-dd. Se il testo usa un riferimento relativo ("oggi", "domani", "questa sera") ' +
    'risolvilo rispetto alla data di riferimento fornita nel messaggio. Attenzione al formato italiano gg/mm/aaaa.'
  ),
  orario: z.string().nullable().describe("Orario di arrivo in formato HH:mm su 24 ore (es. '20:30')."),
  adulti: z.number().int().nullable().describe(
    'Numero di ADULTI della prenotazione: il numero singolo, oppure il primo dei due separati da barra. ' +
    'null se il campo coperti non è leggibile con certezza — mai 1 come ripiego.'
  ),
  bambini: z.number().int().nullable().describe(
    'Numero di BAMBINI: il secondo numero dopo la barra (es. in "10/9" è 9). 0 quando i coperti sono un numero singolo.'
  ),
  sconto_percentuale: z.number().nullable().describe(
    "Percentuale di sconto promozionale applicata alla prenotazione (tipica di TheFork, es. 30 per '-30% sul cibo'). " +
    'Solo il numero, senza segno né simbolo. null se la prenotazione non ha promozioni.'
  ),
  telefono: z.string().nullable().describe('Numero di telefono del cliente, se presente.'),
  email: z.string().nullable().describe('Email del cliente, se presente.'),
  note: z.string().nullable().describe(
    'SOLO note del cliente: richieste particolari, allergie/intolleranze, occasione (compleanno, anniversario...), ' +
    'sala o tavolo richiesto, altre indicazioni scritte per il servizio. Sintetiche, in italiano. ' +
    'NON va in questo campo: sigle, codici o marcatori interni del gestionale (es. una lettera isolata come "P" o "T", ' +
    'una spunta, un flag), il canale con cui è arrivata la prenotazione, il numero di tavolo assegnato, lo storico ' +
    'visite. Se non è chiaramente una nota scritta per il cliente, lascia null: un campo vuoto è meglio di un codice ' +
    'interno scambiato per una richiesta del cliente.'
  ),
}

// ── Mail dei libri visite ────────────────────────────────────────────
const EmailSchema = z.object({
  e_prenotazione: z.boolean().describe(
    'true SOLO se questa mail riguarda una specifica prenotazione di un tavolo (nuova, modificata o disdetta). ' +
    'false per tutto il resto che arriva dagli stessi mittenti: riepiloghi/report incassi, notifiche di pagamento ' +
    'ricevuto, fatture e ricevute di abbonamento, recensioni, newsletter, comunicazioni commerciali, avvisi tecnici.'
  ),
  evento: z.enum(['nuova', 'modifica', 'cancellazione']).nullable().describe(
    "Che cosa comunica la mail: 'nuova' per una prenotazione appena ricevuta, 'modifica' quando cambia una " +
    "prenotazione esistente (orario, coperti, nome), 'cancellazione' per disdetta/annullamento/no-show comunicato. " +
    'null se e_prenotazione è false.'
  ),
  fonte: z.enum(['thefork', 'restoo']).nullable().describe(
    "Quale libro visite ha mandato la mail, dedotto dal mittente e dal contenuto: 'thefork' (anche 'TheFork Manager', " +
    "'LaFourchette'), 'restoo'. null se non riconoscibile."
  ),
  locale: z.string().nullable().describe(
    'Nome del locale/ristorante destinatario della prenotazione, così come scritto nella mail (es. "Crunch! - Porto Rotondo", "Benthos Porto Rotondo").'
  ),
  riferimento: z.string().nullable().describe(
    'Codice/numero identificativo della prenotazione assegnato dal gestionale, se presente. ' +
    'È la chiave per collegare a questa prenotazione le mail successive di modifica o disdetta: riportalo esatto.'
  ),
  ...CampiPrenotazione,
})

export type EmailPrenotazione = z.infer<typeof EmailSchema>

export async function interpretaEmail(opts: {
  mittente: string
  oggetto: string
  testo: string
  ricevutaAt: string | null
}): Promise<EmailPrenotazione> {
  const riferimentoTemporale = opts.ricevutaAt
    ? new Date(opts.ricevutaAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)

  const { object } = await generaConFallback(EmailSchema, [
    {
      role: 'user',
      content:
        'Sei il sistema che alimenta l\'agenda prenotazioni di un ristorante italiano. Il ristorante usa due libri ' +
        'visite (TheFork e Restoo) che notificano via mail ogni prenotazione nuova, modificata o disdetta. Alla ' +
        'stessa casella però arrivano anche molte altre mail dagli stessi mittenti che NON sono prenotazioni.\n\n' +
        `Data di ricezione di questa mail: ${riferimentoTemporale} (usala per risolvere date relative come "oggi" o "domani").\n\n` +
        `${REGOLE_COPERTI}\n\n` +
        `Mittente: ${opts.mittente}\nOggetto: ${opts.oggetto}\n\nTesto della mail:\n${opts.testo}\n\n` +
        'Estrai i dati della prenotazione. Non inventare mai un valore che non è nel testo: usa null. ' +
        'Se la mail non riguarda una singola prenotazione, imposta e_prenotazione a false e lascia null tutto il resto.',
    },
  ])

  return object
}

// ── Import da file (Excel/CSV/PDF) ──────────────────────────────────
const RigaImportataSchema = z.object({
  ...CampiPrenotazione,
  locale: z.string().nullable().describe(
    'Nome del locale/insegna a cui è intestata la prenotazione, se il file lo riporta (es. "Crunch!", "Benthos"). null se il file riguarda un solo locale non specificato riga per riga.'
  ),
  stato: z.enum(['confermata', 'seduta', 'no_show', 'eliminata']).nullable().describe(
    "Stato della prenotazione se il file lo riporta: 'confermata', 'seduta' (cliente arrivato/seduto), " +
    "'no_show' (non presentato), 'eliminata' (annullata/disdetta). null quando il file non dice nulla in proposito."
  ),
})

const ImportSchema = z.object({
  // Gli export dei libri visite riportano in testa un riepilogo del tipo
  // "7 prenotazioni / 47 PAX". Farlo estrarre permette di verificare a
  // valle che la lettura quadri col documento, invece di fidarsi.
  totale_prenotazioni_dichiarato: z.number().int().nullable().describe(
    'Numero di prenotazioni dichiarato nel riepilogo del documento (es. il "7" di "7 prenotazioni / 47 PAX"). null se il documento non riporta un riepilogo.'
  ),
  totale_pax_dichiarato: z.number().int().nullable().describe(
    'Totale coperti/PAX dichiarato nel riepilogo del documento (es. il "47" di "7 prenotazioni / 47 PAX"). null se assente. ' +
    'Riportalo esattamente come stampato, senza ricalcolarlo dalle righe.'
  ),
  prenotazioni: z.array(RigaImportataSchema).describe(
    'Una voce per ogni prenotazione presente nel documento. Array vuoto se il documento non contiene prenotazioni.'
  ),
})

export type RigaImportata = z.infer<typeof RigaImportataSchema>
export type EsitoImport  = z.infer<typeof ImportSchema>

interface DocumentoInput {
  buffer: ArrayBuffer
  mediaType: string
}

// Il documento può arrivare come tabella già letta lato server
// (Excel/CSV, convertiti in testo) oppure come PDF passato al modello
// così com'è — Gemini legge i PDF nativamente, come già facciamo per le
// fatture. In entrambi i casi l'AI si occupa solo della mappatura fra
// le colonne del gestionale (che cambiano da export a export) e i campi
// dell'agenda.
export async function interpretaImport(opts: {
  testo?: string
  documento?: DocumentoInput
  nomeFile: string
  annoDiRiferimento: number
}): Promise<EsitoImport> {
  const istruzioni =
    "Questo file è l'esportazione delle prenotazioni dal libro visite di un ristorante italiano " +
    `(file: "${opts.nomeFile}"). Estrai TUTTE le prenotazioni che contiene, una voce per riga/prenotazione.\n\n` +
    'Il documento è organizzato per servizio (pranzo o cena) e, dentro il servizio, per fasce orarie; ogni ' +
    'prenotazione è un blocco che contiene nome del cliente, telefono, orario, coperti, numero di tavolo, ' +
    'storico visite e note. Le intestazioni cambiano da gestionale a gestionale: interpretane il significato ' +
    'invece di cercare nomi esatti. Ignora le righe di totale, le intestazioni di sezione (Confermate, Sedute, ' +
    "Completate, gli orari di fascia), i piè di pagina e i numeri di pagina.\n\n" +
    `${REGOLE_COPERTI}\n\n` +
    `Se una data non riporta l'anno, usa ${opts.annoDiRiferimento}. ` +
    'Non inventare valori assenti: usa null.'

  const content: ModelMessage['content'] = opts.documento
    ? [
        { type: 'text', text: istruzioni },
        opts.documento.mediaType === 'application/pdf'
          ? { type: 'file', data: opts.documento.buffer, mediaType: opts.documento.mediaType }
          : { type: 'image', image: opts.documento.buffer, mediaType: opts.documento.mediaType },
      ]
    : `${istruzioni}\n\nContenuto del file:\n${opts.testo ?? ''}`

  const { object } = await generaConFallback(
    ImportSchema,
    [{ role: 'user', content }],
    { model: GEMINI_MODEL_ESTRAZIONE, fallback: GEMINI_FALLBACK_MODEL_ESTRAZIONE }
  )
  return object
}
