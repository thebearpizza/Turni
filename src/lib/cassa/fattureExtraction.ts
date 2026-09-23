import { generateObject, type ModelMessage } from 'ai'
import { z } from 'zod'
import type { ArticoloTipologia } from '@/types'
import { SOGLIA_SCOSTAMENTO_TOTALE_DOCUMENTO } from './fattureVerifica'
import { MODELLO_LETTURA, MODELLO_LETTURA_RISERVA, MODELLO_ABBINAMENTO, MODELLO_ABBINAMENTO_RISERVA, risolviModello } from './modelliAi'

// Modelli (e fornitore — Gemini o Mistral) configurabili da variabile
// d'ambiente, vedi modelliAi.ts. Nota storica sul default Flash e non Pro:
// con la chiave Gemini attualmente in uso Pro risponde sempre
// RESOURCE_EXHAUSTED, quindi puntarci brucerebbe solo secondi prima di
// ripiegare comunque sulla riserva (era la causa dei 504 sulla route
// /estrai).

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
  return /429|rate.?limit|quota|RESOURCE_EXHAUSTED|503|UNAVAILABLE|overloaded|high demand|try again later/i.test(message)
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return true
  return /abort|timed? ?out/i.test(err instanceof Error ? err.message : String(err))
}

// Quota massima riservata al modello principale quando il chiamante
// dichiara un budget complessivo (solo l'estrazione fatture lo fa, vedi
// BUDGET_ESTRAZIONE_MS — matchArticoli qui sotto non passa budgetMs e
// resta quindi senza questo limite, comportamento invariato). Senza
// questo tetto un primario che diventa lento (foto difficile da leggere,
// rallentamento momentaneo lato Google) può consumare l'intero budget
// prima di fallire, lasciando zero tempo per il tentativo di riserva —
// esattamente il caso osservato in produzione ("Tempo massimo di lettura
// superato" su una singola pagina). Abortire prima garantisce che al
// modello di riserva resti sempre un margine reale per provarci.
const QUOTA_MODELLO_PRINCIPALE_MS = 30_000

// Esportata (con FotoInput sotto) per riuso da altri lettori AI che
// vogliono lo stesso ritentativo/fallback/budget — vedi
// reportChiusuraExtraction.ts.
export async function generateWithFallback<T>(
  schema: z.ZodType<T>,
  messages: ModelMessage[],
  opts: { model: string; fallbackModel: string; temperature?: number; budgetMs?: number }
) {
  const scadenza = opts.budgetMs ? Date.now() + opts.budgetMs : null
  // Almeno 5s al secondo tentativo: sotto quella soglia non ha senso
  // provarci nemmeno, tanto vale riportare subito l'errore.
  const rimanente = () => (scadenza ? scadenza - Date.now() : null)
  // capMs limita solo il tentativo sul modello PRINCIPALE (vedi
  // QUOTA_MODELLO_PRINCIPALE_MS) — quando il chiamante non dichiara un
  // budget complessivo (rimanente() === null), nessun limite si applica
  // comunque, cap incluso: comportamento identico a prima per chi non
  // passa budgetMs.
  const segnale = (capMs?: number) => {
    const ms = rimanente()
    if (ms == null) return undefined
    return AbortSignal.timeout(Math.max(1_000, capMs != null ? Math.min(ms, capMs) : ms))
  }

  try {
    return await generateObject({
      model: risolviModello(opts.model),
      schema,
      messages,
      temperature: opts.temperature,
      // Un solo tentativo aggiuntivo: se il modello primario è fuori
      // quota lo è anche fra due secondi, e il backoff dell'SDK
      // mangerebbe il budget che serve al fallback per lavorare davvero.
      maxRetries: 1,
      abortSignal: segnale(QUOTA_MODELLO_PRINCIPALE_MS),
    })
  } catch (err) {
    const scadutoPrimario = isAbortError(err)
    // Ripiega sulla riserva sia per quota esaurita sia per timeout del
    // principale: in entrambi i casi il problema è "questo modello, ora,
    // non ce la fa", non "il documento è illeggibile" — vale la pena
    // provarci con la riserva prima di arrendersi, non solo sulla quota.
    if ((!scadutoPrimario && !isRateLimitError(err)) || opts.fallbackModel === opts.model) throw err

    const ms = rimanente()
    if (ms != null && ms < 5_000) throw new EstrazioneTimeoutError()

    console.warn(`[cassa/fatture] ${scadutoPrimario ? 'Timeout' : 'Quota esaurita o modello non disponibile'} per ${opts.model}, passo a ${opts.fallbackModel}`)
    // Il sovraccarico ("high demand") è quasi sempre un picco di pochi
    // secondi: se anche la riserva lo segnala e il budget lo consente, si
    // riprova dopo una breve pausa invece di arrendersi subito — qualche
    // secondo in più costa molto meno all'utente che rifare la scansione.
    // Solo per chi dichiara un budget (lettura fatture/report), così il
    // tempo aggiunto resta sempre sotto il limite della funzione.
    for (let tentativo = 0; ; tentativo++) {
      try {
        return await generateObject({
          model: risolviModello(opts.fallbackModel),
          schema,
          messages,
          temperature: opts.temperature,
          maxRetries: 1,
          abortSignal: segnale(),
        })
      } catch (err2) {
        if (isAbortError(err2)) throw new EstrazioneTimeoutError()
        const pausa = PAUSE_RIPROVA_RISERVA_MS[tentativo]
        const restante = rimanente()
        if (!isRateLimitError(err2) || pausa == null || restante == null || restante < pausa + 10_000) throw err2
        console.warn(`[cassa/fatture] Anche ${opts.fallbackModel} sovraccarico, nuovo tentativo tra ${pausa / 1000}s`)
        await new Promise(resolve => setTimeout(resolve, pausa))
      }
    }
  }
}

const PAUSE_RIPROVA_RISERVA_MS = [3_000, 6_000]

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
  prezzo_riga: z.number().describe(
    "Importo TOTALE della riga (quantità × prezzo unitario), MAI il prezzo unitario da solo. Molte fatture fornitori " +
    "italiane stampano DUE colonne di prezzo sulla stessa riga: una 'Prezzo Unitario' (o 'Prezzo', 'P.U.', spesso per " +
    "kg/L/pz/cartone) e una 'Importo' o 'Totale Riga' (quantità × prezzo unitario, di norma la colonna più a destra, " +
    "prima di eventuali sconto/IVA). Quando vedi due valori diversi sulla stessa riga, prezzo_riga è SEMPRE quello della " +
    "colonna Importo/Totale, MAI quello della colonna Prezzo Unitario — scambiarli è l'errore più costoso possibile su " +
    "questo campo, perché sbaglia il totale finale della fattura di un fattore pari alla quantità della riga. Prima di " +
    "scrivere il valore, verifica: prezzo_riga diviso quantità deve dare un prezzo unitario plausibile per quel tipo di " +
    "prodotto — se il risultato è implausibilmente basso (es. pochi centesimi per un prodotto alimentare normale), quasi " +
    "certamente hai letto la colonna sbagliata."
  ),
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
  aliquota_letta: z.boolean().describe(
    "true se l'aliquota IVA di QUESTA riga è stampata sul documento (una colonna IVA/Aliquota/Cod. IVA accanto " +
    "all'articolo, o un'indicazione esplicita sulla riga stessa); false se l'hai stimata tu dalla categoria del prodotto."
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
  // articoli per la loro aliquota_iva — va ricalcolato se cambiano i
  // prezzi delle righe (vedi correggiArticoliSeSballati).
  iva_da_articoli: boolean
  // true solo se, oltre a essere ricostruita dalle righe, almeno una
  // aliquota non era stampata sulla riga ma stimata dalla categoria del
  // prodotto — un numero plausibile, non un dato letto, da segnalare
  // come tale. Se ogni riga riporta la propria aliquota (colonna IVA per
  // articolo, senza riquadro riepilogativo) l'IVA è letta dal documento
  // e non va segnalata come stimata.
  iva_stimata: boolean
  // true quando né un riepilogo IVA stampato né articoli erano
  // disponibili per ricostruire i totali, e iva_dettaglio contiene
  // un'unica riga di ripiego (aliquota 0, iva 0, imponibile = totale
  // letto) presa dal totale finale scritto sul documento — es. un
  // documento di trasporto compilato a mano senza tabella prodotti.
  totale_da_fallback: boolean
  // Il totale finale letto direttamente sul documento (vicino a "TOTALE"),
  // indipendentemente da come sono stati ricostruiti iva_dettaglio/gli
  // articoli — null se nessuna pagina ne riportava uno. Quando ha_articoli
  // è true questo NON è già confluito nei totali (a differenza del caso
  // totale_da_fallback): serve al chiamante come riscontro indipendente
  // per accorgersi di un errore di lettura sistematico su una riga (es.
  // prezzo unitario scambiato per l'importo di riga) che nessun controllo
  // basato sullo storico prezzi potrebbe cogliere al primo acquisto di un
  // articolo, o su una ri-scansione che ripete la stessa lettura sbagliata.
  totale_documento: number | null
  articoli: ArticoloEstrattoConPagina[]
}

// Indice (0-based) della foto/pagina di provenienza dell'articolo
// all'interno di QUESTA fattura (== indice in foto_paths una volta
// salvata) — assegnato in unisciPagine, non chiesto al modello: ogni
// pagina viene estratta a sé (vedi estraiPagina), quindi la sua
// posizione nel gruppo è già nota al sistema, non va indovinata dall'AI.
export type ArticoloEstrattoConPagina = z.infer<typeof ArticoloEstrattoSchema> & { pagina_indice: number }

export interface FotoInput {
  buffer: ArrayBuffer
  mediaType: string
}

export type PaginaEstratta = z.infer<typeof PaginaEstrattaSchema>

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

Molte righe di prodotto riportano DUE colonne di prezzo distinte: un prezzo unitario (spesso per kg/L/pz/cartone) e l'importo/totale di riga (quantità × prezzo unitario). Individua sempre quale colonna è quale — dall'intestazione della tabella quando presente, o dalla posizione (l'importo/totale è di norma la colonna più a destra) — e scrivi in prezzo_riga SEMPRE l'importo/totale della riga, mai il prezzo unitario da solo: è l'errore più costoso possibile in questo compito, perché sbaglia il totale finale della fattura di un fattore pari alla quantità.

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
      model: MODELLO_LETTURA,
      fallbackModel: MODELLO_LETTURA_RISERVA,
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
  // aliquote di ciascun articolo (vedi calcolaIvaDaArticoli) — lette
  // sulla riga quando il documento le riporta, altrimenti stimate.
  const ivaCalcolataDaArticoli = ivaStampata.length === 0 && articoli.length > 0
  const ivaStimata = ivaCalcolataDaArticoli && articoli.some(a => !a.aliquota_letta)
  const ivaDaArticoli = ivaCalcolataDaArticoli ? calcolaIvaDaArticoli(articoli) : ivaStampata

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
    iva_da_articoli: ivaCalcolataDaArticoli,
    iva_stimata: ivaStimata,
    totale_da_fallback: totaleDaFallback,
    totale_documento: totaleDocumento,
    articoli,
  }
}

const CorrezionePrezziSchema = z.object({
  righe: z.array(z.object({
    indice: z.number().int().describe("Indice (0-based) della riga nell'elenco fornito nel messaggio, per farla corrispondere esattamente"),
    prezzo_riga_corretto: z.number().describe(
      "Il valore corretto di prezzo_riga per questa riga (importo/totale della riga: quantità × prezzo unitario), riletto ora dalla " +
      "foto. Se il valore originale era già giusto, restituiscilo invariato."
    ),
  })).describe('Una voce per OGNI riga dell\'elenco fornito nel messaggio, nello stesso ordine — nessuna riga saltata.'),
})

// Budget dedicato e volutamente stretto (non condiviso con
// BUDGET_ESTRAZIONE_MS): questo passaggio parte SOLO quando serve, in
// aggiunta alla lettura già fatta — deve lasciare comunque margine sotto
// il maxDuration della route (vedi estrai/route.ts). Se non fa in tempo
// si rinuncia e si restituisce la lettura originale, mai un errore
// all'utente: il controllo verificaTotaleDocumento (route /estrai) resta
// comunque lì ad avvisarlo, corretta o no.
const BUDGET_CORREZIONE_MS = 10_000

// Se la somma delle righe non torna col totale letto sul documento, è
// quasi sempre perché una o più righe hanno il prezzo unitario stampato
// scambiato per l'importo della riga (vedi ArticoloEstrattoSchema.
// prezzo_riga) — un errore che le sole istruzioni nel prompt di lettura
// (sopra, in estraiPagina) non prevengono sempre, specialmente su
// fatture con due colonne di prezzo ravvicinate. Qui si dà al modello un
// riscontro NUMERICO concreto (lo scarto) su cui correggersi, facendogli
// rileggere le stesse foto — molto più affidabile che sperare lo eviti
// al primo passaggio, dove non ha ancora nulla con cui confrontarsi.
// "Best effort" per costruzione: qualunque errore o timeout restituisce
// la fattura originale invariata, senza mai far fallire l'estrazione.
async function correggiArticoliSeSballati(fattura: FatturaEstratta, fotoDellaFattura: FotoInput[]): Promise<FatturaEstratta> {
  if (!fattura.ha_articoli || fattura.totale_documento == null || fattura.articoli.length === 0) return fattura

  const lordoStimato = fattura.iva_dettaglio.reduce((s, r) => s + r.imponibile + r.iva, 0)
  const scostamento = Math.abs(lordoStimato - fattura.totale_documento) / fattura.totale_documento
  if (scostamento <= SOGLIA_SCOSTAMENTO_TOTALE_DOCUMENTO) return fattura

  try {
    const elenco = fattura.articoli.map((a, i) => {
      const unitario = a.quantita !== 0 ? a.prezzo_riga / a.quantita : a.prezzo_riga
      return `${i}. "${a.nome}" — ${a.quantita}${a.unita_misura ? ` ${a.unita_misura}` : ''}, prezzo_riga letto: € ${a.prezzo_riga.toFixed(2)} (cioè € ${unitario.toFixed(2)} a unità)`
    }).join('\n')

    const parti = fotoDellaFattura.map(foto =>
      foto.mediaType === 'application/pdf'
        ? { type: 'file' as const, data: foto.buffer, mediaType: foto.mediaType }
        : { type: 'image' as const, image: foto.buffer, mediaType: foto.mediaType }
    )

    const { object } = await generateWithFallback(
      CorrezionePrezziSchema,
      [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Hai già letto questo documento ed estratto queste righe di prodotto:

${elenco}

Il totale che hai letto sul documento è € ${fattura.totale_documento.toFixed(2)}, ma la somma delle righe sopra (+ IVA) dà € ${lordoStimato.toFixed(2)} — uno scarto del ${(scostamento * 100).toFixed(0)}%, troppo grande per essere un arrotondamento o uno sconto non a riga. L'errore più comune in questo caso è aver letto, su una o più righe, il PREZZO UNITARIO stampato (es. il prezzo al kg/L/pz) scrivendolo in prezzo_riga al posto dell'IMPORTO/TOTALE della riga (quantità × prezzo unitario) — capita spesso su fatture con due colonne di prezzo vicine tra loro.

Guarda di nuovo le foto allegate, riga per riga, e per ciascuna verifica se prezzo_riga corrisponde davvero all'importo/totale stampato per quella riga oppure se hai scambiato le due colonne. Correggi SOLO le righe effettivamente sbagliate, rileggendo il valore vero dalla foto — non limitarti a far tornare la somma con un calcolo: il valore deve essere quello davvero stampato sul documento. Se una riga era già corretta, restituiscila invariata. Rispondi con una voce per OGNI riga dell'elenco sopra, nello stesso ordine, nessuna saltata.`,
            },
            ...parti,
          ],
        },
      ],
      {
        model: MODELLO_LETTURA,
        fallbackModel: MODELLO_LETTURA_RISERVA,
        temperature: 0.1,
        budgetMs: BUDGET_CORREZIONE_MS,
      }
    )

    const correzioneByIndice = new Map(object.righe.map(r => [r.indice, r.prezzo_riga_corretto]))
    const articoliCorretti = fattura.articoli.map((a, i) => {
      const corretto = correzioneByIndice.get(i)
      return corretto != null ? { ...a, prezzo_riga: corretto } : a
    })

    // iva_dettaglio dipendeva dai prezzi articolo SOLO se era stato
    // stimato (nessun riepilogo IVA stampato/letto) — se veniva invece da
    // un riepilogo letto direttamente, la correzione dei prezzi non lo
    // tocca (resta un dato letto indipendentemente dagli articoli).
    const ivaDettaglio = fattura.iva_da_articoli ? calcolaIvaDaArticoli(articoliCorretti) : fattura.iva_dettaglio

    console.log(`[cassa/fatture] Correzione prezzi applicata (scarto ${(scostamento * 100).toFixed(0)}% dal totale documento)`)
    return { ...fattura, articoli: articoliCorretti, iva_dettaglio: ivaDettaglio }
  } catch (err) {
    console.warn('[cassa/fatture] Correzione prezzi non riuscita, mantengo la lettura originale:', err instanceof Error ? err.message : err)
    return fattura
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

// Fase 1 (per gruppo/chiamata — vedi MAX_PAGINE_PER_LETTURA in
// FatturaCapture.tsx): legge ogni pagina singolarmente e in parallelo,
// senza ancora raggrupparle in fatture. Il collo di bottiglia è la
// generazione della risposta (un elenco articoli lungo), quindi mandare
// più pagine in un'unica richiesta AI costerebbe quanto la somma di
// tutte e sforerebbe il tempo massimo della funzione; in parallelo il
// costo è quello della pagina più lenta. In più ogni chiamata ha molto
// meno da leggere, il che aiuta anche la precisione — che è la priorità
// qui. Il raggruppamento in fatture è deliberatamente un passo a parte
// (componiFatture) proprio per poter avvenire su TUTTE le pagine di un
// caricamento insieme, anche quando arrivano da gruppi/chiamate diversi:
// farlo già qui, gruppo per gruppo, spezzerebbe a metà una fattura le
// cui pagine finiscono divise fra due gruppi consecutivi.
export async function estraiPagine(foto: FotoInput[]): Promise<PaginaEstratta[]> {
  return Promise.all(foto.map((f, i) => estraiPagina(f, i + 1, foto.length)))
}

// Fase 2 (una sola volta, su TUTTE le pagine lette — vedi
// estraiPagine): raggruppa le pagine in fatture, ricostruisce i totali e
// corregge eventuali prezzi sballati. Pura composizione/logica per il
// raggruppamento (nessuna chiamata AI qui); un'eventuale chiamata AI
// avviene solo dentro correggiArticoliSeSballati, e solo per le fatture
// che ne hanno davvero bisogno — `foto` deve essere nello stesso ordine
// di `pagine` (stesso indice = stessa pagina).
export async function componiFatture(pagine: PaginaEstratta[], foto: FotoInput[]): Promise<FatturaEstrattaConIndici[]> {
  const inizio = Date.now()
  const gruppi = raggruppaPagine(pagine)
  // In parallelo fra le fatture (correggiArticoliSeSballati riguarda
  // solo chi ne ha davvero bisogno — totale documento letto E scostato —
  // e resta comunque "best effort": non aggiunge un rischio di timeout
  // condiviso fra fatture diverse dello stesso caricamento).
  const fatture = await Promise.all(gruppi.map(async indici => {
    const estratta = unisciPagine(indici.map(i => pagine[i]))
    const corretta = await correggiArticoliSeSballati(estratta, indici.map(i => foto[i]))
    return { fattura: corretta, indiciFoto: indici }
  }))

  console.log(
    `[cassa/fatture] composte ${pagine.length} pagine → ${fatture.length} fattur${fatture.length === 1 ? 'a' : 'e'} in ${Date.now() - inizio}ms, ` +
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
    { model: MODELLO_ABBINAMENTO, fallbackModel: MODELLO_ABBINAMENTO_RISERVA }
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
