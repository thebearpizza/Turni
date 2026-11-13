// Conto economico del mese (Cassa → Utile): ricavi delle chiusure al netto
// dell'IVA, meno costo merci delle fatture, personale e altre spese di
// gestione inserite a mano, spese in contanti della cassa e fatture senza
// articoli (bollette e simili). Lo schema segue quello usato nella
// ristorazione: ricavi netti → costo del venduto → personale → prime cost →
// costi operativi → utile operativo (EBITDA).

/** IVA della ristorazione per lo scorporo degli incassi. */
export const IVA_RICAVI = 0.10

export type CategoriaCosto =
  | 'personale' | 'affitto' | 'utenze' | 'marketing' | 'manutenzioni'
  | 'consulenze' | 'assicurazioni' | 'commissioni' | 'noleggi' | 'cambiali' | 'altro'

export const CATEGORIE_COSTO: { k: CategoriaCosto; l: string; esempio: string }[] = [
  { k: 'personale', l: 'Personale', esempio: 'Stipendi, contributi, TFR, extra' },
  { k: 'affitto', l: 'Affitto', esempio: 'Canone del locale, spese condominiali' },
  { k: 'utenze', l: 'Utenze', esempio: 'Luce, gas, acqua, telefono e internet' },
  { k: 'marketing', l: 'Marketing', esempio: 'Social, pubblicità, volantini' },
  { k: 'manutenzioni', l: 'Manutenzioni', esempio: 'Riparazioni, assistenza attrezzature' },
  { k: 'consulenze', l: 'Consulenze', esempio: 'Commercialista, consulente del lavoro' },
  { k: 'assicurazioni', l: 'Assicurazioni', esempio: 'Polizze del locale' },
  { k: 'commissioni', l: 'Commissioni', esempio: 'POS, delivery, prenotazioni' },
  { k: 'noleggi', l: 'Noleggi e leasing', esempio: 'Macchinari, auto, software' },
  { k: 'cambiali', l: 'Cambiali', esempio: 'Cambiali e pagamenti a rate in scadenza nel mese' },
  { k: 'altro', l: 'Altro', esempio: 'Ogni altra spesa di gestione' },
]
export const nomeCategoria = (k: string) => CATEGORIE_COSTO.find(c => c.k === k)?.l ?? k

/** Voce di costo inserita a mano (tabella costi_gestione). */
export interface CostoGestione {
  id: string
  restaurant_ids: string[]
  categoria: CategoriaCosto
  descrizione: string | null
  importo: number
  ricorrente: boolean
  mese_da: string
  mese_a: string | null
}

/** La voce vale nel mese (primo giorno, "2026-11-01")? */
export function valeNelMese(c: CostoGestione, m: string): boolean {
  if (c.ricorrente) return c.mese_da <= m && (c.mese_a === null || c.mese_a >= m)
  return c.mese_da === m
}

/** Quota della voce che spetta ai locali scelti (divisa in parti uguali). */
export function quota(c: CostoGestione, locali: Set<string>): number {
  const n = c.restaurant_ids.filter(id => locali.has(id)).length
  return c.restaurant_ids.length ? (c.importo * n) / c.restaurant_ids.length : 0
}

/** Fattura del mese ridotta a ciò che serve al conto economico. */
export interface FatturaMese {
  li: string
  netto: number
  /** Fattura senza articoli: nome della categoria di spesa diretta. */
  diretta: string | null
  food: number
  beverage: number
  materiali: number
  /** Per il dettaglio delle spese (resoconto in Analisi). */
  data?: string
  fornitore?: string
  numero?: string
}

/** Spesa in contanti di una chiusura, con il nome della sua categoria di cassa. */
export interface SpesaContanti { categoria: string; importo: number; nome?: string; data?: string; li?: string }

type Destinazione = 'personale' | 'merci' | CategoriaCosto

// Categorie di cassa e di fattura senza articoli che corrispondono a una
// voce del conto economico, per nome esatto (minuscole, senza spazi ai
// lati). Le altre restano voci a sé, col loro nome.
const DA_CONTANTI: Record<string, Destinazione> = {
  'personale': 'personale', 'extra personale': 'personale', 'rider/consegne': 'personale', 'rider': 'personale',
  'fornitori': 'merci', 'fornitori/merce': 'merci',
  'utenze/amministrazione': 'utenze', 'utenze': 'utenze',
  'manutenzione': 'manutenzioni', 'manutenzioni': 'manutenzioni', 'manutenzione/attrezzature': 'manutenzioni',
  'marketing': 'marketing',
  'cambiali': 'cambiali',
}
const destinazione = (nome: string): Destinazione | null => DA_CONTANTI[nome.trim().toLowerCase()] ?? null

/** Voce dei costi operativi con le sue provenienze (fatture, contanti, a mano). */
export interface VoceCosto { l: string; v: number; fonti: string[] }

export interface ContoEconomico {
  incassi: number
  ricavi: number
  food: number
  beverage: number
  merciContanti: number
  merci: number
  personaleMano: number
  personaleContanti: number
  personale: number
  primeCost: number
  materiali: number
  /** Costi operativi per voce: fatture senza articoli, contanti e spese a mano insieme. */
  operativi: VoceCosto[]
  contanti: number
  costi: number
  utile: number
}

export function contoEconomico(x: {
  incassi: number
  contanti: SpesaContanti[]
  fatture: FatturaMese[]
  costi: CostoGestione[]
  locali: Set<string>
}): ContoEconomico {
  const ricavi = x.incassi / (1 + IVA_RICAVI)
  let food = 0, beverage = 0, materiali = 0, merciContanti = 0, personaleContanti = 0, personaleMano = 0
  const voci = new Map<string, VoceCosto>()
  const aggiungi = (l: string, v: number, fonte: string) => {
    const k = l.trim().toLowerCase()
    const o = voci.get(k) ?? { l, v: 0, fonti: [] }
    o.v += v
    if (!o.fonti.includes(fonte)) o.fonti.push(fonte)
    voci.set(k, o)
  }
  const etichetta = (d: Destinazione, nome: string) => (d === 'personale' || d === 'merci' ? nome : nomeCategoria(d))

  for (const f of x.fatture) {
    if (f.diretta !== null) {
      const d = destinazione(f.diretta)
      if (d === 'personale') personaleMano += f.netto
      else if (d === 'merci') food += f.netto
      else aggiungi(d ? etichetta(d, f.diretta) : f.diretta, f.netto, 'fatture')
      continue
    }
    // Le righe danno la ripartizione per tipologia; il netto della fattura
    // (con sconti e arrotondamenti) è quello che si paga davvero.
    const righe = f.food + f.beverage + f.materiali
    if (righe <= 0) { materiali += f.netto; continue }
    const k = f.netto / righe
    food += f.food * k; beverage += f.beverage * k; materiali += f.materiali * k
  }
  for (const s of x.contanti) {
    const d = destinazione(s.categoria)
    if (d === 'personale') personaleContanti += s.importo
    else if (d === 'merci') merciContanti += s.importo
    else aggiungi(d ? etichetta(d, s.categoria) : s.categoria, s.importo, 'contanti')
  }
  for (const c of x.costi) {
    const v = quota(c, x.locali)
    if (c.categoria === 'personale') personaleMano += v
    else aggiungi(nomeCategoria(c.categoria), v, 'a mano')
  }

  const operativi = [...voci.values()].filter(o => Math.abs(o.v) > 0.004).sort((a, b) => b.v - a.v)
  const merci = food + beverage + merciContanti
  const personale = personaleMano + personaleContanti
  const costi = merci + personale + materiali + operativi.reduce((t, o) => t + o.v, 0)
  return {
    incassi: x.incassi, ricavi, food, beverage, merciContanti, merci,
    personaleMano, personaleContanti, personale, primeCost: merci + personale, materiali, operativi,
    contanti: x.contanti.reduce((t, s) => t + s.importo, 0), costi, utile: ricavi - costi,
  }
}

/** Gruppo del conto economico a cui appartiene una voce di costo. */
export type GruppoCosto = 'merci' | 'personale' | 'materiali' | 'operativi'
export const VOCE_GRUPPO: Record<Exclude<GruppoCosto, 'operativi'>, string> = {
  merci: 'Costo merci', personale: 'Personale', materiali: 'Detergenza e materiali',
}

/** Singola uscita del conto economico, per il dettaglio di una voce. */
export interface Movimento {
  voce: string
  /** Sottocategoria della voce (Food, Beverage, categoria di cassa...). */
  sotto: string
  gruppo: GruppoCosto
  fonte: 'fattura' | 'contanti' | 'a mano'
  descr: string
  li?: string
  data?: string
  importo: number
}

/**
 * Le stesse uscite di contoEconomico, una per una e già assegnate alla loro
 * voce: le somme per voce coincidono con il conto economico.
 */
export function movimenti(x: { contanti: SpesaContanti[]; fatture: FatturaMese[]; costi: CostoGestione[]; locali: Set<string> }): Movimento[] {
  const out: Movimento[] = []
  const voceDi = (d: Destinazione | null, nome: string): { voce: string; gruppo: GruppoCosto } =>
    d === 'personale' ? { voce: VOCE_GRUPPO.personale, gruppo: 'personale' }
    : d === 'merci' ? { voce: VOCE_GRUPPO.merci, gruppo: 'merci' }
    : { voce: d ? nomeCategoria(d) : nome, gruppo: 'operativi' }
  for (const f of x.fatture) {
    const descr = `${f.fornitore ?? 'Fattura'}${f.numero ? ` n. ${f.numero}` : ''}`
    const base = { fonte: 'fattura' as const, descr, li: f.li, data: f.data }
    if (f.diretta !== null) { out.push({ ...base, ...voceDi(destinazione(f.diretta), f.diretta), sotto: `Fatture · ${f.diretta}`, importo: f.netto }); continue }
    const righe = f.food + f.beverage + f.materiali
    if (righe <= 0) { out.push({ ...base, voce: VOCE_GRUPPO.materiali, sotto: 'Fatture', gruppo: 'materiali', importo: f.netto }); continue }
    const k = f.netto / righe
    if (f.food) out.push({ ...base, voce: VOCE_GRUPPO.merci, sotto: 'Food', gruppo: 'merci', importo: f.food * k })
    if (f.beverage) out.push({ ...base, voce: VOCE_GRUPPO.merci, sotto: 'Beverage', gruppo: 'merci', importo: f.beverage * k })
    if (f.materiali) out.push({ ...base, voce: VOCE_GRUPPO.materiali, sotto: 'Fatture', gruppo: 'materiali', importo: f.materiali * k })
  }
  for (const s of x.contanti) {
    const d = destinazione(s.categoria)
    out.push({ fonte: 'contanti', descr: s.nome ?? s.categoria, li: s.li, data: s.data, importo: s.importo, ...voceDi(d, s.categoria), sotto: d === 'merci' ? 'Merce pagata in contanti' : `Contanti · ${s.categoria}` })
  }
  for (const c of x.costi) {
    const v = quota(c, x.locali)
    if (v <= 0) continue
    out.push({
      fonte: 'a mano', descr: c.descrizione || nomeCategoria(c.categoria), importo: v, sotto: 'Inserite a mano',
      ...(c.categoria === 'personale' ? { voce: VOCE_GRUPPO.personale, gruppo: 'personale' as const } : { voce: nomeCategoria(c.categoria), gruppo: 'operativi' as const }),
    })
  }
  return out
}

/**
 * Fasce di riferimento per un ristorante con servizio al tavolo, in % dei
 * ricavi netti (fonti di settore: indicative, variano col tipo di locale).
 */
export const RIFERIMENTI = {
  food: { da: 28, a: 35 },
  personale: { da: 25, a: 35 },
  primeCost: { da: 55, a: 65 },
} as const
