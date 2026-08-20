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

// Coordinate normalizzate 0-1000 (convenzione nativa di Gemini per la
// localizzazione spaziale): (0,0) angolo in alto a sinistra della pagina,
// (1000,1000) in basso a destra. Serve a evidenziare la riga del prodotto
// nel visualizzatore fattura (icona occhio in Articoli).
const RiquadroSchema = z.object({
  y_min: z.number().int().min(0).max(1000),
  x_min: z.number().int().min(0).max(1000),
  y_max: z.number().int().min(0).max(1000),
  x_max: z.number().int().min(0).max(1000),
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
  riquadro: RiquadroSchema.nullable().describe(
    "Riquadro di delimitazione (bounding box) dell'INTERA riga di questo articolo nella pagina — nome, quantità e prezzo " +
    "compresi, non solo la parola del nome — nel formato {y_min, x_min, y_max, x_max} normalizzato da 0 a 1000. " +
    "null solo se non riesci a stimarlo con ragionevole confidenza."
  ),
  aliquota_iva: z.number().describe(
    "Aliquota IVA italiana di questo articolo in percentuale (4, 5, 10 o 22) — SEMPRE valorizzata, anche quando la " +
    "fattura non riporta un riepilogo IVA leggibile: se manca il riepilogo, questo campo diventa l'unico modo per " +
    "ricostruire i totali, quindi va comunque stimata dalla categoria merceologica del prodotto. Se la aliquota è " +
    "scritta esplicitamente su questa riga, usa quella. Altrimenti, in base al buon senso sulle aliquote italiane: " +
    "alimentari di base (pane, pasta, farina, riso, latte, verdura, frutta) sono di norma al 4%; la maggior parte " +
    "degli altri alimentari, della ristorazione e dei prodotti confezionati è al 10%; bevande alcoliche, acqua e " +
    "bibite, prodotti per pulizia/detergenza/igiene, monouso/plastica/imballaggi, stoviglie e ogni articolo non " +
    "alimentare sono quasi sempre al 22%. Nel dubbio scegli 22%, l'aliquota ordinaria: è la stima più prudente " +
    "quando non sei sicuro della categoria esatta."
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
  totale_documento: z.number().nullable().describe(
    "Il totale finale del documento, se su QUESTA pagina è scritto esplicitamente un importo conclusivo (es. accanto a 'TOTALE', " +
    "'TOTALE €', 'TOTALE DOCUMENTO', 'TOTALE FATTURA', anche scritto a mano) — indipendentemente dal fatto che la pagina riporti " +
    "anche una tabella articoli o un riepilogo IVA. Leggilo SEMPRE quando è presente, anche su documenti informali senza alcuna " +
    "tabella prodotti (es. un documento di trasporto scritto a mano con solo quantità/descrizione e un totale finale): è " +
    "l'unico modo di recuperare un importo su un documento del genere. null se questa pagina non riporta alcun totale finale."
  ),
})

export interface FatturaEstratta {
  data: string
  fornitore_nome: string
  fornitore_partita_iva: string | null
  numero_documento: string
  ha_articoli: boolean
  iva_dettaglio: z.infer<typeof AliquotaEstrattaSchema>[]
  // true quando iva_dettaglio non viene dal riepilogo stampato in
  // fattura (non trovato/non letto) ma è stato ricostruito sommando gli
  // articoli per aliquota_iva stimata — un numero plausibile, non un
  // dato letto, da segnalare come tale invece di presentarlo come certo.
  iva_stimata: boolean
  // true quando né un riepilogo IVA stampato né articoli erano
  // disponibili per ricostruire i totali, e iva_dettaglio contiene
  // un'unica riga di ripiego (aliquota 0, iva 0, imponibile = totale
  // letto) presa dal totale finale scritto sul documento — es. un
  // documento di trasporto compilato a mano senza tabella prodotti.
  totale_da_fallback: boolean
  articoli: ArticoloEstrattoConPagina[]
}

// Indice (0-based) della foto/pagina di provenienza dell'articolo
// all'interno di QUESTA fattura (== indice in foto_paths una volta
// salvata) — assegnato in unisciPagine, non chiesto al modello: ogni
// pagina viene estratta a sé (vedi estraiPagina), quindi la sua
// posizione nel gruppo è già nota al sistema, non va indovinata dall'AI.
export type ArticoloEstrattoConPagina = z.infer<typeof ArticoloEstrattoSchema> & { pagina_indice: number }

interface FotoInput {
  buffer: ArrayBuffer
  mediaType: string
}

type PaginaEstratta = z.infer<typeof PaginaEstrattaSchema>

async function estraiPagina(foto: FotoInput, numero: number, totale: number): Promise<PaginaEstratta> {
  const contesto = totale > 1
    ? `L'allegato è l'elemento ${numero} di ${totale} di un unico caricamento, ma NON dare per scontato che siano tutti la stessa fattura: l'utente può aver caricato insieme più fatture distinte, anche di fornitori diversi. Estrai SOLO quello che è effettivamente stampato su QUESTO elemento (ogni elemento è una foto di una pagina oppure un PDF — se è un PDF con più pagine, leggile tutte). Se questo elemento riporta una propria testata (fornitore e/o numero documento), è l'inizio di una fattura a sé — riportala così com'è, anche se un fornitore o numero diverso è comparso su un elemento precedente. Se invece non riporta alcuna testata (né fornitore né numero documento), è quasi certamente la continuazione della tabella articoli della fattura dell'elemento precedente: in quel caso usa null per i campi di testata invece di dedurli o copiarli da altrove. È il sistema, non tu, a ricomporre poi quali elementi appartengono a quale fattura in base a queste informazioni — quindi è fondamentale che questo giudizio (testata presente o assente) rispecchi esattamente cosa è stampato su questo elemento.`
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

Cerca sempre anche un importo finale conclusivo (di solito vicino alla parola "TOTALE", anche scritto a mano) e riportalo in totale_documento, indipendentemente da cos'altro hai trovato sulla pagina: capita che un documento — per esempio un documento di trasporto compilato a mano — non abbia affatto una tabella prodotti strutturata né un riepilogo IVA, ma riporti comunque un totale finale leggibile.

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

// Ricostruisce il riepilogo IVA raggruppando gli articoli per la loro
// aliquota_iva stimata, quando la fattura non riporta un riepilogo
// leggibile — prezzo_riga è per convenzione il netto di riga (come per
// ogni altro calcolo in questo file), quindi imponibile = somma dei
// prezzo_riga del gruppo e iva = imponibile × aliquota/100.
function calcolaIvaDaArticoli(articoli: z.infer<typeof ArticoloEstrattoSchema>[]): z.infer<typeof AliquotaEstrattaSchema>[] {
  const imponibilePerAliquota = new Map<number, number>()
  for (const a of articoli) {
    imponibilePerAliquota.set(a.aliquota_iva, (imponibilePerAliquota.get(a.aliquota_iva) ?? 0) + a.prezzo_riga)
  }
  return Array.from(imponibilePerAliquota.entries())
    .sort(([a], [b]) => b - a)
    .map(([aliquota, imponibileGrezzo]) => {
      const imponibile = Math.round(imponibileGrezzo * 100) / 100
      return { aliquota, imponibile, iva: Math.round(imponibile * aliquota) / 100 }
    })
}

function unisciPagine(pagine: PaginaEstratta[]): FatturaEstratta {
  const primoValorizzato = (valori: (string | null)[]) => valori.find(v => v?.trim())?.trim() ?? ''

  // Riepilogo IVA: si prende quello dell'ULTIMA pagina che ne ha uno —
  // sulle fatture multipagina il recap sta in fondo, e le pagine
  // intermedie possono riportare subtotali parziali che non vanno
  // sommati a quello finale.
  const ivaStampata = [...pagine].reverse().find(p => p.iva_dettaglio.length > 0)?.iva_dettaglio ?? []

  // Articoli concatenati nell'ordine delle pagine, ciascuno taggato con
  // l'indice della propria pagina ALL'INTERNO DI QUESTO GRUPPO — che
  // coincide esattamente con l'indice che avrà in foto_paths una volta
  // salvata la fattura (fotoPathsGruppo in risolviFattura è costruito
  // nello stesso ordine di questo array `pagine`).
  const articoli: ArticoloEstrattoConPagina[] = pagine.flatMap((p, paginaIndice) =>
    p.articoli.map(a => ({ ...a, pagina_indice: paginaIndice }))
  )

  // Se il riepilogo non è stato trovato/letto ma ci sono articoli con
  // un prezzo, non lasciamo i totali a zero: li ricostruiamo dalle
  // aliquote stimate per ciascun articolo (vedi calcolaIvaDaArticoli).
  const ivaStimata = ivaStampata.length === 0 && articoli.length > 0
  const ivaDaArticoli = ivaStimata ? calcolaIvaDaArticoli(articoli) : ivaStampata

  // Ultima rete: né riepilogo IVA né articoli da cui derivare un totale,
  // ma un importo finale è comunque leggibile sul documento (stesso
  // criterio "ultima pagina che ce l'ha" usato sopra per l'IVA stampata,
  // coerente sulle fatture multipagina). Senza dettaglio IVA il totale
  // letto finisce come imponibile a aliquota 0 — non è un dato IVA
  // inventato, solo il modo di non perdere un totale reale.
  const totaleDocumento = [...pagine].reverse().find(p => p.totale_documento != null)?.totale_documento ?? null
  const totaleDaFallback = ivaDaArticoli.length === 0 && totaleDocumento != null
  const ivaDettaglio = totaleDaFallback ? [{ aliquota: 0, imponibile: totaleDocumento, iva: 0 }] : ivaDaArticoli

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
    iva_stimata: ivaStimata,
    totale_da_fallback: totaleDaFallback,
    articoli,
  }
}

// Confronta due pagine per capire se appartengono alla stessa fattura:
// stesso numero_documento se entrambe lo riportano, altrimenti stesso
// fornitore_nome se entrambe lo riportano. Se nessuna delle due ha
// nessuna informazione di testata (tipico di una pagina di sola
// tabella articoli) si assume che continui la fattura corrente — la
// vera decisione "stessa fattura o no" la prende raggruppaPagine
// guardando se la pagina ha O NON ha affatto una testata.
function stessaFattura(a: PaginaEstratta, b: PaginaEstratta): boolean {
  const numA = a.numero_documento?.trim()
  const numB = b.numero_documento?.trim()
  if (numA && numB) return numA === numB
  const fornA = a.fornitore_nome?.trim()
  const fornB = b.fornitore_nome?.trim()
  if (fornA && fornB) return fornA === fornB
  return true
}

// Un caricamento può contenere più fatture distinte caricate insieme
// (anche di fornitori diversi) invece di un'unica fattura multipagina:
// raggruppa le pagine estratte confrontandole in ordine. Una pagina
// senza alcuna informazione di testata (numero_documento e
// fornitore_nome entrambi null) è per definizione una pagina di
// continuazione — testata e riepilogo IVA compaiono di norma solo
// sulla prima/ultima pagina di UN documento, mai su quelle di mezzo —
// quindi resta nel gruppo corrente. Una pagina con una testata che non
// coincide con quella del gruppo corrente apre un nuovo gruppo.
function raggruppaPagine(pagine: PaginaEstratta[]): number[][] {
  const gruppi: { pagina: PaginaEstratta; indice: number }[][] = []

  pagine.forEach((pagina, indice) => {
    const haTestata = !!(pagina.numero_documento?.trim() || pagina.fornitore_nome?.trim())
    const gruppoCorrente = gruppi[gruppi.length - 1]
    const riferimento = gruppoCorrente?.find(x => x.pagina.numero_documento?.trim() || x.pagina.fornitore_nome?.trim())?.pagina

    if (gruppoCorrente && (!haTestata || !riferimento || stessaFattura(pagina, riferimento))) {
      gruppoCorrente.push({ pagina, indice })
    } else {
      gruppi.push([{ pagina, indice }])
    }
  })

  return gruppi.map(g => g.map(x => x.indice))
}

export interface FatturaEstrattaConIndici {
  fattura: FatturaEstratta
  // Indici (0-based, nell'ordine di upload) delle foto che compongono
  // questa fattura all'interno dell'array passato a estraiFatture —
  // servono al chiamante per assegnare a ciascuna fattura solo i propri
  // foto_paths invece di tutti quelli del caricamento.
  indiciFoto: number[]
}

export async function estraiFatture(foto: FotoInput[]): Promise<FatturaEstrattaConIndici[]> {
  const inizio = Date.now()

  // Una richiesta per pagina, in parallelo. Il collo di bottiglia è la
  // generazione della risposta (un elenco articoli lungo), quindi
  // mandare tre pagine in un'unica richiesta costa quanto la somma delle
  // tre e sfora il tempo massimo della funzione; in parallelo il costo è
  // quello della pagina più lenta. In più ogni chiamata ha molto meno da
  // leggere, il che aiuta anche la precisione — che è la priorità qui.
  const pagine = await Promise.all(foto.map((f, i) => estraiPagina(f, i + 1, foto.length)))

  const gruppi = raggruppaPagine(pagine)
  const fatture = gruppi.map(indici => ({
    fattura: unisciPagine(indici.map(i => pagine[i])),
    indiciFoto: indici,
  }))

  console.log(
    `[cassa/fatture] estratte ${foto.length} pagine → ${fatture.length} fattur${fatture.length === 1 ? 'a' : 'e'} in ${Date.now() - inizio}ms, ` +
    `${fatture.reduce((s, f) => s + f.fattura.articoli.length, 0)} articoli totali`
  )
  return fatture
}

// ── Matching semantico articoli vs catalogo esistente ───────────────────

const MatchArticoloSchema = z.object({
  testo_estratto: z.string().describe("Il testo esatto dell'articolo, identico a quello fornito in input"),
  esito: z.enum(['chiaro', 'ambiguo', 'nuovo']).describe(
    "'chiaro' se è lo stesso prodotto di un candidato senza dubbio, 'ambiguo' solo se è quasi certamente lo stesso prodotto ma con grammatura/formato/confezione diversi, 'nuovo' se il nome specifico del prodotto è diverso da ogni candidato (anche se condivide una parola generica o è graficamente simile, es. 'lime' vs 'limone')"
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

Per ciascun articolo estratto, confrontalo con i candidati e scegli:

- 'chiaro': è lo STESSO prodotto, scritto in modo diverso (abbreviazioni, ordine delle parole, maiuscole) — es. "Mozzarella fior di latte 1kg" e "Mozzarella FDL kg1".
- 'ambiguo': è quasi certamente lo stesso prodotto ma con una differenza di formato/confezione/grammatura che non è chiaro se conti — es. "Passata di pomodoro 500g" vs "Passata di pomodoro 1kg" dello stesso fornitore.
- 'nuovo': è un prodotto DIVERSO, anche se il nome è simile o condivide una parola col candidato.

Attenzione agli errori più comuni: nomi che condividono solo una parola generica ("Patata Americana" vs "Patate Fioroni Bianche": varietà/marchi diversi, non lo stesso articolo) sono prodotti DIVERSI, non varianti di formato — vanno sempre 'nuovo'. Allo stesso modo, parole che si somigliano nella grafia ma indicano un ingrediente diverso ("lime"/"limes" vs "limone"/"limoni": frutti diversi) vanno sempre 'nuovo', mai 'ambiguo' o 'chiaro'. Nel dubbio tra 'ambiguo' e 'nuovo': se il nome specifico del prodotto differisce (non solo grammatura/confezione), scegli 'nuovo'. Non inventare indici che non esistono nell'elenco.`,
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
