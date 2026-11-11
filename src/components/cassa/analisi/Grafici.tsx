'use client'
import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { curva, TONO_PILLOLA, type Tono } from '@/lib/analisi'

// Grafici del design Manager Analisi, disegnati a mano (SVG e div) per
// avere esattamente gli stessi gesti del prototipo: scrub col dito o col
// mouse che mostra il giorno, tocco che apre il dettaglio.

/** Gestione condivisa dello scrub: mouse in hover, dito mentre è premuto. */
function useScrub(n: number, posizione: (e: React.PointerEvent<HTMLElement>, r: DOMRect) => number) {
  const [i, setI] = useState<number | null>(null)
  const [esce, setEsce] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const muovi = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse' && e.type === 'pointermove' && !e.buttons) return
    if (n < 1) return
    const r = e.currentTarget.getBoundingClientRect()
    const j = Math.max(0, Math.min(n - 1, posizione(e, r)))
    if (timer.current) clearTimeout(timer.current)
    setEsce(false)
    setI(j)
  }
  const nascondi = () => {
    if (i === null) return
    setEsce(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { setI(null); setEsce(false) }, 170)
  }
  const handlers = {
    onPointerMove: muovi,
    onPointerDown: muovi,
    onPointerLeave: nascondi,
    onPointerCancel: nascondi,
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => { if (e.pointerType !== 'mouse') nascondi() },
  }
  return { i, esce, handlers }
}

/**
 * Tiene il fumetto dello scrub dentro lo schermo: parte centrato sul
 * punto e si sposta di quanto sborderebbe (8 px di margine). Scrive solo
 * lo stile del nodo, dopo il disegno: nessuno stato in più.
 */
export function dentroSchermo(el: HTMLElement | null) {
  if (!el) return
  el.style.translate = '-50% 0'
  const r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth
  const dx = r.left < 8 ? 8 - r.left : r.right > vw - 8 ? vw - 8 - r.right : 0
  if (dx) el.style.translate = `calc(-50% + ${dx}px) 0`
}

export function BadgeVariazione({ v }: { v: { testo: string; su: boolean; tono: Tono } }) {
  return (
    <span className={cn('flex items-center gap-[3px] rounded-full px-[7px] py-0.5 font-mono text-[11px] font-semibold', TONO_PILLOLA[v.tono])}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${v.su ? 0 : 180}deg)` }} aria-hidden>
        <path d="M12 19V5" /><path d="M6 11l6-6 6 6" />
      </svg>
      {v.testo}
    </span>
  )
}

export function PillolaB({ className }: { className?: string }) {
  return <span className={cn('rounded-full border border-dashed border-muted-foreground/60 px-[5px] py-px text-[9px] font-semibold tracking-[.06em]', className)}>B</span>
}

export interface KpiProps {
  l: string
  v: string
  tonoValore?: Tono
  varz: { testo: string; su: boolean; tono: Tono } | null
  vs: string
  b?: string
  serie: number[]
  serieB?: number[]
  colore: string
  etichette: string[]
  fmt: (v: number) => string
  onApri: () => void
  ritardo: number
}

/** Card KPI: valore, variazione, sparkline con scrub e fumetto del giorno. */
export function KpiCard(p: KpiProps) {
  const n = p.serie.length
  const { i, esce, handlers } = useScrub(n, (e, r) => Math.round(((e.clientX - r.left) / r.width) * (n - 1)))
  const b2 = (p.serieB ?? []).slice(0, n)
  const tutti = [...p.serie, ...b2]
  const mx = Math.max(...tutti, 1), mn = Math.min(...tutti, 0)
  const py = (v: number) => 28 - ((v - mn) / (mx - mn || 1)) * 24
  const pts: [number, number][] = p.serie.map((v, j) => [n > 1 ? (j / (n - 1)) * 180 : 90, py(v)])
  const ptsB: [number, number][] = b2.map((v, j) => [n > 1 ? (j / (n - 1)) * 180 : 90, py(v)])
  const fx = i !== null && n > 1 ? i / (n - 1) : 0
  const attivo = i !== null && n > 1

  return (
    <div
      role="button" tabIndex={0} onClick={p.onApri} onKeyDown={e => { if (e.key === 'Enter') p.onApri() }}
      className={cn('anim-swapin relative flex min-w-0 cursor-pointer select-none flex-col gap-1.5 rounded-[12px] border border-border bg-card px-4 pb-2.5 pt-3.5 [-webkit-touch-callout:none] [-webkit-user-select:none] active:scale-[0.98]', attivo && 'z-20')}
      style={{ animationDelay: `${p.ritardo}ms` }}
    >
      <span className="truncate text-[13px] font-medium text-muted-foreground">{p.l}</span>
      <span className={cn('whitespace-nowrap font-mono text-[22px] font-semibold tracking-[-.02em]', p.tonoValore === 'neg' && 'text-neg', p.tonoValore === 'ok' && 'text-ok')}>{p.v}</span>
      <div className="flex min-h-[18px] items-center gap-1.5">
        {p.varz && <BadgeVariazione v={p.varz} />}
        <span className="truncate text-[11px] text-muted-foreground">{p.varz ? p.vs : ''}</span>
      </div>
      {p.b !== undefined && (
        <div className="flex items-center gap-1.5 font-mono text-xs font-medium text-muted-foreground"><PillolaB />{p.b}</div>
      )}
      <div {...handlers} className="relative h-[30px] cursor-crosshair touch-none">
        <svg width="100%" height="30" viewBox="0 0 180 30" preserveAspectRatio="none" className="block" aria-hidden>
          {n > 1 && <path d={`M0,30 L${curva(pts)} L180,30 Z`} fill={`color-mix(in oklch, ${p.colore} 14%, transparent)`} />}
          {ptsB.length > 1 && <path d={`M${curva(ptsB)}`} fill="none" stroke="var(--muted-foreground)" strokeWidth={1.2} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity={0.7} />}
          {n > 1 && <path d={`M${curva(pts)}`} fill="none" stroke={p.colore} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />}
        </svg>
        {attivo && (
          <>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-[oklch(0.82_0.01_250)] dark:bg-line-strong" style={{ left: `${fx * 100}%` }} />
            <div className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-card" style={{ left: `${fx * 100}%`, top: `${(pts[i!][1] / 30) * 100}%`, borderColor: p.colore }} />
            <div
              ref={el => dentroSchermo(el)}
              className={cn('pointer-events-none absolute bottom-[calc(100%+6px)] z-30 flex flex-col gap-0.5 whitespace-nowrap rounded-[8px] bg-[oklch(0.2_0.01_250)] px-2.5 py-1.5 text-white shadow-[0_6px_20px_oklch(0.2_0.01_250/.18)] dark:bg-[oklch(0.32_0.01_250)]', esce ? 'anim-swapout' : 'anim-swapin')}
              style={{ left: `${fx * 100}%`, animationDuration: esce ? '170ms' : '360ms' }}
            >
              <span className="text-[11px] font-medium text-[oklch(0.8_0.01_250)]">{p.etichette[i!]}</span>
              <span className="font-mono text-[13px] font-semibold">{p.fmt(p.serie[i!])}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Andamento entrate ────────────────────────────────────────────────

export interface LocaleG { id: string; nome: string; colore: string; tenue: string }

const X0 = 44
const H = 260

/** Scala "tonda" a quattro tacche come nel prototipo. */
export function scala(max: number) {
  const mx0 = max * 1.08 || 1
  const step = Math.pow(10, Math.floor(Math.log10(mx0 / 4)))
  const nice = Math.ceil(mx0 / 4 / step) * step
  return { nice, mx: nice * 4 }
}
const etichettaAsse = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)}k` : String(v))
const yp = (v: number, mx: number) => 270 - (v / mx) * H

/** Griglia orizzontale con le etichette dell'asse a sinistra (34 px + 10). */
export function Griglia({ nice, mx }: { nice: number; mx: number }) {
  return (
    <div className="pointer-events-none absolute left-0 right-0 top-0 h-[280px]">
      {[4, 3, 2, 1, 0].map(g => (
        <div key={g} className="absolute left-0 right-0 flex items-center gap-2.5" style={{ top: yp(g * nice, mx) - 0.5 }}>
          <span className="w-[34px] text-right font-mono text-[11px] font-medium text-[oklch(0.6_0.01_250)]">{g ? etichettaAsse(nice * g) : '0'}</span>
          <span className={cn('h-px flex-1', g ? 'bg-[oklch(0.94_0.008_250)] dark:bg-border/60' : 'bg-[oklch(0.86_0.01_250)] dark:bg-line-strong')} />
        </div>
      ))}
    </div>
  )
}

export const larghezzaBarra = (N: number, tel: boolean) => tel
  ? (N <= 8 ? 26 : N <= 12 ? 16 : N <= 20 ? 9 : 6)
  : (N <= 8 ? 44 : N <= 12 ? 40 : N <= 20 ? 22 : 16)
export const spazioColonne = (N: number, tel: boolean) => (tel ? (N > 20 ? 2 : 4) : N > 20 ? 3 : 8)
export const ogniEtichetta = (N: number, tel: boolean) => (tel ? (N > 20 ? 6 : N > 12 ? 2 : 1) : N > 20 ? 3 : 1)

export interface GraficoProps {
  asse: string[]
  etichette: string[]
  /** Locali selezionati, nell'ordine dei filtri. */
  locali: LocaleG[]
  /** ser[j][k]: entrate del bucket j per il locale k (stesso ordine di locali). */
  ser: number[][]
  /** Entrate del periodo B per posizione (riquadro tratteggiato), o null. */
  serB: number[] | null
  etichetteB: string[]
  /** Bucket con almeno una chiusura (solo quelli si aprono al tocco). */
  conDati: boolean[]
  onApri: (j: number) => void
  tel: boolean
}

/** Barre impilate per locale; scrub col dito o col mouse, tocco apre il giorno. */
export function GraficoEntrate({ asse, etichette, locali, ser, serB, etichetteB, conDati, onApri, tel }: GraficoProps) {
  const N = asse.length
  const tot = ser.map(v => v.reduce((a, b) => a + b, 0))
  const { nice, mx } = scala(Math.max(...tot, ...(serB ?? [0])))
  const { i: hi, esce, handlers } = useScrub(N, (e, r) => Math.floor(((e.clientX - r.left - X0) / (r.width - X0)) * N))
  const ogni = ogniEtichetta(N, tel)
  const bw = larghezzaBarra(N, tel), gap = spazioColonne(N, tel)
  const fx = hi !== null ? (hi + 0.5) / N : 0
  const sinistra = tel ? (fx > 0.5 ? `${X0}px` : 'calc(100% - 240px)') : `calc(${X0}px + (100% - ${X0}px) * ${fx.toFixed(4)} ${fx > 0.62 ? '- 252px' : '+ 28px'})`

  return (
    <div
      {...handlers}
      onClick={e => {
        const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left - X0
        if (x < 0) return
        const j = Math.max(0, Math.min(N - 1, Math.floor((x / (r.width - X0)) * N)))
        if (conDati[j]) onApri(j)
      }}
      className="relative h-[310px] cursor-pointer touch-none select-none"
    >
      <Griglia nice={nice} mx={mx} />
      <div className="absolute right-0 top-0 flex h-[280px] items-end" style={{ left: X0, gap }}>
        {ser.map((v, j) => {
          const segs = locali.map((l, k) => ({ l, v: v[k] })).filter(x => x.v > 0).reverse()
          return (
            <div key={j} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end transition-opacity duration-[180ms] ease-out" style={{ opacity: hi === null || hi === j ? 1 : 0.38 }}>
              {serB && serB[j] > 0 && (
                <div className="absolute bottom-0 left-1/2 box-border -translate-x-1/2 rounded-[8px_8px_3px_3px] border-[1.5px] border-dashed border-[oklch(0.7_0.01_250)]" style={{ width: bw + 8, height: (serB[j] / mx) * H + 4 }} />
              )}
              <div className="relative flex flex-col gap-0.5 overflow-hidden rounded-[8px_8px_4px_4px] transition-[height] duration-500" style={{ width: bw }}>
                {segs.map(x => (
                  <div key={x.l.id} className="flex-none" style={{ height: Math.max(2, (x.v / mx) * H - 2), background: hi === j ? x.l.colore : x.l.tenue }} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className="absolute right-0 top-[288px] flex" style={{ left: X0, gap }}>
        {asse.map((l, j) => (
          <span key={j} className={cn('min-w-0 flex-1 whitespace-nowrap text-center font-mono text-[11px]', hi === j ? 'font-bold text-foreground' : 'font-medium text-[oklch(0.58_0.01_250)]')}>
            {j % ogni === 0 || j === N - 1 ? l : ''}
          </span>
        ))}
      </div>
      {hi !== null && (
        <div
          className="pointer-events-none absolute top-2 z-[5] flex w-[220px] flex-col gap-1.5 rounded-[10px] bg-[oklch(0.2_0.01_250)] px-3.5 py-3 text-white shadow-[0_8px_24px_rgba(20,30,50,.2)] transition-[opacity,left] duration-[160ms,120ms] dark:bg-[oklch(0.32_0.01_250)]"
          style={{ left: sinistra, opacity: esce ? 0 : 1 }}
        >
          <span className="text-[13px] font-semibold">{etichette[hi]}</span>
          {locali.map((l, k) => (
            <div key={l.id} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: l.colore }} />
              <span className="flex-1 truncate opacity-80">{l.nome}</span>
              <span className="font-mono font-medium">€ {Math.round(ser[hi][k]).toLocaleString('it-IT')}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-white/[.18] pt-1.5 text-xs font-semibold">
            <span>Totale</span>
            <span className="font-mono">€ {Math.round(tot[hi]).toLocaleString('it-IT')}</span>
          </div>
          {serB && (
            <div className="flex justify-between text-[11px] opacity-75"><span>B · {etichetteB[hi] ?? '—'}</span><span className="font-mono">€ {Math.round(serB[hi] ?? 0).toLocaleString('it-IT')}</span></div>
          )}
        </div>
      )}
    </div>
  )
}

/** Entrate cumulate A e B (vista di confronto): chi è avanti giorno dopo giorno. */
export function Cumulata({ a, b, etichetta, fmt }: { a: number[]; b: number[]; etichetta: (j: number) => string; fmt: (v: number) => string }) {
  const N = a.length
  const cA: number[] = [], cB: number[] = []
  a.reduce((s, v) => { cA.push(s + v); return s + v }, 0)
  b.reduce((s, v) => { cB.push(s + v); return s + v }, 0)
  const sa = cA[N - 1] ?? 0, sb = cB[cB.length - 1] ?? 0
  const cmx = Math.max(sa, sb) * 1.06 || 1
  const X = (j: number) => (N > 1 ? (j / (N - 1)) * 300 : 150), Y = (v: number) => 210 - (v / cmx) * 200
  const pA: [number, number][] = cA.map((v, j) => [X(j), Y(v)]), pB: [number, number][] = cB.map((v, j) => [X(j), Y(v)])
  const { i, handlers } = useScrub(N, (e, r) => Math.round(((e.clientX - r.left) / r.width) * (N - 1)))
  const fx = i !== null && N > 1 ? i / (N - 1) : 0.5
  return (
    <div {...handlers} className="relative h-[220px] touch-none">
      <svg width="100%" height="220" viewBox="0 0 300 220" preserveAspectRatio="none" className="block" aria-hidden>
        {pA.length > 1 && <path d={`M0,210 L${curva(pA)} L${X(N - 1)},210 Z`} fill="oklch(0.58 0.12 180 / .1)" />}
        {pB.length > 1 && <path d={`M${curva(pB)}`} fill="none" stroke="var(--muted-foreground)" strokeWidth={1.6} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
        {pA.length > 1 && <path d={`M${curva(pA)}`} fill="none" stroke="oklch(0.58 0.12 180)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      </svg>
      {i !== null && (
        <>
          <div className="pointer-events-none absolute inset-y-0 w-px bg-line-strong" style={{ left: `${fx * 100}%` }} />
          <div className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[oklch(0.58_0.12_180)] bg-card" style={{ left: `${fx * 100}%`, top: Y(cA[i]) }} />
          {cB[i] != null && <div className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-muted-foreground bg-card" style={{ left: `${fx * 100}%`, top: Y(cB[i]) }} />}
          <div className="pointer-events-none absolute top-2 z-10 flex w-[176px] flex-col gap-1 rounded-[10px] bg-foreground px-3 py-2.5 text-background shadow-float"
            style={{ left: fx > 0.5 ? `calc(${(fx * 100).toFixed(3)}% - 188px)` : `calc(${(fx * 100).toFixed(3)}% + 12px)` }}>
            <span className="text-xs font-semibold">{etichetta(i)}</span>
            <div className="flex justify-between text-xs"><span className="opacity-80">A</span><span className="font-mono">{fmt(cA[i])}</span></div>
            <div className="flex justify-between text-xs"><span className="opacity-80">B</span><span className="font-mono">{cB[i] != null ? fmt(cB[i]) : '—'}</span></div>
          </div>
        </>
      )}
    </div>
  )
}

/** Due barre orizzontali A (piena) e B (tratteggiata), per le righe di confronto. */
export function BarreAB({ wa, wb, colore = 'oklch(0.58 0.12 180)' }: { wa: number; wb: number; colore?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="h-1.5 rounded-full bg-secondary"><div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${wa}%`, background: colore }} /></div>
      <div className="h-1.5 rounded-full bg-secondary"><div className="h-full rounded-full border border-dashed border-muted-foreground/60 bg-muted-foreground/25 transition-[width] duration-500" style={{ width: `${wb}%` }} /></div>
    </div>
  )
}
