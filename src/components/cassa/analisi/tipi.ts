import type { Chiusura, Voce, Acquisto, Aggregato, Bucket } from '@/lib/analisi'
import type { SpesaFornitore } from '@/components/cassa/analisi/dati'
import type { RigaFumetto } from '@/components/cassa/analisi/Sovrapposizioni'
import type { ModoConfronto, Intervallo } from '@/components/cassa/analisi/Filtri'

// Tipi condivisi tra AnalisiClient e le sue viste (normale e confronto A/B).

export type Nodo =
  | { k: 'day'; d: string; src?: 'B' }
  | { k: 'month'; j: number }
  | { k: 'kpi'; i: number }
  | { k: 'loc'; li: string }
  | { k: 'alert'; li: string }

export interface Dati {
  A: Chiusura[]; B: Chiusura[]
  spA: Voce[]; spB: Voce[]; veA: Voce[]; veB: Voce[]
  acA: Acquisto[]; acB: Acquisto[]
  foA: SpesaFornitore[]; foB: SpesaFornitore[]
}

export interface Ctx {
  v: {
    rows: Chiusura[]; prev: Chiusura[]; X: Aggregato; P: Aggregato; bk: Bucket[]; cbk: Bucket[]; mensile: boolean
    locSel: { id: string; nome: string; colore: string; tenue: string }[]; presenti: { id: string; nome: string; colore: string; tenue: string }[]
    ser: number[][]; serB: number[]; bySer: (rs: Chiusura[], ks: Bucket[], f: (x: Chiusura[]) => number) => number[]
    sedi: { l: { id: string; nome: string; colore: string }; rs: Chiusura[]; x: Aggregato; y: Aggregato }[]
    categorie: { c: string; col: string }[]; colCat: Record<string, string>
  }
  dati: Dati
  MET: { l: string; f: (rs: Chiusura[]) => number; fmt: (x: number) => string; buono: 'su' | 'giu'; ass?: boolean; col: string }[]
  tel: boolean
  cmp: ModoConfronto
  B: Intervallo; a: string; b: string
  sel: string[]; setSel: (s: string[]) => void
  apri: (n: Nodo) => void
  fumetto: (t: string, s: string, r: RigaFumetto[]) => (e: React.MouseEvent<Element>) => void
  fumPagamento: (l: string, k: 'pos' | 'con' | 'bon') => (e: React.MouseEvent<Element>) => void
  fumAsporto: (e: React.MouseEvent<Element>) => void
  fumCoperti: (e: React.MouseEvent<Element>) => void
  fumCategoria: (c: string, src: Voce[], spese: boolean) => (e: React.MouseEvent<Element>) => void
  fumGiornoSett: (li: string | null, w: number) => (e: React.MouseEvent<Element>) => void
  fumFattura: (l: string, k: 'tot' | 'fo' | 'be' | 'nf' | 'fb') => (e: React.MouseEvent<Element>) => void
  fumIncidenza: (l: string, k: 'tot' | 'fo' | 'be' | 'nf' | 'fb') => (e: React.MouseEvent<Element>) => void
  FA: { fo: number; be: number; de: number; an: number }; FB: { fo: number; be: number; de: number; an: number }
  gv: (x: { fo: number; be: number; de: number; an: number }, k: 'tot' | 'fo' | 'be' | 'nf' | 'fb') => number
  etichettaB: (k: Bucket | undefined) => string
  nomeLoc: Record<string, { id: string; nome: string; colore: string }>
}

