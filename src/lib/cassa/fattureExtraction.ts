import { generateObject, type ModelMessage } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import type { ArticoloTipologia } from '@/types'

// Stesso modello/fallback dell'assistente Telegram e del controllo
// duplicati spese Cassa — un'unica coppia di env var per l'uso "leggero"
// di Gemini nell'app (matching articoli qui, chat Telegram, dedup spese).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash-lite'

// Coppia separata per l'estrazione dati fattura, così da poterla alzare
// indipendentemente dal resto quando la quota Gemini lo consente.
//
// Default su Flash e NON su Pro: con la chiave attualmente in uso Pro
// risponde sempre RESOURCE_EXHAUSTED, quindi puntarci significherebbe
// solo bruciare secondi in tentativi destinati a fallire prima di
// ripiegare comunque su Flash — non un compromesso qualità/tempo, una
// perdita secca (era la causa dei 504 sulla route /estrai). Chi ha un
// piano Gemini con quota su Pro può impostare
// GEMINI_MODEL_ESTRAZIONE=gemini-2.5-pro e guadagnare accuratezza.
const GEMINI_MODEL_ESTRAZIONE = process.env.GEMINI_MODEL_ESTRAZIONE || 'gemini-2.5-flash'
const GEMINI_FALLBACK_MODEL_ESTRAZIONE = process.env.GEMINI_FALLBACK_MODEL_ESTRAZIONE || 'gemini-2.5-flash-lite'

// Budget complessivo per l'estrazione, deliberatamente sotto il
// maxDuration della route: scaduto questo, preferiamo rispondere con un
// errore JSON leggibile piuttosto che farci uccidere a metà risposta —
// una funzione terminata dalla piattaforma non produce alcun corpo, e al
// browser arriva come connessione caduta ("Errore di rete").
export const BUDGET_ESTRAZIONE_MS = 45_000

export class EstrazioneTimeoutError extends Error {
  constructor() { super('Tempo massimo di lettura superato') }
}

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /429|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(message)
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return true
  return /abort|timed? ?out/i.test(err instanceof Error ? err.message : String(err))
}

async function generateWithFallback<T>(
  schema: z.ZodType<T>,
  messages: ModelMessage[],
  opts: { model: string; fallbackModel: string; temperature?: number; budgetMs?: number }
) {
  const scadenza = opts.budgetMs ? Date.now() + opts.budgetMs : null
  // Almeno 5s al secondo tentativo: sotto quella soglia non ha senso
  // provarci nemmeno, tanto vale riportare subito l'errore.
  const rimanente = () => (scadenza ? scadenza - Date.now() : null)
  const segnale = () => {
    const ms = rimanente()
    return ms != null ? AbortSignal.timeout(Math.max(1_000, ms)) : undefined
  }

  try {
    return await generateObject({
      model: google(opts.model),
      schema,
      messages,
      temperature: opts.temperature,
      // Un solo tentativo aggiuntivo: se il modello primario è fuori
      // quota lo è anche fra due secondi, e il backoff dell'SDK
      // mangerebbe il budget che serve al fallback per lavorare davvero.
      maxRetries: 1,
      abortSignal: segnale(),
    })
  } catch (err) {
    if (isAbortError(err)) throw new EstrazioneTimeoutError()
    if (!isRateLimitError(err) || opts.fallbackModel === opts.model) throw err

    const ms = rimanente()
    if (ms != null && ms < 5_000) throw new EstrazioneTimeoutError()

    console.warn(`[cassa/fatture] Quota esaurita per ${opts.model}, passo a ${opts.fallbackModel}`)
    try {
      return await generateObject({
        model: google(opts.fallbackModel),
        schema,
        messages,
        temperature: opts.temperature,
        maxRetries: 1,
        abortSignal: segnale(),
      })
    } catch (err2) {
      if (isAbortError(err2)) throw new EstrazioneTimeoutError()
      throw err2
    }
  }
}

// ── Estrazione dati fattura da foto ─────────────────────────────────────

export const AliquotaEstrattaSchema = z.object({
  aliquota: z.number().describe('Aliquota IVA in percentuale, es. 22, 10, 4, 0'),
  imponibile: z.number().describe('Imponibile (netto) per questa aliquota'),
  iva: z.number().describe('Importo IVA per questa aliquota'),
})

export const ArticoloEstrattoSchema = z.object({
  nome: z.string().describe(
    "Nome/descrizione dell'articolo trascritto ESATTAMENTE come scritto in fattura, carattere per carattere — stessa " +
    "punteggiatura, stesse abbreviazioni, stessi eventuali errori di stampa. Non correggerlo, non normalizzarlo, non " +
    "espanderlo in un nome 'più pulito': questo testo verrà confrontato con un catalogo prodotti, quindi anche una " +
    "piccola differenza rispetto all'originale stampato è un problema concreto, non un dettaglio stilistico."
  ),
  quantita: z.number(),
  prezzo_riga: z.number().describe('Importo totale della riga (quantità × prezzo unitario)'),
  unita_misura: z.string().nullable().describe(
    "Unità di misura o formato dell'articolo così come scritto in fattura (es. 'kg', 'L', 'pz', 'cartone da 12', 'conf. 6x1L'). " +
    "null solo se davvero non è indicata da nessuna parte sulla riga — non inventarla, ma quasi sempre è presente su una fattura fornitori."
  ),
  tipologia_suggerita: z.enum(['food', 'beverage', 'detergenza', 'altro_no_food']).describe(
    "La tua migliore stima della categoria merceologica di questo articolo in base al nome — food (alimentare), beverage (bevande), " +
    "detergenza (pulizia/igiene), altro_no_food (tutto il resto: stoviglie, imballaggi, materiale non alimentare). " +
    "Fai sempre una scelta, anche se incerta: è solo un suggerimento che l'utente può correggere."
  ),
})

// Schema di una SINGOLA pagina: i dati di testata compaiono di norma
// solo sulla prima pagina e il riepilogo IVA solo sull'ultima, quindi
// qui è tutto opzionale — le pagine vengono poi ricomposte da
// unisciPagine().
const PaginaEstrattaSchema = z.object({
  data: z.string().nullable().describe('Data del documento (yyyy-MM-dd) se stampata su QUESTA pagina, altrimenti null'),
  fornitore_nome: z.string().nullable().describe('Ragione sociale del fornitore se presente su QUESTA pagina, altrimenti null'),
  fornitore_partita_iva: z.string().nullable().describe('Partita IVA del fornitore se presente su QUESTA pagina, altrimenti null'),
  numero_documento: z.string().nullable().describe('Numero della fattura/documento se presente su QUESTA pagina, altrimenti null'),
  iva_dettaglio: z.array(AliquotaEstrattaSchema).describe(
    'Righe del riepilogo IVA per aliquota, SOLO se il riepilogo è stampato su questa pagina (di solito sull\'ultima). Array vuoto altrimenti.'
  ),
  articoli: z.array(ArticoloEstrattoSchema).describe(
    'Righe di prodotto presenti su QUESTA pagina. Array vuoto se la pagina non contiene una tabella di articoli (es. pagina di sole condizioni contrattuali, o bolletta a corpo).'
  ),
})

export interface FatturaEstratta {
  data: string
  fornitore_nome: string
  fornitore_partita_iva: string | null
  numero_documento: string
  ha_articoli: boolean
  iva_dettaglio: z.infer<typeof AliquotaEstrattaSchema>[]
  articoli: z.infer<typeof ArticoloEstrattoSchema>[]
}

interface FotoInput {
  buffer: ArrayBuffer
  mediaType: string
}

type PaginaEstratta = z.infer<typeof PaginaEstrattaSchema>

async function estraiPagina(foto: FotoInput, numero: number, totale: number): Promise<PaginaEstratta> {
  const contesto = totale > 1
    ? `L'allegato è l'elemento ${numero} di ${totale} che compongono insieme questo documento (ogni elemento è una foto di una pagina oppure un PDF — se è un PDF con più pagine, leggile tutte, fanno parte di questo stesso elemento). Estrai SOLO quello che è effettivamente presente in QUESTO elemento: i dati di testata (fornitore, numero, data) di norma stanno solo all'inizio del documento e il riepilogo IVA solo alla fine, quindi è del tutto normale che qui manchino — in quel caso usa null / array vuoti invece di dedurli o inventarli. Gli elementi mancanti li ricompone il sistema.`
    : `L'allegato è l'unico elemento del documento: una foto oppure un PDF — se è un PDF con più pagine, leggile tutte.`

  // PDF: mandato al modello come file nativo (Gemini legge tutte le
  // pagine del PDF da sé). Immagine: come parte 'image', invariato.
  const parteDocumento = foto.mediaType === 'application/pdf'
    ? { type: 'file' as const, data: foto.buffer, mediaType: foto.mediaType }
    : { type: 'image' as const, image: foto.buffer, mediaType: foto.mediaType }

  const { object } = await generateWithFallback(
    PaginaEstrattaSchema,
    [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Sei un assistente esperto nella lettura di fatture e documenti di spesa italiani — spesso foto scattate da un ristorante col telefono (quindi con inquadratura leggermente storta, riflessi o testo piccolo), talvolta invece PDF già digitali. ${contesto} L'accuratezza conta più della velocità: prenditi tutto il tempo che serve per leggere con calma, non dare mai la prima lettura plausibile se puoi guardare meglio.

Leggi ogni numero cifra per cifra, senza arrotondare né stimare un valore che è effettivamente leggibile: se c'è scritto "12,50" è 12.50, non 12 o 13. Le fatture italiane usano la virgola come separatore decimale e talvolta il punto come separatore delle migliaia (es. "1.234,56" = 1234.56) — non confonderli tra loro.

Il nome di ogni articolo è il dato più importante di tutti: finisce in un catalogo prezzi e viene confrontato automaticamente con le fatture successive dello stesso fornitore, quindi anche un piccolo errore di trascrizione (una lettera sbagliata, un'abbreviazione sciolta o accorciata diversamente, uno spazio in più o in meno) crea un articolo duplicato invece di riconoscere quello giusto. Trascrivi il nome carattere per carattere, esattamente come stampato — non correggere refusi apparenti, non espandere abbreviazioni, non "ripulire" il testo. Presta particolare attenzione ai caratteri che si confondono facilmente: 0 (zero) vs O (lettera), 1 (uno) vs l (elle) vs I (i maiuscola), numeri e lettere accentate italiane (à è é ì ò ù). Se il testo è sfocato o troppo piccolo per essere certi al 100%, scegli comunque la lettura più fedele possibile ai tratti visibili, invece di sostituirla con una parola "che avrebbe senso".

Se questa pagina riporta un elenco di articoli, leggi la tabella riga per riga dall'alto verso il basso, con calma, senza saltarne o unirne due insieme anche se il testo è piccolo o poco nitido. Non includere fra gli articoli le righe che sono chiaramente un totale, uno sconto, una nota o un'intestazione di colonna: sono articoli solo le righe di prodotto vero e proprio. Se la pagina non contiene alcuna tabella di prodotti (per esempio riporta solo condizioni contrattuali, o è una bolletta a corpo), restituisci semplicemente un elenco articoli vuoto.

Non inventare mai un numero di documento o una partita IVA che non siano scritti su questa pagina.`,
          },
          parteDocumento,
        ],
      },
    ],
    // Temperatura bassa: per un compito di trascrizione fedele conviene
    // che il modello riporti quello che vede, non che "arrotondi" verso
    // la variante testuale più probabile/comune.
    {
      model: GEMINI_MODEL_ESTRAZIONE,
      fallbackModel: GEMINI_FALLBACK_MODEL_ESTRAZIONE,
      temperature: 0.1,
      budgetMs: BUDGET_ESTRAZIONE_MS,
    }
  )
  return object
}

function unisciPagine(pagine: PaginaEstratta[]): FatturaEstratta {
  const primoValorizzato = (valori: (string | null)[]) => valori.find(v => v?.trim())?.trim() ?? ''

  // Riepilogo IVA: si prende quello dell'ULTIMA pagina che ne ha uno —
  // sulle fatture multipagina il recap sta in fondo, e le pagine
  // intermedie possono riportare subtotali parziali che non vanno
  // sommati a quello finale.
  const ivaDettaglio = [...pagine].reverse().find(p => p.iva_dettaglio.length > 0)?.iva_dettaglio ?? []

  // Articoli concatenati nell'ordine delle pagine.
  const articoli = pagine.flatMap(p => p.articoli)

  return {
    data: primoValorizzato(pagine.map(p => p.data)),
    fornitore_nome: primoValorizzato(pagine.map(p => p.fornitore_nome)),
    fornitore_partita_iva: pagine.find(p => p.fornitore_partita_iva?.trim())?.fornitore_partita_iva?.trim() ?? null,
    numero_documento: primoValorizzato(pagine.map(p => p.numero_documento)),
    // Derivato invece che chiesto al modello: se non è stata letta
    // nessuna riga di prodotto su nessuna pagina il documento si comporta
    // come una spesa diretta (l'utente sceglie la categoria a mano), che
    // è anche la degradazione giusta se l'OCR non è riuscito a leggere la
    // tabella.
    ha_articoli: articoli.length > 0,
    iva_dettaglio: ivaDettaglio,
    articoli,
  }
}

export async function estraiFattura(foto: FotoInput[]): Promise<FatturaEstratta> {
  const inizio = Date.now()

  // Una richiesta per pagina, in parallelo. Il collo di bottiglia è la
  // generazione della risposta (un elenco articoli lungo), quindi
  // mandare tre pagine in un'unica richiesta costa quanto la somma delle
  // tre e sfora il tempo massimo della funzione; in parallelo il costo è
  // quello della pagina più lenta. In più ogni chiamata ha molto meno da
  // leggere, il che aiuta anche la precisione — che è la priorità qui.
  const pagine = await Promise.all(foto.map((f, i) => estraiPagina(f, i + 1, foto.length)))

  const unita = unisciPagine(pagine)
  console.log(
    `[cassa/fatture] estratte ${foto.length} pagine in ${Date.now() - inizio}ms, ${unita.articoli.length} articoli`
  )
  return unita
}

// ── Matching semantico articoli vs catalogo esistente ───────────────────

const MatchArticoloSchema = z.object({
  testo_estratto: z.string().describe("Il testo esatto dell'articolo, identico a quello fornito in input"),
  esito: z.enum(['chiaro', 'ambiguo', 'nuovo']).describe(
    "'chiaro' se corrisponde senza dubbio a un candidato, 'ambiguo' se potrebbe essere un candidato ma non è certo (es. grammatura o formato diversi), 'nuovo' se non corrisponde a nessun candidato"
  ),
  candidato_indice: z.number().nullable().describe(
    "Indice (0-based) del candidato corrispondente nell'elenco fornito PER QUESTO fornitore, se esito è 'chiaro' o 'ambiguo'. null se esito è 'nuovo'."
  ),
})

const MatchResultSchema = z.object({
  risultati: z.array(MatchArticoloSchema),
})

export interface CandidatoArticolo {
  id: string
  nome_articolo: string
}

export interface MatchArticoloEsito {
  testo_estratto: string
  esito: 'chiaro' | 'ambiguo' | 'nuovo'
  catalogo_articolo_id: string | null
}

// Confronta ogni testo estratto con il catalogo esistente per lo stesso
// fornitore. Valida l'indice restituito dal modello contro l'elenco reale
// dei candidati (stessa disciplina di spesa-duplicati: mai fidarsi
// ciecamente di un riferimento restituito dal modello).
export async function matchArticoli(
  testiEstratti: string[],
  candidati: CandidatoArticolo[]
): Promise<MatchArticoloEsito[]> {
  if (testiEstratti.length === 0) return []

  if (candidati.length === 0) {
    return testiEstratti.map(t => ({ testo_estratto: t, esito: 'nuovo', catalogo_articolo_id: null }))
  }

  const { object } = await generateWithFallback(
    MatchResultSchema,
    [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Sei un assistente che riconosce articoli duplicati nel catalogo prodotti di un fornitore per un ristorante italiano.

Articoli appena estratti da una nuova fattura dello stesso fornitore:
${testiEstratti.map((t, i) => `${i}. "${t}"`).join('\n')}

Catalogo articoli già registrati per questo fornitore (indice: nome):
${candidati.map((c, i) => `${i}. "${c.nome_articolo}"`).join('\n')}

Per ciascun articolo estratto, indica se corrisponde a un articolo già a catalogo (stesso prodotto, anche con formulazione diversa — es. "Mozzarella fior di latte 1kg" e "Mozzarella FDL kg1" sono lo stesso articolo), è ambiguo (potrebbe essere lo stesso ma con differenze che contano, es. formato o confezione diversi), oppure è un articolo nuovo mai visto per questo fornitore. Non inventare indici che non esistono nell'elenco.`,
          },
        ],
      },
    ],
    { model: GEMINI_MODEL, fallbackModel: GEMINI_FALLBACK_MODEL }
  )

  return object.risultati.map(r => {
    const idx = r.candidato_indice
    const candidato = idx != null && idx >= 0 && idx < candidati.length ? candidati[idx] : null
    return {
      testo_estratto: r.testo_estratto,
      esito: candidato ? r.esito : 'nuovo',
      catalogo_articolo_id: candidato?.id ?? null,
    }
  })
}

export type { ArticoloTipologia }
