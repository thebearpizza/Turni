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
  | 'consulenze' | 'assicurazioni' | 'commissioni' | 'noleggi' | 'altro'

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
}

export interface ContoEconomico {
  incassi: number
  ricavi: number
  food: number
  beverage: number
  merci: number
  personale: number
  primeCost: number
  materiali: number
  contanti: number
  /** Fatture senza articoli per categoria (Utenze, Manutenzioni...). */
  dirette: { l: string; v: number }[]
  /** Spese inserite a mano, per categoria, personale escluso. */
  gestione: { k: CategoriaCosto; l: string; v: number }[]
  costi: number
  utile: number
}

export function contoEconomico(x: {
  incassi: number
  speseContanti: number
  fatture: FatturaMese[]
  costi: CostoGestione[]
  locali: Set<string>
}): ContoEconomico {
  const ricavi = x.incassi / (1 + IVA_RICAVI)
  let food = 0, beverage = 0, materiali = 0
  const dirette = new Map<string, number>()
  for (const f of x.fatture) {
    if (f.diretta !== null) { dirette.set(f.diretta, (dirette.get(f.diretta) ?? 0) + f.netto); continue }
    // Le righe danno la ripartizione per tipologia; il netto della fattura
    // (con sconti e arrotondamenti) è quello che si paga davvero.
    const righe = f.food + f.beverage + f.materiali
    if (righe <= 0) { materiali += f.netto; continue }
    const k = f.netto / righe
    food += f.food * k; beverage += f.beverage * k; materiali += f.materiali * k
  }
  const perCat = new Map<CategoriaCosto, number>()
  for (const c of x.costi) perCat.set(c.categoria, (perCat.get(c.categoria) ?? 0) + quota(c, x.locali))
  const personale = perCat.get('personale') ?? 0
  const gestione = CATEGORIE_COSTO.filter(c => c.k !== 'personale' && (perCat.get(c.k) ?? 0) > 0).map(c => ({ k: c.k, l: c.l, v: perCat.get(c.k)! }))
  const direttePerCat = [...dirette.entries()].filter(([, v]) => Math.abs(v) > 0.004).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ l, v }))
  const merci = food + beverage
  const costi = merci + personale + materiali + x.speseContanti
    + direttePerCat.reduce((t, d) => t + d.v, 0) + gestione.reduce((t, g) => t + g.v, 0)
  return {
    incassi: x.incassi, ricavi, food, beverage, merci, personale, primeCost: merci + personale,
    materiali, contanti: x.speseContanti, dirette: direttePerCat, gestione, costi, utile: ricavi - costi,
  }
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
