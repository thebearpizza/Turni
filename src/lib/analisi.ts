// Calcoli di Analisi cassa (design Manager Analisi): aggregati, periodi,
// raggruppamenti per giorno/mese e formattazioni. Funzioni pure, senza
// accesso al database: i componenti passano le righe già caricate.

export interface Chiusura {
  id: string
  data: string // yyyy-MM-dd
  li: string // restaurant_id
  ent: number
  sp: number
  dif: number
  cop: number
  asp: number
  con: number
  pos: number
  bon: number
}

/** Spesa di cassa o vendita di prodotto, legata a una chiusura. */
export interface Voce {
  data: string
  li: string
  categoria: string
  nome: string
  importo: number
}

/** Righe di fattura raggruppate per fattura, divise per tipologia. */
export interface Acquisto {
  data: string
  li: string
  fornitore: string
  fo: number
  be: number
  de: number
  an: number
}

export interface Aggregato {
  ent: number; sp: number; dif: number; cop: number; asp: number; con: number; pos: number; bon: number
  /** Giorni con almeno una chiusura. */
  g: number
}

export function aggrega(rs: Chiusura[]): Aggregato {
  const o: Aggregato = { ent: 0, sp: 0, dif: 0, cop: 0, asp: 0, con: 0, pos: 0, bon: 0, g: 0 }
  for (const r of rs) {
    o.ent += r.ent; o.sp += r.sp; o.dif += r.dif; o.cop += r.cop
    o.asp += r.asp; o.con += r.con; o.pos += r.pos; o.bon += r.bon
  }
  o.g = rs.length
  return o
}

/** Media scontrino sui totali del periodo, asporto escluso. */
export const mediaScontrino = (x: { ent: number; asp: number; cop: number }) => (x.cop ? (x.ent - x.asp) / x.cop : 0)

// ── Date ─────────────────────────────────────────────────────────────

const D = 864e5
export const MES = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
export const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
export const WD = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
export const WDL = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']

export const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
export const s = (x: number) => new Date(x).toISOString().slice(0, 10)
export const giornoSett = (d: string) => new Date(t(d)).getUTCDay()
export const giorni = (a: string, b: string) => Math.round((t(b) - t(a)) / D) + 1
export const piuGiorni = (d: string, n: number) => s(t(d) + n * D)
export const capit = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

/** "3 ott" */
export const fd = (d: string) => { const x = new Date(t(d)); return `${x.getUTCDate()} ${MES[x.getUTCMonth()]}` }
/** "Sab 3 ott" */
export const fdg = (d: string) => { const x = new Date(t(d)); return `${WD[x.getUTCDay()]} ${x.getUTCDate()} ${MES[x.getUTCMonth()]}` }
/** "Sabato 3 ottobre" */
export const fdl = (d: string) => { const x = new Date(t(d)); return `${WDL[x.getUTCDay()]} ${x.getUTCDate()} ${MESI[x.getUTCMonth()]}` }

/** "1 ott → 8 ott 2026", "3 ott 2026", con gli anni quando servono. */
export function intervallo(a: string, b: string): string {
  const ya = a.slice(0, 4), yb = b.slice(0, 4)
  if (a === b) return `${fd(a)} ${ya}`
  return ya === yb ? `${fd(a)} → ${fd(b)} ${yb}` : `${fd(a)} ${ya} → ${fd(b)} ${yb}`
}

export const unAnnoPrima = (d: string) => `${+d.slice(0, 4) - 1}${d.slice(4)}`.replace(/-02-29$/, '-02-28')

// ── Raggruppamenti per il grafico ───────────────────────────────────

export interface Bucket { a: string; b: string; asse: string }

/** Giorni del periodo, o mesi quando il periodo supera i 62 giorni. */
export function buckets(a: string, b: string, forza?: boolean): { lista: Bucket[]; mensile: boolean } {
  const mensile = forza ?? giorni(a, b) > 62
  const lista: Bucket[] = []
  if (mensile) {
    let y = +a.slice(0, 4), m = +a.slice(5, 7) - 1
    while (Date.UTC(y, m, 1) <= t(b)) {
      const ia = s(Math.max(t(a), Date.UTC(y, m, 1))), ib = s(Math.min(t(b), Date.UTC(y, m + 1, 0)))
      lista.push({ a: ia, b: ib, asse: MES[m] })
      m++; if (m > 11) { m = 0; y++ }
    }
  } else {
    for (let x = t(a); x <= t(b); x += D) {
      const d = new Date(x)
      lista.push({ a: s(x), b: s(x), asse: `${'DLMMGVS'[d.getUTCDay()]} ${d.getUTCDate()}` })
    }
  }
  return { lista, mensile }
}

export const inBucket = (data: string, k: Bucket) => data >= k.a && data <= k.b

export function etichettaBucket(k: Bucket, mensile: boolean): string {
  if (mensile) { const x = new Date(t(k.a)); return `${capit(MESI[x.getUTCMonth()])} ${x.getUTCFullYear()}` }
  return fdg(k.a)
}

// ── Formattazioni ───────────────────────────────────────────────────

export function eu(n: number, dec = 2): string {
  const neg = n < -0.0049
  const [a, b] = Math.abs(n).toFixed(dec).split('.')
  return `${neg ? '−' : ''}€ ${a.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${dec ? ',' + b : ''}`
}
export const sgn = (n: number, dec = 2) => (n > 0.0049 ? '+' : '') + eu(n, dec)
export const dV = (n: number) => (Math.abs(n) < 0.005 ? '€ 0,00' : sgn(n))
export const fN = (n: number) => Math.round(n).toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)
export const pc = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1).replace('.', ',')}%` : '—')
export const k1 = (n: number) => `${(n / 1000).toFixed(1).replace('.', ',')}k`

export type Tono = 'ok' | 'neg' | 'neutro'

/** Variazione percentuale con il verso "buono" (su per entrate, giù per spese). */
export function variazione(c: number, p: number, buono: 'su' | 'giu', assoluto = false): { testo: string; su: boolean; tono: Tono } | null {
  const cc = assoluto ? Math.abs(c) : c, pp = assoluto ? Math.abs(p) : p
  if (!pp) return null
  const v = ((cc - pp) / Math.abs(pp)) * 100
  const su = v >= 0
  const ok = buono === 'su' ? su : !su
  return { testo: `${Math.abs(v).toFixed(1).replace('.', ',')}%`, su, tono: Math.abs(v) < 0.05 ? 'neutro' : ok ? 'ok' : 'neg' }
}

/** "+3,7%" o "−2,1%" con il tono, per celle A contro B. */
export function delta(a: number, b: number, buono: 'su' | 'giu'): { testo: string; tono: Tono } {
  if (!b) return { testo: '—', tono: 'neutro' }
  const v = ((a - b) / Math.abs(b)) * 100
  const piatto = Math.abs(v) < 0.05
  const ok = buono === 'su' ? v > 0 : v < 0
  return { testo: `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')}%`, tono: piatto ? 'neutro' : ok ? 'ok' : 'neg' }
}

export const TONO_TESTO: Record<Tono, string> = { ok: 'text-ok', neg: 'text-neg', neutro: 'text-muted-foreground' }
export const TONO_PILLOLA: Record<Tono, string> = { ok: 'bg-ok-tint text-ok', neg: 'bg-neg-tint text-neg', neutro: 'bg-secondary text-muted-foreground' }

/** Curva morbida (Catmull-Rom semplificata) per sparkline e cumulate. */
export function curva(p: [number, number][]): string {
  if (p.length < 2) return p.map(q => q.join(',')).join(' L')
  let d = `${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2, k = 0.18
    const c1 = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k]
    const c2 = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

export const SOGLIA_DIFFERENZA = 5
export const MIN_GIORNI_ALERT = 3
