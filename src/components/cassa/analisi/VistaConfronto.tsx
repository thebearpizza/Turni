'use client'
import { createContext, useContext, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  giorni, giornoSett, mediaScontrino, inBucket, etichettaBucket, eu, fN, dV, k1, fdl, intervallo, delta, curva, WD, WDL,
  TONO_TESTO, SOGLIA_DIFFERENZA, MIN_GIORNI_ALERT, type Chiusura, type Aggregato, type Tono,
} from '@/lib/analisi'
import { ORD, TEAL } from '@/components/cassa/analisi/comuni'
import type { Ctx } from '@/components/cassa/analisi/tipi'

// ── Vista di confronto A contro B (design Manager Analisi, cmpOn) ─────
// Riproduce il blocco del prototipo valore per valore: misure, colori e
// ritardi delle animazioni sono quelli del template. I colori che non
// coincidono con un token dell'app sono variabili locali (sotto) con una
// variante per il tema scuro.

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)
const fp1 = (x: number) => x.toFixed(1).replace('.', ',')
/** "+€ 120" / "−€ 120": segno sempre esplicito, come sg2() del prototipo. */
const sg2 = (x: number, f: (n: number) => string) => (x >= 0 ? '+' : '−') + f(Math.abs(x))
const eu0 = (x: number) => eu(x, 0)
const COL_B = 'oklch(0.76 0.012 250)'

// Palette locale: valori esatti del prototipo in chiaro, equivalenti in scuro.
const PALETTE = [
  '[--ca:oklch(0.58_0.12_180)]',
  '[--cb:oklch(0.76_0.012_250)] dark:[--cb:oklch(0.46_0.012_250)]',
  '[--cbt:oklch(0.25_0.01_250)] dark:[--cbt:oklch(0.95_0.01_250)]',
  '[--trk:oklch(0.95_0.01_250)] dark:[--trk:oklch(0.24_0.01_250)]',
  '[--l94:oklch(0.94_0.01_250)] dark:[--l94:var(--line)]',
  '[--l93:oklch(0.93_0.01_250)] dark:[--l93:var(--line)]',
  '[--l88:oklch(0.88_0.01_250)] dark:[--l88:oklch(0.32_0.01_250)]',
  '[--l86:oklch(0.86_0.01_250)] dark:[--l86:oklch(0.36_0.01_250)]',
  '[--g94:oklch(0.94_0.008_250)] dark:[--g94:oklch(0.24_0.01_250)]',
  '[--hd:oklch(0.97_0.01_250)] dark:[--hd:oklch(0.15_0.01_250)]',
  '[--t25:oklch(0.25_0.01_250)] dark:[--t25:oklch(0.92_0.01_250)]',
  '[--t35:oklch(0.35_0.01_250)] dark:[--t35:oklch(0.8_0.01_250)]',
  '[--t40:oklch(0.4_0.01_250)] dark:[--t40:oklch(0.75_0.01_250)]',
  '[--t45:oklch(0.45_0.01_250)] dark:[--t45:oklch(0.72_0.01_250)]',
  '[--t50:oklch(0.5_0.01_250)] dark:[--t50:oklch(0.68_0.01_250)]',
  '[--t60:oklch(0.6_0.01_250)] dark:[--t60:oklch(0.58_0.01_250)]',
  '[--ta:oklch(0.95_0.035_180)] dark:[--ta:oklch(0.27_0.04_180)]',
  '[--tat:oklch(0.4_0.08_180)] dark:[--tat:oklch(0.82_0.08_180)]',
  '[--tas:oklch(0.4_0.03_180)] dark:[--tas:oklch(0.78_0.03_180)]',
  '[--bbg:oklch(0.97_0.004_250)] dark:[--bbg:oklch(0.16_0.006_250)]',
  '[--bbd:oklch(0.78_0.01_250)] dark:[--bbd:oklch(0.4_0.01_250)]',
  '[--tb:oklch(0.965_0.005_250)] dark:[--tb:oklch(0.22_0.01_250)]',
  '[--cbl:oklch(0.66_0.012_250)] dark:[--cbl:oklch(0.55_0.012_250)]',
  '[--tip:oklch(0.2_0.01_250)] dark:[--tip:oklch(0.3_0.01_250)]',
  '[--h1:oklch(0.96_0.01_250)] dark:[--h1:oklch(0.22_0.01_250)]',
  '[--h2:oklch(0.93_0.01_250)] dark:[--h2:oklch(0.18_0.01_250)]',
  '[--okb:oklch(0.94_0.04_150)] dark:[--okb:var(--ok-tint)]',
  '[--ngb:oklch(0.94_0.04_25)] dark:[--ngb:var(--neg-tint)]',
  '[--neb:oklch(0.94_0.01_250)] dark:[--neb:var(--tint)]',
].join(' ')

const SWAP = 'anim-swapin'
const CARD = 'flex flex-col rounded-[12px] border border-border bg-card'
const TRW = 'transition-[width] duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)]'
const RIGA = '-mx-2 grid min-h-[52px] cursor-pointer items-center gap-3 rounded-[8px] border-t border-(--l94) px-2 text-left hover:bg-background active:scale-[0.98]'
const PILL_TONO: Record<Tono, string> = { ok: 'bg-(--okb) text-ok', neg: 'bg-(--ngb) text-neg', neutro: 'bg-(--neb) text-muted-foreground' }
const TRATTEGGIO = 'repeating-linear-gradient(45deg,var(--h1) 0 6px,var(--h2) 6px 12px)'

const ritardo = (ms: number) => ({ animationDelay: `${ms}ms` })

// ── Pezzi comuni ─────────────────────────────────────────────────────

function Lettera({ l, d = 16 }: { l: 'A' | 'B'; d?: 16 | 18 | 42 }) {
  return (
    <span className={cn('inline-flex flex-none items-center justify-center font-sans font-semibold',
      d === 16 ? 'h-4 w-4 rounded-[4px] text-[9px]' : d === 18 ? 'h-[18px] w-[18px] rounded-[5px] text-[10px]' : 'h-[42px] w-[42px] rounded-[12px] text-[23px]',
      l === 'A' ? 'bg-(--ca) text-white' : 'bg-(--cb) text-(--cbt)')}>{l}</span>
  )
}

function Pillola({ d }: { d: { testo: string; tono: Tono } }) {
  return <span className={cn('inline-flex h-[22px] flex-none items-center justify-self-end whitespace-nowrap rounded-full px-2 font-mono text-[11.5px] font-semibold', PILL_TONO[d.tono])}>{d.testo}</span>
}

// Etichette di A e B: "Periodo A/B", o i nomi dei locali nel confronto tra locali.
const Etichette = createContext({ a: 'Periodo A', b: 'Periodo B' })

function Legenda() {
  const et = useContext(Etichette)
  return (
    <div className="flex items-center gap-[14px] text-[12px] font-medium text-(--t35)">
      <span className="flex items-center gap-1.5"><Lettera l="A" />{et.a}</span>
      <span className="flex items-center gap-1.5"><Lettera l="B" />{et.b}</span>
    </div>
  )
}

/** Intestazione delle card: titolo, sottotitolo e (a destra) la legenda A/B. */
function Testata({ titolo, sotto, legenda, centro, pb, px }: { titolo: string; sotto?: string; legenda?: boolean; centro?: boolean; pb?: boolean; px?: boolean }) {
  return (
    <div className={cn('flex flex-wrap', centro ? 'items-center gap-x-3 gap-y-1.5' : 'items-baseline gap-x-3 gap-y-0.5', pb && 'pb-1.5', px && 'px-5 pb-3 pt-[18px]')}>
      <span className="text-[17px] font-semibold">{titolo}</span>
      {sotto && <span className="text-[13px] text-muted-foreground">{sotto}</span>}
      {legenda && <><span className="flex-1" /><Legenda /></>}
    </div>
  )
}

function Barre({ wa, wb }: { wa: number; wb: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px]">
      <div className="h-2 rounded-[4px] bg-(--trk)"><div className={cn('h-full rounded-[4px] bg-(--ca)', TRW)} style={{ width: `${wa}%` }} /></div>
      <div className="h-2 rounded-[4px] bg-(--trk)"><div className={cn('h-full rounded-[4px] bg-(--cb)', TRW)} style={{ width: `${wb}%` }} /></div>
    </div>
  )
}

/** Riga etichetta · barre A/B · valori · delta (pagamenti, fatture, categorie). */
function RigaAB({ l, dot, a, b, wa, wb, d, cols, onClick }: { l: string; dot?: string; a: string; b: string; wa: number; wb: number; d: { testo: string; tono: Tono }; cols: string; onClick: (e: React.MouseEvent<Element>) => void }) {
  return (
    <button type="button" onClick={onClick} className={RIGA} style={{ gridTemplateColumns: cols }}>
      <span className="flex min-w-0 items-center gap-2 text-[14px] font-medium">{dot && <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: dot }} />}{l}</span>
      <Barre wa={wa} wb={wb} />
      <div className="flex flex-col items-end gap-px">
        <span className="whitespace-nowrap font-mono text-[13.5px] font-medium">{a}</span>
        <span className="whitespace-nowrap font-mono text-[12px] font-medium text-(--t50)">{b}</span>
      </div>
      <Pillola d={d} />
    </button>
  )
}

/** Larghezze delle due barre rispetto al massimo m (o al maggiore dei due). */
const pw = (x: number, y: number, m?: number) => { const mm = m || Math.max(Math.abs(x), Math.abs(y)) || 1; return { wa: (Math.abs(x) / mm) * 100, wb: (Math.abs(y) / mm) * 100 } }

/** Differenza in punti percentuali: scendere è buono (incidenza dei costi). */
const dpt = (x: number, y: number): { testo: string; tono: Tono } => { const d = x - y; return { testo: `${d >= 0 ? '+' : '−'}${fp1(Math.abs(d))} pt`, tono: Math.abs(d) < 0.05 ? 'neutro' : d < 0 ? 'ok' : 'neg' } }

// ── Vista ────────────────────────────────────────────────────────────

export function VistaConfronto({ c, onCambia, onSpegni }: { c: Ctx; onCambia: () => void; onSpegni: () => void }) {
  const { v, MET, tel } = c
  const X = v.X, P = v.P
  const N = v.bk.length
  const yoy = c.cmp === 'yoy'
  const et = c.coppia ?? { a: 'Periodo A', b: 'Periodo B' }
  // Nel confronto tra locali B è un solo locale: le righe per locale si
  // confrontano con tutto B, non con lo stesso locale in B.
  const diB = (li: string) => (c.coppia ? v.prev : v.prev.filter(r => r.li === li))

  // Hover condiviso tra il grafico a barre e la cumulata (hi del prototipo).
  const [hiS, setHi] = useState<number | null>(null)
  const [hiOut, setHiOut] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hi = hiS !== null && hiS < N ? hiS : null
  const mostra = (j: number) => { if (timer.current) clearTimeout(timer.current); setHi(j); setHiOut(false) }
  const nascondi = () => {
    if (hiS === null) return
    setHiOut(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { setHi(null); setHiOut(false) }, 170)
  }
  // Col mouse basta passare sopra; col dito solo mentre è premuto.
  const soloPremuto = (e: React.PointerEvent) => e.pointerType !== 'mouse' && e.type === 'pointermove' && !e.buttons
  const suRilascio = (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') nascondi() }

  // Layout telefono / tablet (embUI del prototipo).
  const L = tel
    ? { cHead: 'minmax(0,1fr)', cK: 'minmax(0,1fr)', g2b: 'minmax(0,1fr)', g115: 'minmax(0,1fr)', g11: 'minmax(0,1fr)', hCols: '72px repeat(7,minmax(0,1fr))', abCols: '98px minmax(0,1fr) 82px 64px', dfCols: 'minmax(0,1fr) 80px 80px 62px', siCols: 'minmax(0,1fr) minmax(0,1fr) 66px', siHd: 'none', siGap: '2px 12px', siPad: '10px 0', siLab: '1 / -1' }
    : { cHead: 'minmax(0,1fr) 230px minmax(0,1fr)', cK: 'repeat(3,minmax(0,1fr))', g2b: 'minmax(0,1fr) 380px', g115: 'minmax(0,1.15fr) minmax(0,1fr)', g11: 'minmax(0,1fr) minmax(0,1fr)', hCols: '120px repeat(7,minmax(0,1fr))', abCols: '118px minmax(0,1fr) 104px 74px', dfCols: 'minmax(0,1fr) 120px 120px 74px', siCols: 'minmax(0,1.15fr) minmax(0,1fr) minmax(0,1fr) 74px', siHd: 'block', siGap: '12px', siPad: '0', siLab: 'auto' }

  // ── Testata ──
  const nA = new Set(v.rows.map(r => r.data)).size, nB = new Set(v.prev.map(r => r.data)).size
  const durA = giorni(c.a, c.b), durB = giorni(c.B.a, c.B.b)
  const he = delta(X.ent, P.ent, 'su')
  const tipoB = { prev: 'periodo precedente', yoy: 'anno prima', custom: 'personalizzato', locali: 'stesso periodo' }[c.cmp ?? 'prev']
  const nota = c.coppia
    ? `Stesso periodo per ${c.coppia.a} e ${c.coppia.b}: nei grafici ogni giorno di A sta accanto allo stesso giorno di B.`
    : durA !== durB
    ? `A e B hanno durate diverse (${durA} e ${durB} giorni): nei grafici il 1° giorno di A sta accanto al 1° di B, e così via.`
    : 'Stessa durata: nei grafici ogni giorno di A sta accanto al corrispondente giorno di B.'

  // ── KPI ──
  const kpi = MET.map((m, i) => {
    const va = m.f(v.rows), vb = m.f(v.prev)
    const d = m.ass ? delta(Math.abs(va), Math.abs(vb), 'giu') : delta(va, vb, m.buono)
    return { l: m.l, a: m.fmt(va), b: m.fmt(vb), ...pw(va, vb), d, dAbs: sg2(va - vb, i === 4 ? fN : x => eu(x, i >= 3 ? 2 : 0)) }
  })

  // ── Grafico a barre A/B ──
  const tot = v.ser.map(x => sum(x, y => y)), yser = v.serB
  const mx0 = Math.max(Math.max(...tot, ...yser, 0) * 1.08, 1)
  const step = Math.pow(10, Math.floor(Math.log10(mx0 / 4))), nice = Math.ceil(mx0 / 4 / step) * step, mx = nice * 4
  const yp = (x: number) => 270 - (x / mx) * 260
  const griglia = [4, 3, 2, 1, 0].map(g => ({
    top: yp(g * nice) - 0.5, zero: !g,
    l: g ? (nice * g >= 1000 ? `${(nice * g / 1000).toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)}k` : String(nice * g)) : '0',
  }))
  const every = tel ? (N > 20 ? 6 : N > 12 ? 2 : 1) : N > 20 ? 3 : 1
  const colGap = tel ? (N > 20 ? '2px' : '4px') : N > 20 ? '3px' : '8px'
  const cgw = tel ? (N <= 8 ? '12px' : N <= 12 ? '8px' : N <= 20 ? '3px' : '2px') : N <= 8 ? '24px' : N <= 12 ? '18px' : N <= 20 ? '11px' : '7px'
  const colonne = v.bk.map((k, j) => {
    const vis = j % every === 0 || j === N - 1
    return {
      ha: tot[j] > 0 ? Math.max(2, (tot[j] / mx) * 260) : 0, hb: yser[j] > 0 ? Math.max(2, (yser[j] / mx) * 260) : 0,
      op: hi === null || hi === j ? 1 : 0.35, la: vis ? k.asse : '', lb: vis && v.cbk[j] ? v.cbk[j].asse : '', bold: hi === j,
    }
  })
  let tip: { pa: string; pb: string; va: string; vb: string; dAbs: string; d: { testo: string; tono: Tono } } | null = null
  let tipLeft = '0px'
  if (hi !== null) {
    const kb = v.cbk[hi]
    tip = {
      pa: etichettaBucket(v.bk[hi], v.mensile), pb: c.etichettaB(kb), va: eu0(tot[hi]), vb: kb ? eu0(yser[hi]) : '—',
      d: delta(tot[hi], yser[hi], 'su'), dAbs: kb ? sg2(tot[hi] - yser[hi], eu0) : '',
    }
    const px = (hi + 0.5) / N
    tipLeft = tel ? (px > 0.5 ? '44px' : 'calc(100% - 240px)') : `calc(44px + (100% - 44px) * ${px.toFixed(4)} ${px > 0.62 ? '- 252px' : '+ 28px'})`
  }
  const sceltaBarre = (e: React.PointerEvent<HTMLDivElement>) => {
    if (soloPremuto(e)) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left - 44
    mostra(Math.max(0, Math.min(N - 1, Math.floor(x / ((r.width - 44) / N)))))
  }
  const clickBarre = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget, r = el.getBoundingClientRect(), sc = r.width / el.offsetWidth
    const x = (e.clientX - r.left) / sc - 44
    if (x < 0) return
    const j = Math.max(0, Math.min(N - 1, Math.floor(x / ((el.offsetWidth - 44) / N))))
    if (!v.rows.some(q => inBucket(q.data, v.bk[j]))) return
    nascondi()
    c.apri(v.mensile ? { k: 'month', j } : { k: 'day', d: v.bk[j].a })
  }

  // ── Entrate cumulate ──
  const cA: number[] = [], cB: number[] = []
  let sa = 0, sb = 0
  v.bk.forEach((_, j) => { sa += tot[j]; cA.push(sa); if (v.cbk[j]) { sb += yser[j]; cB.push(sb) } })
  const cmx = Math.max(sa, sb) * 1.06 || 1
  const Xc = (j: number) => (N > 1 ? (j / (N - 1)) * 300 : 150), Yc = (x: number) => 210 - (x / cmx) * 200
  const pA: [number, number][] = cA.map((x, j) => [Xc(j), Yc(x)]), pB: [number, number][] = cB.map((x, j) => [Xc(j), Yc(x)])
  const lead = sa - sb, cd = delta(sa, sb, 'su')
  const cu = {
    a: pA.length > 1 ? `M${curva(pA)}` : '', b: pB.length > 1 ? `M${curva(pB)}` : '',
    area: pA.length > 1 ? `M0,210 L${curva(pA)} L${Xc(N - 1)},210 Z` : '',
    msg: lead >= 0 ? `A è avanti di ${eu0(lead)}` : `A è indietro di ${eu0(-lead)}`,
  }
  const cuHi = hi === null ? null : (() => {
    const fx = N > 1 ? hi / (N - 1) : 0.5
    return {
      hx: `${(fx * 100).toFixed(3)}%`, ya: Yc(cA[hi]), yb: cB[hi] != null ? Yc(cB[hi]) : null,
      tl: fx > 0.5 ? `calc(${(fx * 100).toFixed(3)}% - 188px)` : `calc(${(fx * 100).toFixed(3)}% + 12px)`,
      hl: `Dopo ${hi + 1}${v.mensile ? (hi ? ' mesi' : ' mese') : (hi ? ' giorni' : ' giorno')}`,
      va: eu0(cA[hi]), vb: cB[hi] != null ? eu0(cB[hi]) : '—',
    }
  })()
  const sceltaCumulata = (e: React.PointerEvent<HTMLDivElement>) => {
    if (soloPremuto(e)) return
    const r = e.currentTarget.getBoundingClientRect()
    mostra(Math.max(0, Math.min(N - 1, Math.round(((e.clientX - r.left) / r.width) * (N - 1)))))
  }

  // ── Sintesi ──
  const giorniOrd = (rs: Chiusura[]) => { const g = new Map<string, number>(); for (const r of rs) g.set(r.data, (g.get(r.data) ?? 0) + r.ent); return [...g.entries()].sort((p, q) => q[1] - p[1]) }
  const dA = giorniOrd(v.rows), dB = giorniOrd(v.prev)
  const lab = (d: string, isB?: boolean) => fdl(d) + (isB && yoy ? ` ${d.slice(0, 4)}` : '')
  const mA = X.ent / (nA || 1), mB = P.ent / (nB || 1), kA = X.cop / (nA || 1), kB = P.cop / (nB || 1)
  const bA = dA[0], wA = dA[dA.length - 1], bB = dB[0], wB = dB[dB.length - 1]
  const giornoA = (x?: [string, number]) => (x ? () => c.apri({ k: 'day', d: x[0] }) : undefined)
  const giornoB = (x?: [string, number]) => (x ? () => c.apri({ k: 'day', d: x[0], src: 'B' }) : undefined)
  const sintesi: { l: string; a: string; as: string; b: string; bs: string; d: { testo: string; tono: Tono }; onA?: () => void; onB?: () => void }[] = [
    { l: 'Entrate medie al giorno', a: eu0(mA), as: '', b: eu0(mB), bs: '', d: delta(mA, mB, 'su') },
    { l: 'Coperti medi al giorno', a: fN(kA), as: '', b: fN(kB), bs: '', d: delta(kA, kB, 'su') },
    { l: 'Giorno migliore', a: bA ? eu0(bA[1]) : '—', as: bA ? lab(bA[0]) : '', b: bB ? eu0(bB[1]) : '—', bs: bB ? lab(bB[0], true) : '', d: delta(bA?.[1] ?? 0, bB?.[1] ?? 0, 'su'), onA: giornoA(bA), onB: giornoB(bB) },
    { l: 'Giorno peggiore', a: wA ? eu0(wA[1]) : '—', as: wA ? lab(wA[0]) : '', b: wB ? eu0(wB[1]) : '—', bs: wB ? lab(wB[0], true) : '', d: delta(wA?.[1] ?? 0, wB?.[1] ?? 0, 'su'), onA: giornoA(wA), onB: giornoB(wB) },
  ]
  let vinti = 0, conf = 0
  v.bk.forEach((_, j) => { if (v.cbk[j] && (tot[j] || yser[j])) { conf++; if (tot[j] > yser[j]) vinti++ } })

  // ── Pagamenti ──
  const PY = [['POS', 'pos'], ['Contanti', 'con'], ['Bonifico', 'bon'], ['Asporto', 'asp']] as const
  const pM = Math.max(...PY.map(([, k]) => Math.max(X[k], P[k]))) || 1

  // ── Ristoranti ──
  const TG: [string, (x: Aggregato) => number, (x: number) => string, 'su' | 'giu'][] = [
    ['Entrate', x => x.ent, eu0, 'su'], ['Spese', x => x.sp, eu0, 'giu'], ['Margine', x => x.ent - x.sp, eu0, 'su'],
    ['Coperti', x => x.cop, fN, 'su'], ['Media scontrino', x => mediaScontrino(x), x => (x ? eu(x) : '—'), 'su'],
  ]
  const celle = (xa: Aggregato, xb: Aggregato) => TG.map(([l, f, fm, up]) => { const va = f(xa), vb = f(xb); return { k: l, a: fm(va), b: xb.ent ? fm(vb) : '—', d: delta(va, vb, up) } })
  const COLS_T = { gridTemplateColumns: '160px repeat(5,92px 86px 66px)' }

  // ── Acquisti da fatture ──
  const fM = Math.max(c.gv(c.FA, 'tot'), c.gv(c.FB, 'tot')) || 1
  const FP = ([['Food cost', 'fo'], ['Beverage cost', 'be'], ['F&B cost', 'fb']] as const).map(([l, k]) => ({ l, k, pa: X.ent ? (c.gv(c.FA, k) / X.ent) * 100 : 0, pb: P.ent ? (c.gv(c.FB, k) / P.ent) * 100 : 0 }))
  const ppM = Math.max(...FP.map(x => Math.max(x.pa, x.pb))) || 1

  // ── Spese e vendite per categoria ──
  const catA = (k: string) => sum(c.dati.spA.filter(x => x.categoria === k), x => x.importo), catB = (k: string) => sum(c.dati.spB.filter(x => x.categoria === k), x => x.importo)
  const sM = Math.max(...v.categorie.map(k => Math.max(catA(k.c), catB(k.c))), 0) || 1
  const vA = (k: string) => sum(c.dati.veA.filter(x => x.categoria === k), x => x.importo), vB = (k: string) => sum(c.dati.veB.filter(x => x.categoria === k), x => x.importo)
  const venCat = [...new Set([...c.dati.veA, ...c.dati.veB].map(x => x.categoria))].sort((p, q) => vA(q) - vA(p))
  const vM = Math.max(...venCat.map(k => Math.max(vA(k), vB(k))), 0) || 1

  const testoDif = (x: number) => (Math.abs(x) < 0.005 ? 'text-ok' : 'text-neg')

  return (
    <Etichette.Provider value={et}>
    <div className={cn('contents leading-[normal]', PALETTE)}>
      {/* Testata A · differenza · B */}
      <div className={cn(SWAP, 'grid gap-3')} style={{ gridTemplateColumns: L.cHead }}>
        <div className="flex items-center gap-[14px] rounded-[14px] bg-(--ta) px-[18px] py-4">
          <Lettera l="A" d={42} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-(--tat)">{c.coppia ? 'Locale A' : 'Periodo A · analizzato'}</span>
            <span className="text-[19px] font-semibold">{c.coppia ? c.coppia.a : intervallo(c.a, c.b)}</span>
            <span className="text-[13px] text-(--tas)">{c.coppia ? `${intervallo(c.a, c.b)} · ` : ''}{nA} giorni · {v.rows.length} chiusure</span>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center gap-1 rounded-[14px] border border-border bg-card p-3">
          <span className="text-[12px] font-medium text-muted-foreground">Entrate di A rispetto a B</span>
          <span className={cn('font-mono text-[28px] font-semibold tracking-[-0.02em]', TONO_TESTO[he.tono])}>{he.testo}</span>
          <span className={cn('font-mono text-[13px] font-medium', TONO_TESTO[he.tono])}>{sg2(X.ent - P.ent, eu0)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[10px] rounded-[14px] border-[1.5px] border-dashed border-(--bbd) bg-(--bbg) py-[14px] pl-[18px] pr-3">
          <Lettera l="B" d={42} />
          <div className="flex min-w-0 flex-[1_1_160px] flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{c.coppia ? 'Locale B · stesso periodo' : `Periodo B · ${tipoB}`}</span>
            <span className="text-[19px] font-semibold">{c.coppia ? c.coppia.b : intervallo(c.B.a, c.B.b)}</span>
            <span className="text-[13px] text-muted-foreground">{c.coppia ? `${intervallo(c.B.a, c.B.b)} · ` : ''}{nB} giorni · {v.prev.length} chiusure</span>
          </div>
          <button type="button" data-pop onClick={onCambia} className="ml-auto flex h-10 flex-none cursor-pointer items-center rounded-[10px] border border-line-strong bg-card px-[14px] text-[13px] font-medium active:scale-[0.97]">Cambia</button>
          <button type="button" onClick={onSpegni} aria-label="Togli il confronto" className="flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-[20px] text-muted-foreground active:scale-[0.96]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
      <span className="-mt-1.5 text-[13px] text-muted-foreground">{nota}</span>

      {/* KPI A contro B */}
      <div className="grid gap-3" style={{ gridTemplateColumns: L.cK }}>
        {kpi.map((k, i) => (
          <button key={k.l} type="button" onClick={() => c.apri({ k: 'kpi', i })} className={cn(SWAP, 'flex cursor-pointer flex-col gap-2.5 rounded-[12px] border border-border bg-card px-4 py-[14px] text-left active:scale-[0.98]')} style={ritardo(i * 50)}>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[13px] font-medium text-muted-foreground">{k.l}</span>
              <Pillola d={k.d} />
            </div>
            <div className="grid items-center gap-x-2.5 gap-y-2" style={{ gridTemplateColumns: '18px auto minmax(0,1fr)' }}>
              <Lettera l="A" d={18} />
              <span className="whitespace-nowrap font-mono text-[22px] font-semibold tracking-[-0.02em]">{k.a}</span>
              <div className="h-2 rounded-[4px] bg-(--trk)"><div className={cn('h-full rounded-[4px] bg-(--ca)', TRW)} style={{ width: `${k.wa}%` }} /></div>
              <Lettera l="B" d={18} />
              <span className="whitespace-nowrap font-mono text-[16px] font-medium text-(--t45)">{k.b}</span>
              <div className="h-2 rounded-[4px] bg-(--trk)"><div className={cn('h-full rounded-[4px] bg-(--cb)', TRW)} style={{ width: `${k.wb}%` }} /></div>
            </div>
            <span className={cn('font-mono text-[12px] font-medium', TONO_TESTO[k.d.tono])}>{k.dAbs}<span className="font-sans font-normal text-muted-foreground"> rispetto a B</span></span>
          </button>
        ))}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: L.g2b }}>
        {/* Entrate A e B: barre affiancate */}
        <section className={cn(SWAP, CARD, 'min-w-0 gap-2.5 px-5 pb-[14px] pt-[18px]')} style={ritardo(180)}>
          <Testata titolo="Entrate A e B" sotto={v.mensile ? 'per mese · A a sinistra, B a destra' : 'per giorno · A a sinistra, B a destra'} legenda centro />
          <div onPointerMove={sceltaBarre} onPointerDown={sceltaBarre} onPointerLeave={nascondi} onPointerUp={suRilascio} onPointerCancel={nascondi} onClick={clickBarre}
            className="relative h-[322px] cursor-pointer touch-none">
            <div className="absolute inset-x-0 top-0 h-[280px]">
              {griglia.map((g, q) => (
                <div key={q} className="absolute inset-x-0 flex items-center gap-2.5" style={{ top: `${g.top}px` }}>
                  <span className="w-[34px] text-right font-mono text-[11px] font-medium text-(--t60)">{g.l}</span>
                  <span className={cn('h-px flex-1', g.zero ? 'bg-(--l86)' : 'bg-(--g94)')} />
                </div>
              ))}
            </div>
            <div className="absolute left-[44px] right-0 top-0 flex h-[280px] items-end" style={{ gap: colGap }}>
              {colonne.map((g, j) => (
                <div key={j} className="flex h-[270px] min-w-0 flex-1 items-end justify-center gap-[3px] transition-opacity duration-[180ms] ease-[ease]" style={{ opacity: g.op }}>
                  <div className="rounded-[6px_6px_3px_3px] bg-(--ca) transition-[height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ width: cgw, height: `${g.ha}px` }} />
                  <div className="rounded-[6px_6px_3px_3px] bg-(--cb) transition-[height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ width: cgw, height: `${g.hb}px` }} />
                </div>
              ))}
            </div>
            <div className="absolute left-[44px] right-0 top-[286px] flex" style={{ gap: colGap }}>
              {colonne.map((g, j) => (
                <div key={j} className="flex min-w-0 flex-1 flex-col items-center gap-px whitespace-nowrap">
                  <span className={cn('font-mono text-[11px] text-(--t25)', g.bold ? 'font-bold' : 'font-medium')}>{g.la}</span>
                  <span className="font-mono text-[10.5px] font-medium text-(--t60)">{g.lb}</span>
                </div>
              ))}
            </div>
            {tip && (
              <div className="pointer-events-none absolute top-2 z-[5] flex w-[240px] flex-col gap-2 rounded-[10px] bg-(--tip) px-[14px] py-3 text-white shadow-[0_8px_24px_rgba(20,30,50,.2)] transition-[opacity,left] duration-[160ms,120ms] ease-[ease]"
                style={{ left: tipLeft, opacity: hiOut ? 0 : 1 }}>
                <div className="flex items-center gap-2">
                  <Lettera l="A" />
                  <span className="flex-1 text-[12.5px] font-medium">{tip.pa}</span>
                  <span className="font-mono text-[13px] font-semibold">{tip.va}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Lettera l="B" />
                  <span className="flex-1 text-[12.5px] opacity-80">{tip.pb}</span>
                  <span className="font-mono text-[13px] font-medium opacity-[.85]">{tip.vb}</span>
                </div>
                <div className="flex items-center gap-2 border-t border-[rgba(255,255,255,.18)] pt-2">
                  <span className="flex-1 text-[12px] font-medium">Differenza</span>
                  <span className="font-mono text-[12px] font-medium opacity-[.85]">{tip.dAbs}</span>
                  <Pillola d={tip.d} />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Entrate cumulate */}
        <section className={cn(SWAP, CARD, 'min-w-0 gap-3 px-5 py-[18px]')} style={ritardo(240)}>
          <Testata titolo="Entrate cumulate" sotto="chi è avanti, giorno dopo giorno" />
          <div onPointerMove={sceltaCumulata} onPointerDown={sceltaCumulata} onPointerLeave={nascondi} onPointerUp={suRilascio} onPointerCancel={nascondi}
            className="relative h-[220px] cursor-crosshair touch-none">
            <svg width="100%" height="220" viewBox="0 0 300 220" preserveAspectRatio="none" className="block" aria-hidden>
              <line x1="0" y1="210" x2="300" y2="210" strokeWidth="1" vectorEffect="non-scaling-stroke" style={{ stroke: 'var(--l88)' }} />
              {cu.area && <path d={cu.area} fill="oklch(0.58 0.12 180 / .1)" />}
              {cu.b && <path d={cu.b} fill="none" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" style={{ stroke: 'var(--cbl)' }} />}
              {cu.a && <path d={cu.a} fill="none" stroke={TEAL} strokeWidth="2.4" vectorEffect="non-scaling-stroke" />}
            </svg>
            {cuHi && (
              <>
                <div className="pointer-events-none absolute top-0 h-[210px] w-px bg-line-strong" style={{ left: cuHi.hx }} />
                {cuHi.yb !== null && <div className="pointer-events-none absolute -ml-[5px] -mt-[5px] h-2.5 w-2.5 rounded-[5px] border-2 border-(--cbl) bg-card" style={{ left: cuHi.hx, top: `${cuHi.yb}px` }} />}
                <div className="pointer-events-none absolute -ml-[5px] -mt-[5px] h-2.5 w-2.5 rounded-[5px] border-2 border-(--ca) bg-card" style={{ left: cuHi.hx, top: `${cuHi.ya}px` }} />
                <div className="pointer-events-none absolute top-0 z-[5] flex w-[176px] flex-col gap-1.5 rounded-[10px] bg-(--tip) px-3 py-2.5 text-white transition-opacity duration-[160ms] ease-[ease]"
                  style={{ left: cuHi.tl, opacity: hiOut ? 0 : 1 }}>
                  <span className="text-[11.5px] font-medium opacity-80">{cuHi.hl}</span>
                  <div className="flex items-center gap-2"><Lettera l="A" /><span className="flex-1" /><span className="font-mono text-[12.5px] font-semibold">{cuHi.va}</span></div>
                  <div className="flex items-center gap-2"><Lettera l="B" /><span className="flex-1" /><span className="font-mono text-[12.5px] font-medium opacity-[.85]">{cuHi.vb}</span></div>
                </div>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5 rounded-[10px] bg-(--ta) px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-(--tat)"><Lettera l="A" />Totale A</span>
              <span className="font-mono text-[17px] font-semibold">{eu0(sa)}</span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-[10px] bg-(--tb) px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><Lettera l="B" />Totale B</span>
              <span className="font-mono text-[17px] font-semibold text-(--t40)">{eu0(sb)}</span>
            </div>
          </div>
          <div className={cn('mt-auto flex items-center gap-2 rounded-[10px] px-[14px] py-3', PILL_TONO[cd.tono])}>
            <span className={cn('flex-1 text-[14px] font-semibold', TONO_TESTO[cd.tono])}>{cu.msg}</span>
            <span className={cn('font-mono text-[14px] font-semibold', TONO_TESTO[cd.tono])}>{cd.testo}</span>
          </div>
        </section>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: L.g11 }}>
        {/* Sintesi */}
        <section className={cn(SWAP, CARD, 'min-w-0 gap-2.5 px-5 py-[18px]')} style={ritardo(300)}>
          <Testata titolo="Sintesi" sotto="i numeri chiave affiancati" />
          <div className="grid items-center gap-3 pt-1" style={{ gridTemplateColumns: L.siCols }}>
            <span style={{ display: L.siHd }} />
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><Lettera l="A" />{et.a}</span>
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><Lettera l="B" />{et.b}</span>
            <span className="text-right text-[12px] font-medium text-muted-foreground">A vs B</span>
          </div>
          {sintesi.map(s => {
            const sD = s.as || s.bs ? 'block' : 'none'
            return (
              <div key={s.l} className="grid min-h-[56px] items-center border-t border-(--l94)" style={{ gridTemplateColumns: L.siCols, gap: L.siGap, padding: L.siPad }}>
                <span className="text-[14px] font-medium" style={{ gridColumn: L.siLab }}>{s.l}</span>
                <button type="button" disabled={!s.onA} onClick={s.onA} className={cn('-mx-2 flex flex-col gap-px rounded-[8px] px-2 py-1.5 text-left', s.onA ? 'cursor-pointer' : 'cursor-default')}>
                  <span className="font-mono text-[15px] font-semibold">{s.a}</span>
                  <span className="text-[12px] text-muted-foreground" style={{ display: sD }}>{s.as}</span>
                </button>
                <button type="button" disabled={!s.onB} onClick={s.onB} className={cn('-mx-2 flex flex-col gap-px rounded-[8px] px-2 py-1.5 text-left', s.onB ? 'cursor-pointer' : 'cursor-default')}>
                  <span className="font-mono text-[15px] font-medium text-(--t40)">{s.b}</span>
                  <span className="text-[12px] text-muted-foreground" style={{ display: sD }}>{s.bs}</span>
                </button>
                <Pillola d={s.d} />
              </div>
            )
          })}
          <div className="mt-auto flex flex-col gap-2 border-t border-(--l94) pt-[14px]">
            <div className="flex items-baseline gap-2.5">
              <span className="font-mono text-[20px] font-semibold">{vinti} su {conf}</span>
              <span className="text-[13px] text-muted-foreground">{v.mensile ? 'mesi' : 'giorni'} in cui A ha incassato più di B</span>
            </div>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px] bg-card">
              <div className={cn('bg-(--ca)', TRW)} style={{ width: `${conf ? (vinti / conf) * 100 : 0}%` }} />
              <div className="flex-1 bg-(--cb)" />
            </div>
          </div>
        </section>

        {/* Pagamenti */}
        <section className={cn(SWAP, CARD, 'min-w-0 gap-1.5 px-5 py-[18px]')} style={ritardo(360)}>
          <Testata titolo="Pagamenti" legenda centro pb />
          {PY.map(([l, k]) => (
            <RigaAB key={k} l={l} a={eu0(X[k])} b={eu0(P[k])} {...pw(X[k], P[k], pM)} d={delta(X[k], P[k], 'su')} cols={L.abCols}
              onClick={k === 'asp' ? c.fumAsporto : c.fumPagamento(l, k)} />
          ))}
        </section>
      </div>

      {/* Ristoranti: tabella A contro B */}
      <section className={cn(SWAP, 'overflow-hidden rounded-[12px] border border-border bg-card')} style={ritardo(420)}>
        <Testata titolo="Ristoranti" sotto="A contro B · tocca una riga per il dettaglio" legenda centro px />
        <div className="overflow-x-auto overscroll-contain">
          <div className="grid w-max min-w-full gap-x-2.5 border-t border-(--l93) bg-(--hd) px-5 pt-2.5" style={COLS_T}>
            <span className="sticky left-0 bg-(--hd)" />
            {TG.map(g => <span key={g[0]} className="col-span-3 border-b border-(--l88) pb-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-(--t35)">{g[0]}</span>)}
          </div>
          <div className="grid w-max min-w-full gap-x-2.5 bg-(--hd) px-5 pb-2 pt-1.5 text-[12px] font-medium text-muted-foreground" style={COLS_T}>
            <span className="sticky left-0 bg-(--hd)">Ristorante</span>
            {TG.map(g => [
              <span key={g[0] + 'a'} className="flex justify-end"><Lettera l="A" /></span>,
              <span key={g[0] + 'b'} className="flex justify-end"><Lettera l="B" /></span>,
              <span key={g[0] + 'd'} className="text-right">Δ</span>,
            ])}
          </div>
          {v.sedi.map(s => (
            <button key={s.l.id} type="button" onClick={() => c.apri({ k: 'loc', li: s.l.id })}
              className="grid min-h-[56px] w-max min-w-full cursor-pointer items-center gap-x-2.5 border-t border-(--l93) bg-card px-5 text-left hover:bg-background active:scale-[0.995]" style={COLS_T}>
              <span className="sticky left-0 flex items-center gap-2.5 self-stretch bg-inherit text-[14px] font-semibold">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.l.colore }} />{s.l.nome}
              </span>
              {celle(s.x, s.y).map(x => [
                <span key={x.k + 'a'} className="whitespace-nowrap text-right font-mono text-[14px] font-medium">{x.a}</span>,
                <span key={x.k + 'b'} className="whitespace-nowrap text-right font-mono text-[13px] font-medium text-(--t50)">{x.b}</span>,
                <span key={x.k + 'd'} className={cn('whitespace-nowrap text-right font-mono text-[12px] font-semibold', TONO_TESTO[x.d.tono])}>{x.d.testo}</span>,
              ])}
            </button>
          ))}
          <div className="grid min-h-[52px] w-max min-w-full items-center gap-x-2.5 border-t border-(--l86) bg-(--hd) px-5" style={COLS_T}>
            <span className="sticky left-0 flex items-center self-stretch bg-(--hd) text-[14px] font-semibold">Totale</span>
            {celle(X, P).map(x => [
              <span key={x.k + 'a'} className="whitespace-nowrap text-right font-mono text-[14px] font-semibold">{x.a}</span>,
              <span key={x.k + 'b'} className="whitespace-nowrap text-right font-mono text-[13px] font-semibold text-(--t45)">{x.b}</span>,
              <span key={x.k + 'd'} className={cn('whitespace-nowrap text-right font-mono text-[12px] font-bold', TONO_TESTO[x.d.tono])}>{x.d.testo}</span>,
            ])}
          </div>
        </div>
      </section>

      {/* Acquisti da fatture */}
      <section className={cn(SWAP, CARD, 'gap-1.5 px-5 py-[18px]')} style={ritardo(460)}>
        <Testata titolo="Acquisti da fatture" sotto="importi e incidenza sulle entrate di ciascun periodo" legenda centro pb />
        <div className="grid gap-x-8" style={{ gridTemplateColumns: L.g11 }}>
          <div className="flex flex-col">
            {([['Totale fatture', 'tot'], ['Food', 'fo'], ['Beverage', 'be'], ['No food', 'nf']] as const).map(([l, k]) => {
              const va = c.gv(c.FA, k), vb = c.gv(c.FB, k)
              return <RigaAB key={k} l={l} a={eu0(va)} b={eu0(vb)} {...pw(va, vb, fM)} d={delta(va, vb, 'giu')} cols={L.abCols} onClick={c.fumFattura(l, k)} />
            })}
          </div>
          <div className="flex flex-col">
            {FP.map(x => <RigaAB key={x.k} l={x.l} a={`${fp1(x.pa)}%`} b={`${fp1(x.pb)}%`} {...pw(x.pa, x.pb, ppM)} d={dpt(x.pa, x.pb)} cols={L.abCols} onClick={c.fumIncidenza(x.l, x.k)} />)}
          </div>
        </div>
      </section>

      <div className="grid gap-4" style={{ gridTemplateColumns: L.g115 }}>
        {/* Giorni della settimana */}
        <section className={cn(SWAP, CARD, 'min-w-0 gap-3 px-5 py-[18px]')} style={ritardo(500)}>
          <Testata titolo="Giorni della settimana" sotto="media entrate di A rispetto a B" />
          <div className="grid items-center gap-1" style={{ gridTemplateColumns: L.hCols }}>
            <span />
            {ORD.map(w => <span key={w} className="text-center text-[12px] font-medium text-muted-foreground">{WD[w]}</span>)}
            {v.locSel.map(l => [
              <span key={l.id} className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium">{l.nome}</span>,
              ...ORD.map(w => {
                const ra = v.rows.filter(r => r.li === l.id && giornoSett(r.data) === w), rb = diB(l.id).filter(r => giornoSett(r.data) === w)
                if (!ra.length || !rb.length) return <div key={`${l.id}${w}`} className="flex h-12 items-center justify-center rounded-[6px] font-mono text-[12px] font-medium text-muted-foreground" style={{ background: TRATTEGGIO }}>—</div>
                const ma = sum(ra, r => r.ent) / ra.length, mb = sum(rb, r => r.ent) / rb.length, pv = ((ma - mb) / mb) * 100, tt = Math.min(1, Math.abs(pv) / 25), pos = pv >= 0
                return (
                  <button key={`${l.id}${w}`} type="button"
                    onClick={c.fumetto(`${l.nome} · ${WDL[w].toLowerCase()}`, 'media entrate, A contro B', [
                      { l: `${et.a} · ${ra.length} giorni`, v: eu0(ma), dot: TEAL }, { l: `${et.b} · ${rb.length} giorni`, v: eu0(mb), dot: COL_B },
                      { l: 'Differenza', v: `${ma >= mb ? '+' : '−'}${eu0(Math.abs(ma - mb))}`, tono: ma >= mb ? 'ok' : 'neg', p: `${ma >= mb ? '+' : '−'}${fp1(Math.abs(pv))}%` },
                    ])}
                    className="flex h-12 cursor-pointer flex-col items-center justify-center gap-px rounded-[6px] active:scale-[0.98]"
                    style={{ background: `oklch(${(0.96 - tt * 0.34).toFixed(3)} ${(0.02 + tt * 0.09).toFixed(3)} ${pos ? 150 : 25})`, color: tt > 0.6 ? '#fff' : 'oklch(0.2 0.01 250)' }}>
                    <span className="font-mono text-[13px] font-semibold">{pos ? '+' : '−'}{Math.abs(pv).toFixed(0)}%</span>
                    <span className="font-mono text-[10px] font-medium opacity-75">{k1(ma)}</span>
                  </button>
                )
              }),
            ])}
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="h-3 w-3 rounded-[3px] bg-[oklch(0.62_0.11_25)]" />A sotto B<span className="ml-2 h-3 w-3 rounded-[3px] bg-[oklch(0.62_0.11_150)]" />A sopra B<span className="ml-2">· in piccolo la media di A</span>
          </div>
        </section>

        {/* Spese per categoria */}
        <section className={cn(SWAP, CARD, 'min-w-0 gap-1.5 px-5 py-[18px]')} style={ritardo(540)}>
          <Testata titolo="Spese per categoria" sotto="pagate in contanti dalle chiusure" pb />
          {v.categorie.length === 0 ? <span className="py-2 text-[13px] text-muted-foreground">Nessuna spesa di cassa nei due periodi.</span>
            : v.categorie.map(k => <RigaAB key={k.c} l={k.c} dot={k.col} a={eu0(catA(k.c))} b={eu0(catB(k.c))} {...pw(catA(k.c), catB(k.c), sM)} d={delta(catA(k.c), catB(k.c), 'giu')} cols={L.abCols} onClick={c.fumCategoria(k.c, c.dati.spA, true)} />)}
        </section>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: L.g11 }}>
        {/* Vendite per categoria */}
        <section className={cn(SWAP, CARD, 'min-w-0 gap-1.5 px-5 py-[18px]')} style={ritardo(580)}>
          <Testata titolo="Vendite per categoria" sotto="dal report di chiusura" pb />
          {venCat.length === 0 ? <span className="py-2 text-[13px] text-muted-foreground">Nessun report vendite nei due periodi.</span>
            : venCat.map(k => <RigaAB key={k} l={k} a={eu0(vA(k))} b={eu0(vB(k))} {...pw(vA(k), vB(k), vM)} d={delta(vA(k), vB(k), 'su')} cols={L.abCols} onClick={c.fumCategoria(k, c.dati.veA, false)} />)}
        </section>

        {/* Differenze di cassa */}
        <section className={cn(SWAP, CARD, 'min-w-0 gap-1.5 px-5 py-[18px]')} style={ritardo(620)}>
          <Testata titolo="Differenze di cassa" sotto={`totale per locale · giorni oltre ${SOGLIA_DIFFERENZA} €`} pb />
          <div className="grid items-center gap-3 pb-1 text-[12px] font-medium text-muted-foreground" style={{ gridTemplateColumns: L.dfCols }}>
            <span />
            <span className="flex items-center justify-end gap-1.5"><Lettera l="A" />{et.a}</span>
            <span className="flex items-center justify-end gap-1.5"><Lettera l="B" />{et.b}</span>
            <span className="text-right">A vs B</span>
          </div>
          {v.sedi.map(s => {
            const ga = s.rs.filter(r => Math.abs(r.dif) >= SOGLIA_DIFFERENZA).length, gb = diB(s.l.id).filter(r => Math.abs(r.dif) >= SOGLIA_DIFFERENZA).length
            return (
              <button key={s.l.id} type="button" onClick={() => c.apri(ga >= MIN_GIORNI_ALERT ? { k: 'alert', li: s.l.id } : { k: 'loc', li: s.l.id })}
                className={RIGA} style={{ gridTemplateColumns: L.dfCols }}>
                <span className="flex items-center gap-2 text-[14px] font-medium"><span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: s.l.colore }} />{s.l.nome}</span>
                <div className="flex flex-col items-end">
                  <span className={cn('font-mono text-[13.5px] font-medium', testoDif(s.x.dif))}>{dV(s.x.dif)}</span>
                  <span className="text-[11.5px] text-muted-foreground">{ga} {ga === 1 ? 'giorno' : 'giorni'} oltre soglia</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className={cn('font-mono text-[13px] font-medium', testoDif(s.y.dif))}>{dV(s.y.dif)}</span>
                  <span className="text-[11.5px] text-muted-foreground">{gb} {gb === 1 ? 'giorno' : 'giorni'} oltre soglia</span>
                </div>
                <Pillola d={delta(Math.abs(s.x.dif), Math.abs(s.y.dif), 'giu')} />
              </button>
            )
          })}
        </section>
      </div>
    </div>
    </Etichette.Provider>
  )
}
