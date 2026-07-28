import { generateObject, type ModelMessage } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import type { ArticoloTipologia } from '@/types'

// Stesso modello/fallback dell'assistente Telegram e del controllo
// duplicati spese Cassa — un'unica coppia di env var per l'uso "leggero"
// di Gemini nell'app (matching articoli qui, chat Telegram, dedup spese).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash-lite'

// L'estrazione dati fattura ha una coppia separata, deliberatamente più
// pesante: qui l'accuratezza (soprattutto sul nome degli articoli, che
// finisce nel catalogo prezzi) conta più della latenza o del costo per
// richiesta — Pro legge dettagli piccoli/rovinati molto meglio di Flash.
// Il fallback su rate limit scende solo a Flash (non a Flash-Lite) per
// non sacrificare troppa qualità anche nel caso limite.
const GEMINI_MODEL_ESTRAZIONE = process.env.GEMINI_MODEL_ESTRAZIONE || 'gemini-2.5-pro'
const GEMINI_FALLBACK_MODEL_ESTRAZIONE = process.env.GEMINI_FALLBACK_MODEL_ESTRAZIONE || 'gemini-2.5-flash'

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /429|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(message)
}

async function generateWithFallback<T>(
  schema: z.ZodType<T>,
  messages: ModelMessage[],
  opts: { model: string; fallbackModel: string; temperature?: number }
) {
  try {
    return await generateObject({ model: google(opts.model), schema, messages, temperature: opts.temperature })
  } catch (err) {
    if (!isRateLimitError(err) || opts.fallbackModel === opts.model) throw err
    console.warn(`[cassa/fatture] Quota esaurita per ${opts.model}, passo a ${opts.fallbackModel}`)
    return await generateObject({ model: google(opts.fallbackModel), schema, messages, temperature: opts.temperature })
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

export const FatturaEstrattaSchema = z.object({
  data: z.string().describe('Data del documento, formato yyyy-MM-dd'),
  fornitore_nome: z.string().describe('Ragione sociale del fornitore/emittente'),
  fornitore_partita_iva: z.string().nullable().describe('Partita IVA del fornitore se presente sul documento, altrimenti null'),
  numero_documento: z.string().describe('Numero della fattura/documento'),
  ha_articoli: z.boolean().describe(
    "true se il documento riporta un elenco di articoli/prodotti con quantità e prezzi riga (es. fattura di un fornitore alimentare o di attrezzature); " +
    "false se è un documento di spesa diretta senza dettaglio articoli (es. bolletta utenze, canone, intervento di manutenzione a corpo)"
  ),
  iva_dettaglio: z.array(AliquotaEstrattaSchema).describe('Una riga per ciascuna aliquota IVA distinta presente nel documento'),
  articoli: z.array(ArticoloEstrattoSchema).describe('Elenco articoli — vuoto se ha_articoli è false'),
})

export type FatturaEstratta = z.infer<typeof FatturaEstrattaSchema>

interface FotoInput {
  buffer: ArrayBuffer
  mediaType: string
}

export async function estraiFattura(foto: FotoInput[]): Promise<FatturaEstratta> {
  const { object } = await generateWithFallback(
    FatturaEstrattaSchema,
    [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Sei un assistente esperto nella lettura di fatture e documenti di spesa italiani, fotografati da un ristorante col telefono — quindi spesso con inquadratura leggermente storta, riflessi o testo piccolo. Le immagini allegate sono le pagine, in ordine, di un unico documento (potrebbero essere solo pagina fronte, o fronte+retro, o più pagine di un elenco articoli lungo). L'accuratezza conta più della velocità: prenditi tutto il tempo che serve per leggere con calma, non dare mai la prima lettura plausibile se puoi guardare meglio.

Leggi ogni numero cifra per cifra, senza arrotondare né stimare un valore che è effettivamente leggibile: se c'è scritto "12,50" è 12.50, non 12 o 13. Le fatture italiane usano la virgola come separatore decimale e talvolta il punto come separatore delle migliaia (es. "1.234,56" = 1234.56) — non confonderli tra loro. Ricontrolla mentalmente che netto + IVA torni (circa) con il totale prima di rispondere: se il conto non torna, è un segnale che hai letto male una cifra da qualche parte, quindi rileggi con più attenzione prima di dare la risposta finale.

Il nome di ogni articolo è il dato più importante di tutti: finisce in un catalogo prezzi e viene confrontato automaticamente con le fatture successive dello stesso fornitore, quindi anche un piccolo errore di trascrizione (una lettera sbagliata, un'abbreviazione sciolta o accorciata diversamente, uno spazio in più o in meno) crea un articolo duplicato invece di riconoscere quello giusto. Trascrivi il nome carattere per carattere, esattamente come stampato — non correggere refusi apparenti, non espandere abbreviazioni, non "ripulire" il testo. Presta particolare attenzione ai caratteri che si confondono facilmente: 0 (zero) vs O (lettera), 1 (uno) vs l (elle) vs I (i maiuscola), numeri e lettere accentate italiane (à è é ì ò ù). Se il testo è sfocato o troppo piccolo per essere certi al 100%, scegli comunque la lettura più fedele possibile ai tratti visibili, invece di sostituirla con una parola "che avrebbe senso".

Se il documento riporta un elenco di articoli, leggi la tabella riga per riga dall'alto verso il basso, con calma, senza saltarne o unirne due insieme anche se il testo è piccolo o poco nitido — zoomando mentalmente sui dettagli di ogni riga prima di passare alla successiva. Non includere nell'elenco articoli le righe che sono chiaramente un totale, uno sconto, una nota o un'intestazione di colonna: sono articoli solo le righe di prodotto vero e proprio.

Se un valore non è leggibile o non è presente sul documento, usa la stima più ragionevole per i numeri e una stringa vuota per il testo — ma non inventare mai un numero di documento o una partita IVA se non sono scritti da nessuna parte.`,
          },
          ...foto.map(f => ({ type: 'image' as const, image: f.buffer, mediaType: f.mediaType })),
        ],
      },
    ],
    // Temperatura bassa: per un compito di trascrizione fedele conviene
    // che il modello riporti quello che vede, non che "arrotondi" verso
    // la variante testuale più probabile/comune.
    { model: GEMINI_MODEL_ESTRAZIONE, fallbackModel: GEMINI_FALLBACK_MODEL_ESTRAZIONE, temperature: 0.1 }
  )
  return object
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
