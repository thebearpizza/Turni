import { z } from 'zod'
import { generateWithFallback } from './fattureExtraction'

// Smistamento delle fatture elettroniche fra i locali quando più locali
// ricevono sullo stesso codice destinatario SDI (es. Dazio e Crunch
// Talenti). In ordine, e fermandosi al primo esito certo:
//   1. codice destinatario (o PEC) che corrisponde a un solo locale;
//   2. nome del locale, la sua via (dall'indirizzo) o uno dei suoi
//      "riferimenti" che compare, a parole
//      intere e senza distinzione di maiuscole, nei testi della fattura
//      (destinazione, sede del cliente, causale, riferimenti, righe);
//   3. l'IA, che risponde solo se è sicura;
//   4. altrimenti nessun locale: la fattura va in "Da assegnare".
// I passi 1–2 sono deterministici (prevedibilità sopra comodità, come gli
// abbinamenti del resto di Acquisti); l'IA è l'ultima spiaggia e il suo
// esito resta segnalato perché l'utente lo controlli.

// Stessa coppia "leggera" di matchArticoli, assistente Telegram e
// controllo duplicati spese.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite'

export type FonteIndizio = 'destinazione' | 'sede' | 'causale' | 'riferimenti' | 'righe'
const FONTE: Record<FonteIndizio, string> = {
  destinazione: 'nella destinazione', sede: 'nella sede del cliente', causale: 'nella causale', riferimenti: 'nei riferimenti', righe: 'nelle righe',
}
const ORDINE_FONTI: FonteIndizio[] = ['destinazione', 'sede', 'causale', 'riferimenti', 'righe']

export interface LocaleSmistamento { id: string; nome: string; indirizzo: string | null; codice: string | null; riferimenti: string[] }
export interface FatturaDaSmistare {
  chiave: string
  destinatario: string | null
  pec: string | null
  fornitore: string
  indizi: { fonte: FonteIndizio; testo: string }[]
}
export type Via = 'unico' | 'codice' | 'riferimento' | 'ia' | null
export interface EsitoSmistamento { chiave: string; restaurant_id: string | null; via: Via; motivo: string; candidati: string[] }

/** Testo ridotto a parole separate da uno spazio, per il confronto a parole intere. */
const parole = (s: string) => ' ' + s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' '
const contiene = (testo: string, termine: string) => { const t = parole(termine); return t.trim().length >= 2 && parole(testo).includes(t) }

// Toponimi che precedono il nome della via: "Via Nomentana 123" → "Nomentana".
const TOPONIMI = /^(via|viale|v\.?\s?le|piazza|p\.?\s?zza|piazzale|p\.?\s?le|corso|c\.?\s?so|largo|vicolo|vico|strada|str\.|lungotevere|lungomare|circonvallazione|borgo|contrada|località|loc\.)\s+/i

/**
 * Termini ricavati dall'indirizzo del locale: la via intera ("Via
 * Nomentana") e il solo nome ("Nomentana"), senza civico né città. Il nome
 * da solo si scarta se è anche il nome di una città dei locali ("Via Roma,
 * Roma"), che comparirebbe nella sede di qualsiasi fattura.
 */
export function terminiIndirizzo(indirizzo: string | null, locali: LocaleSmistamento[]): string[] {
  const via = (indirizzo ?? '').split(',')[0].replace(/\s+(n\.?\s*)?\d+[a-z]?(\s*[/-]\s*\w+)?\s*$/i, '').trim()
  if (!via) return []
  const nome = via.replace(TOPONIMI, '').trim()
  const citta = locali.flatMap(l => (l.indirizzo ?? '').split(',').slice(1)).map(x => x.replace(/\d+/g, '').replace(/\(\w+\)/g, '').trim()).filter(Boolean)
  const out = [via]
  if (nome !== via && nome.length >= 4 && !citta.some(c => parole(c) === parole(nome))) out.push(nome)
  return out
}

/**
 * Pezzi distintivi del nome: "Crunch! - Talenti" → "Talenti". Si scartano
 * i pezzi che compaiono nel nome di un altro locale ("Crunch!" in "Crunch! Teglia"), che non distinguono nulla.
 */
export function terminiNome(nome: string, locali: LocaleSmistamento[]): string[] {
  const pezzi = (n: string) => n.split(/\s+[-–—·|]\s+/).map(x => x.trim()).filter(x => parole(x).trim().length >= 4)
  const pz = pezzi(nome)
  if (pz.length < 2) return []
  return pz.filter(p => !locali.some(l => l.nome !== nome && contiene(l.nome, p)))
}

const elenco = (nomi: string[]) => (nomi.length <= 1 ? nomi.join('') : `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}`)

/**
 * Passi deterministici. Restituisce l'esito certo oppure i locali fra cui
 * resta il dubbio (da passare all'IA) e il motivo da mostrare se anche
 * l'IA non sa.
 */
export function smistaDeterministico(f: FatturaDaSmistare, locali: LocaleSmistamento[]): EsitoSmistamento | { dubbio: LocaleSmistamento[]; motivo: string; candidati: string[] } {
  const tutti = locali.map(l => l.id)
  if (locali.length === 1) return { chiave: f.chiave, restaurant_id: locali[0].id, via: 'unico', motivo: 'Unico locale', candidati: tutti }

  // 1. Codice destinatario (o PEC fra i riferimenti).
  const cod = f.destinatario?.trim().toUpperCase() || null
  const pec = f.pec?.trim().toLowerCase() || null
  const perCodice = locali.filter(l => (cod && l.codice?.toUpperCase() === cod) || (pec && l.riferimenti.some(r => r.trim().toLowerCase() === pec)))
  if (perCodice.length === 1) return { chiave: f.chiave, restaurant_id: perCodice[0].id, via: 'codice', motivo: 'Codice destinatario', candidati: [perCodice[0].id] }

  // 2. Riferimenti nei testi, fra i locali del codice condiviso (o fra tutti).
  const pool = perCodice.length > 1 ? perCodice : locali
  const trovati: { l: LocaleSmistamento; termine: string; fonte: FonteIndizio }[] = []
  for (const l of pool) {
    const termini = [l.nome, ...terminiNome(l.nome, locali), ...terminiIndirizzo(l.indirizzo, locali), ...l.riferimenti.filter(r => !r.includes('@'))].map(t => t.trim()).filter(Boolean)
    let migliore: { termine: string; fonte: FonteIndizio } | null = null
    for (const fonte of ORDINE_FONTI) {
      for (const x of f.indizi.filter(i => i.fonte === fonte)) {
        const t = termini.filter(t => contiene(x.testo, t)).sort((a, b) => b.length - a.length)[0]
        if (t && (!migliore || t.length > migliore.termine.length)) migliore = { termine: t, fonte }
      }
      if (migliore) break
    }
    if (migliore) trovati.push({ l, ...migliore })
  }
  // "Crunch" dentro "Crunch Talenti": vince il termine più lungo che lo contiene.
  const netti = trovati.filter(a => !trovati.some(b => b.l.id !== a.l.id && b.termine.length > a.termine.length && contiene(b.termine, a.termine)))
  if (netti.length === 1) {
    const x = netti[0]
    return { chiave: f.chiave, restaurant_id: x.l.id, via: 'riferimento', motivo: `Trovato «${x.termine}» ${FONTE[x.fonte]}`, candidati: pool.map(l => l.id) }
  }

  const dubbio = netti.length > 1 ? netti.map(x => x.l) : pool
  const motivo = netti.length > 1
    ? `Riferimenti di più locali (${elenco(netti.map(x => x.l.nome))})`
    : perCodice.length > 1 ? `Codice condiviso da ${elenco(perCodice.map(l => l.nome))}, nessun riferimento trovato` : 'Nessun riferimento al locale trovato'
  return { dubbio, motivo, candidati: pool.map(l => l.id) }
}

const RispostaIa = z.object({
  risultati: z.array(z.object({
    fattura: z.number().int().describe('Indice della fattura nell\'elenco'),
    locale: z.number().int().nullable().describe('Indice del locale, oppure null se non sei sicuro'),
    sicura: z.boolean().describe('true solo se sei sicuro del locale'),
    perche: z.string().describe('Motivo in poche parole, in italiano'),
  })),
})

const taglia = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/**
 * Passo 3: un'unica richiesta per le fatture che hanno gli stessi locali
 * in dubbio. Indici sempre validati contro gli elenchi reali; qualsiasi
 * errore (quota, rete) vale "non so", mai un'assegnazione inventata.
 */
export async function chiediAllIa(fatture: FatturaDaSmistare[], locali: LocaleSmistamento[]): Promise<Map<string, { restaurant_id: string; perche: string }>> {
  const out = new Map<string, { restaurant_id: string; perche: string }>()
  if (!fatture.length || locali.length < 2 || !process.env.GOOGLE_GENERATIVE_AI_API_KEY) return out
  const testoLocali = locali.map((l, i) => `${i}. ${l.nome}${l.indirizzo ? ` — ${l.indirizzo}` : ''}${l.riferimenti.length ? ` — riferimenti: ${l.riferimenti.join('; ')}` : ''}`).join('\n')
  const testoFatture = fatture.map((f, i) => {
    const per = (fo: FonteIndizio) => f.indizi.filter(x => x.fonte === fo).map(x => taglia(x.testo, 160))
    const altri = [...per('destinazione'), ...per('sede'), ...per('causale'), ...per('riferimenti')]
    return `### Fattura ${i}\nFornitore: ${f.fornitore}\n${altri.length ? `Destinazione, causale e riferimenti: ${altri.join(' | ')}\n` : ''}Righe:\n${per('righe').slice(0, 40).map(r => `- ${r}`).join('\n')}`
  }).join('\n\n')
  try {
    const { object } = await generateWithFallback(RispostaIa, [{
      role: 'user',
      content: [{ type: 'text', text: `Sei l'assistente acquisti di un gruppo di ristoranti italiani. Alcune fatture elettroniche arrivano sullo stesso codice destinatario per più locali e bisogna capire a quale locale appartiene ciascuna.

Locali possibili (indice. nome — indirizzo — riferimenti):
${testoLocali}

Per ogni fattura indica l'indice del locale SOLO se sei sicuro: per esempio perché nei testi compare il nome, l'indirizzo o un riferimento di quel locale, o perché il tipo di prodotti è inequivocabilmente di quel locale e non dell'altro. Se più locali sono plausibili o non hai indizi chiari, rispondi locale = null e sicura = false: una fattura lasciata da assegnare la sistema l'utente, una assegnata male sporca i conti. Non inventare indici.

${testoFatture}` }],
    }], { model: GEMINI_MODEL, fallbackModel: GEMINI_FALLBACK_MODEL, temperature: 0, budgetMs: 40_000 })
    for (const r of object.risultati) {
      const f = fatture[r.fattura], l = r.locale != null ? locali[r.locale] : undefined
      if (f && l && r.sicura) out.set(f.chiave, { restaurant_id: l.id, perche: r.perche.trim() })
    }
  } catch (err) {
    console.warn('[acquisti/xml] Smistamento IA non riuscito:', err instanceof Error ? err.message : err)
  }
  return out
}

// ── Tipologia proposta per gli articoli nuovi dell'import XML ─────────
// L'XML non dice se una riga è food, beverage, detergenza o altro: la
// propone l'IA dal nome (stessa coppia leggera di sopra) e l'articolo
// nasce "da controllare" finché l'utente non conferma o cambia. Senza
// chiave o in caso di errore non si propone nulla (resta il "food" di
// sempre, comunque da controllare).

export type TipologiaArticolo = 'food' | 'beverage' | 'detergenza' | 'altro_no_food'
const TIPOLOGIE: TipologiaArticolo[] = ['food', 'beverage', 'detergenza', 'altro_no_food']

const RispostaTipologie = z.object({
  risultati: z.array(z.object({
    indice: z.number().int(),
    tipologia: z.enum(['food', 'beverage', 'detergenza', 'altro_no_food']),
  })),
})

export async function proponiTipologie(nomi: string[], fornitore?: string): Promise<Map<string, TipologiaArticolo>> {
  const out = new Map<string, TipologiaArticolo>()
  const unici = [...new Set(nomi.map(n => n.trim()).filter(Boolean))]
  if (!unici.length || !process.env.GOOGLE_GENERATIVE_AI_API_KEY) return out
  const pezzi: string[][] = []
  for (let i = 0; i < unici.length; i += 80) pezzi.push(unici.slice(i, i + 80))
  await Promise.all(pezzi.map(async pezzo => {
    try {
      const { object } = await generateWithFallback(RispostaTipologie, [{
        role: 'user',
        content: [{ type: 'text', text: `Classifica i prodotti acquistati da un ristorante italiano${fornitore ? ` (fornitore: ${fornitore})` : ''} in una tipologia:
- food: alimenti e ingredienti (anche surgelati, salse, condimenti, farine);
- beverage: bevande (vino, birra, acqua, bibite, caffè, superalcolici, sciroppi per bar);
- detergenza: prodotti per pulizia e igiene (detersivi, sgrassatori, sanificanti, carta igienica);
- altro_no_food: tutto il resto (stoviglie monouso, imballaggi, attrezzatura, servizi, trasporto, noleggi).

Prodotti (indice. nome):
${pezzo.map((n, i) => `${i}. ${taglia(n, 160)}`).join('\n')}

Rispondi per ogni indice con una sola tipologia. Non inventare indici.` }],
      }], { model: GEMINI_MODEL, fallbackModel: GEMINI_FALLBACK_MODEL, temperature: 0, budgetMs: 30_000 })
      for (const r of object.risultati) {
        const n = pezzo[r.indice]
        if (n && TIPOLOGIE.includes(r.tipologia)) out.set(n, r.tipologia)
      }
    } catch (err) {
      console.warn('[acquisti/xml] Tipologie IA non riuscite:', err instanceof Error ? err.message : err)
    }
  }))
  return out
}
