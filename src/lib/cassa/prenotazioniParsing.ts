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

export function aiConfigurata(): boolean {
  return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
}

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /429|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(message)
}

async function generaConFallback<T>(schema: z.ZodType<T>, messages: ModelMessage[]) {
  try {
    return await generateObject({ model: google(GEMINI_MODEL), schema, messages, temperature: 0, maxRetries: 1 })
  } catch (err) {
    if (!isRateLimitError(err) || GEMINI_FALLBACK_MODEL === GEMINI_MODEL) throw err
    console.warn(`[cassa/prenotazioni] Quota esaurita per ${GEMINI_MODEL}, passo a ${GEMINI_FALLBACK_MODEL}`)
    return generateObject({ model: google(GEMINI_FALLBACK_MODEL), schema, messages, temperature: 0, maxRetries: 1 })
  }
}

// ── Campi comuni a una prenotazione letta da qualsiasi fonte ─────────
const CampiPrenotazione = {
  nome: z.string().nullable().describe('Nome di battesimo del cliente. null se non deducibile.'),
  cognome: z.string().nullable().describe('Cognome del cliente, null se non indicato o se il nome è riportato come unica stringa non separabile.'),
  data: z.string().nullable().describe(
    'Data della prenotazione in formato yyyy-MM-dd. Se il testo usa un riferimento relativo ("oggi", "domani", "questa sera") ' +
    'risolvilo rispetto alla data di riferimento fornita nel messaggio. Attenzione al formato italiano gg/mm/aaaa.'
  ),
  orario: z.string().nullable().describe("Orario di arrivo in formato HH:mm su 24 ore (es. '20:30')."),
  persone: z.number().int().nullable().describe('Numero di persone/coperti adulti della prenotazione.'),
  bambini: z.number().int().nullable().describe('Numero di bambini, quando indicato separatamente dagli adulti. null o 0 se non indicato.'),
  sconto_percentuale: z.number().nullable().describe(
    "Percentuale di sconto promozionale applicata alla prenotazione (tipica di TheFork, es. 30 per '-30% sul cibo'). " +
    'Solo il numero, senza segno né simbolo. null se la prenotazione non ha promozioni.'
  ),
  telefono: z.string().nullable().describe('Numero di telefono del cliente, se presente.'),
  email: z.string().nullable().describe('Email del cliente, se presente.'),
  note: z.string().nullable().describe(
    'Richieste particolari, allergie, occasione, sala richiesta, note del cliente o del gestionale. Sintetiche, in italiano. null se non ce ne sono.'
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
  prenotazioni: z.array(RigaImportataSchema).describe(
    'Una voce per ogni prenotazione presente nel documento. Array vuoto se il documento non contiene prenotazioni.'
  ),
})

export type RigaImportata = z.infer<typeof RigaImportataSchema>

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
}): Promise<RigaImportata[]> {
  const istruzioni =
    "Questo file è l'esportazione delle prenotazioni dal libro visite di un ristorante italiano " +
    `(file: "${opts.nomeFile}"). Estrai TUTTE le prenotazioni che contiene, una voce per riga/prenotazione.\n\n` +
    'Le intestazioni delle colonne cambiano da gestionale a gestionale: interpretane il significato invece di ' +
    'cercare nomi esatti. Ignora righe di totale, intestazioni ripetute e righe vuote. ' +
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

  const { object } = await generaConFallback(ImportSchema, [{ role: 'user', content }])
  return object.prenotazioni
}
