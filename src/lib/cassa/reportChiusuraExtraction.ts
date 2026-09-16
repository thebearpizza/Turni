import { z } from 'zod'
import { generateWithFallback, EstrazioneTimeoutError, BUDGET_ESTRAZIONE_MS, type FotoInput } from './fattureExtraction'

// Stessa coppia modello/fallback dell'estrazione fatture (documento
// analogo per complessità: foto/PDF di un documento stampato) — vedi
// fattureExtraction.ts per il ragionamento su Flash vs Pro.
const GEMINI_MODEL_ESTRAZIONE = process.env.GEMINI_MODEL_ESTRAZIONE || 'gemini-3.7-flash'
const GEMINI_FALLBACK_MODEL_ESTRAZIONE = process.env.GEMINI_FALLBACK_MODEL_ESTRAZIONE || 'gemini-3.5-flash-lite'

export { EstrazioneTimeoutError }

export const ReportChiusuraEstrattoSchema = z.object({
  data: z.string().nullable().describe('Data del report, formato yyyy-MM-dd — null se non leggibile con certezza'),
  coperti: z.number().int().nullable().describe('Numero di coperti serviti, se indicato nel documento — null se assente'),
  entrate_contanti: z.number().describe('Totale incassato SOLO in contanti/contante (riga "Contante"/"Contanti") — 0 se quella riga non compare nel documento'),
  entrate_pos: z.number().describe('Totale incassato SOLO con POS/carta/bancomat (riga "POS"/"Carta"/"Bancomat") — 0 se quella riga non compare'),
  entrate_bonifico: z.number().describe('Somma di OGNI ALTRA riga di pagamento presente nel documento, diversa da contanti e POS: bonifico, Satispay, buoni pasto, carte prepagate, voucher e qualsiasi altro metodo elencato — 0 se non ce ne sono'),
  totale_dichiarato: z.number().nullable().describe('Totale complessivo/corrispettivi dichiarato esplicitamente nel documento (es. "Totale corrispettivi"), per un controllo incrociato — null se non presente'),
  prodotti: z.array(z.object({
    nome: z.string().describe('Nome del prodotto/piatto esattamente come scritto nel documento'),
    quantita: z.number().describe('Quantità venduta/consumata di questo prodotto'),
    importo: z.number().describe('Totale incassato per questo prodotto (quantità × prezzo unitario), come indicato nella riga — 0 se il documento non riporta un importo per riga'),
    categoria: z.string().nullable().describe('Categoria/reparto del prodotto (es. nome della sezione del menu sotto cui è raggruppato nel documento: "Pizze", "Bevande", "Dolci"...) — null se il documento non raggruppa i prodotti per categoria o non è possibile determinarla con certezza'),
  })).describe('Elenco COMPLETO di tutti i prodotti/articoli venduti nel documento con quantità e importo, anche quelli che sembrano piatti del menu e non articoli di magazzino — il filtro avviene dopo, qui serve l\'elenco grezzo e completo'),
})

const PROMPT = `Sei un assistente che legge report di chiusura giornaliera di un ristorante, esportati dal gestionale di cassa/POS — quasi sempre un PDF già digitale, talvolta una foto di una copia stampata.

Il documento contiene tipicamente, in quest'ordine: dati anagrafici del locale (ignorali, non servono), un riepilogo di giornata (data, coperti serviti, totale corrispettivi), una tabella dei metodi di pagamento usati e una tabella dei prodotti venduti.

Sui pagamenti: NON tutti i metodi compaiono sempre — se un metodo non è stato usato quel giorno, la sua riga è semplicemente ASSENTE dal documento (non mostrata a zero). Distingui con attenzione SOLO due righe specifiche (Contante→entrate_contanti, POS/Carta/Bancomat→entrate_pos): ogni altra riga di pagamento presente, qualunque sia il suo nome (Bonifico, Satispay, buoni pasto, carte prepagate, voucher, altro), va sommata in entrate_bonifico.

Sui prodotti: leggi l'intera tabella "prodotti"/"articoli venduti" riga per riga, con calma, senza saltarne nessuna — anche se sembrano piatti del menu (pizze, dolci, ecc.) invece di articoli di magazzino: l'elenco va comunque completo, il filtro su cosa è davvero tracciato a magazzino avviene automaticamente dopo, non qui. Non includere righe di totale/sconto/intestazione tra i prodotti. Per ogni prodotto riporta anche l'importo incassato (se la riga lo indica) e, se il documento raggruppa i prodotti sotto intestazioni di categoria/reparto (es. "Pizze", "Bevande", "Primi"...), riporta quella categoria per ogni prodotto della sezione — altrimenti lascia categoria a null, senza inventarla.

Leggi ogni numero cifra per cifra, senza arrotondare: le cifre italiane usano la virgola come separatore decimale (es. "12,50" = 12.50).`

export async function estraiReportChiusura(foto: FotoInput[]): Promise<z.infer<typeof ReportChiusuraEstrattoSchema>> {
  const parti = foto.map(f =>
    f.mediaType === 'application/pdf'
      ? { type: 'file' as const, data: f.buffer, mediaType: f.mediaType }
      : { type: 'image' as const, image: f.buffer, mediaType: f.mediaType }
  )

  const { object } = await generateWithFallback(
    ReportChiusuraEstrattoSchema,
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          ...parti,
        ],
      },
    ],
    {
      model: GEMINI_MODEL_ESTRAZIONE,
      fallbackModel: GEMINI_FALLBACK_MODEL_ESTRAZIONE,
      temperature: 0.1,
      budgetMs: BUDGET_ESTRAZIONE_MS,
    }
  )
  return object
}
