'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { MESI, capit, fd, giorni, intervallo, t, s } from '@/lib/analisi'

// Filtri del design Manager Analisi: periodo a segmenti (Oggi, Settimana,
// Mese, Anno, Date con calendario, Altri mesi), Confronta ed Esporta.
// I pannelli si aprono con swapin (680 ms) e si chiudono con swapout
// (320 ms); un tocco fuori da [data-pop] li chiude.

export interface Intervallo { a: string; b: string }
export type Periodo = { k: 'oggi' | 'sett' | 'mese' | 'anno' } | { k: 'mesi'; mese: string } | { k: 'custom'; r: Intervallo }
export type ModoConfronto = null | 'prev' | 'yoy' | 'custom' | 'locali'
/** Confronto tra locali: id del locale A e del locale B. */
export interface CoppiaLocali { a: string; b: string }

const USCITA = 320
const SPUNTA = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="oklch(0.45 0.1 180)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>

/** Apertura/chiusura animata di un pannello e chiusura al tocco fuori. */
function usePannello(selettore: string) {
  const [aperto, setAperto] = useState(false)
  const [esce, setEsce] = useState(false)
  const tm = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chiudi = useCallback(() => {
    setEsce(true)
    if (tm.current) clearTimeout(tm.current)
    tm.current = setTimeout(() => { setAperto(false); setEsce(false) }, USCITA)
  }, [])
  const apri = useCallback(() => { if (tm.current) clearTimeout(tm.current); setEsce(false); setAperto(true) }, [])
  useEffect(() => {
    if (!aperto || esce) return
    const h = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest(selettore)) chiudi() }
    const id = setTimeout(() => window.addEventListener('pointerdown', h, true), 0)
    return () => { clearTimeout(id); window.removeEventListener('pointerdown', h, true) }
  }, [aperto, esce, selettore, chiudi])
  return { aperto, esce, apri, chiudi, alterna: () => (aperto && !esce ? chiudi() : apri()) }
}

/** Calendario a intervallo del design: primo tocco inizio, secondo fine. */
export function Calendario({ iniziale, ultimo, riepilogoVuoto, onApplica, bordo }: { iniziale: Intervallo | null; ultimo: string; riepilogoVuoto: string; onApplica: (r: Intervallo) => void; bordo?: boolean }) {
  const base = new Date(t(iniziale?.a ?? ultimo))
  const [y, setY] = useState(base.getUTCFullYear())
  const [m, setM] = useState(base.getUTCMonth())
  const [a, setA] = useState<string | null>(iniziale?.a ?? null)
  const [b, setB] = useState<string | null>(iniziale?.b ?? null)
  const first = Date.UTC(y, m, 1), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), lead = (new Date(first).getUTCDay() + 6) % 7
  const puoAvanti = Date.UTC(y, m + 1, 1) <= t(ultimo)
  const fine = b ?? a
  const celle: ({ d: string; n: number } | null)[] = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, q) => ({ d: s(Date.UTC(y, m, q + 1)), n: q + 1 }))]
  while (celle.length % 7) celle.push(null)
  const freccia = 'flex h-11 w-11 cursor-pointer items-center justify-center rounded-full active:scale-[0.97]'

  return (
    <div className={cn('flex flex-col gap-1.5', bordo && 'border-t border-[oklch(0.93_0.01_250)] pt-2.5 dark:border-border')}>
      <div className="flex items-center">
        <button type="button" aria-label="Mese precedente" onClick={() => { if (m) setM(m - 1); else { setM(11); setY(y - 1) } }} className={freccia}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <span className="flex-1 text-center text-[15px] font-semibold">{capit(MESI[m])} {y}</span>
        <button type="button" aria-label="Mese successivo" onClick={() => { if (!puoAvanti) return; if (m === 11) { setM(0); setY(y + 1) } else setM(m + 1) }} className={freccia} style={{ opacity: puoAvanti ? 1 : 0.3 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>
      <div className="grid grid-cols-7">{['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((g, i) => <span key={i} className="pb-1 pt-0.5 text-center text-[11px] font-medium text-muted-foreground">{g}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {celle.map((c, i) => {
          if (!c) return <div key={i} className="h-10" />
          if (c.d > ultimo) return <div key={i} className="flex h-10 items-center justify-center font-mono text-[13px] font-medium text-[oklch(0.78_0.01_250)] dark:text-muted-foreground/40">{c.n}</div>
          const st = c.d === a, en = c.d === fine, dentro = !!a && !!b && c.d > a && c.d < b, bordoC = st || (!!b && c.d === b)
          const entrambi = st && (!b || b === a)
          const raggio = entrambi ? '10px' : st ? '10px 0 0 10px' : bordoC && en ? '0 10px 10px 0' : dentro ? '0' : '10px'
          return (
            <button key={i} type="button"
              onClick={() => { if (!a || b) { setA(c.d); setB(null) } else if (c.d < a) { setB(a); setA(c.d) } else setB(c.d) }}
              className={cn('flex h-10 cursor-pointer items-center justify-center font-mono text-[13px] font-medium transition-[background] duration-150',
                bordoC ? 'bg-primary text-primary-foreground' : dentro ? 'bg-[oklch(0.93_0.04_180)] dark:bg-[oklch(0.3_0.04_180)]' : 'bg-transparent')}
              style={{ borderRadius: raggio }}>
              {c.n}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-[oklch(0.93_0.01_250)] pt-1.5 dark:border-border">
        <span className="flex-1 text-xs font-medium text-[oklch(0.35_0.01_250)] dark:text-foreground/80">
          {a ? `${intervallo(a, fine!)} · ${giorni(a, fine!)} ${giorni(a, fine!) === 1 ? 'giorno' : 'giorni'}` : riepilogoVuoto}
        </span>
        <button type="button" onClick={() => a && onApplica({ a, b: fine! })} className="flex h-11 cursor-pointer items-center rounded-[10px] bg-primary px-[18px] text-sm font-medium text-primary-foreground transition-opacity duration-200 active:scale-[0.97]" style={{ opacity: a ? 1 : 0.35 }}>Applica</button>
      </div>
    </div>
  )
}

const pannello = 'absolute z-[46] rounded-[14px] border border-border bg-card p-3 shadow-[0_14px_40px_rgba(20,30,50,.16)]'

export function BarraPeriodo({ periodo, onPeriodo, mesi, oggi, tel }: {
  periodo: Periodo; onPeriodo: (p: Periodo) => void; mesi: { k: string; l: string }[]; oggi: string; tel: boolean
}) {
  const mm = usePannello('[data-mm]')
  const cal = usePannello('[data-pop]')
  const voce = (on: boolean) => cn(
    'flex h-10 cursor-pointer items-center justify-center whitespace-nowrap rounded-[7px] text-[13px] font-medium transition-[background] duration-200',
    tel ? 'flex-auto px-2' : 'flex-none px-3',
    on ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'bg-transparent text-muted-foreground'
  )
  const meseSel = periodo.k === 'mesi' ? mesi.find(x => x.k === periodo.mese) : undefined
  const etichettaDate = !tel && periodo.k === 'custom' ? (periodo.r.a === periodo.r.b ? fd(periodo.r.a) : `${fd(periodo.r.a)} – ${fd(periodo.r.b)}`) : 'Date'

  return (
    <div className={cn('relative flex gap-0.5 rounded-[9px] bg-[oklch(0.93_0.01_250)] p-[3px] dark:bg-secondary', 'flex-none')}>
      {([['oggi', 'Oggi'], ['sett', tel ? 'Sett.' : 'Settimana'], ['mese', 'Mese'], ['anno', 'Anno']] as const).map(([k, l]) => (
        <button key={k} type="button" onClick={() => onPeriodo({ k })} className={voce(periodo.k === k)}>{l}</button>
      ))}
      <div data-pop className="contents">
        <button type="button" onClick={() => { mm.chiudi(); cal.alterna() }} className={cn(voce(periodo.k === 'custom'), 'gap-[7px]')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17" /><path d="M8 3v4" /><path d="M16 3v4" /></svg>
          {etichettaDate}
        </button>
        {cal.aperto && (
          <div className={cn(pannello, 'top-[calc(100%+8px)] flex flex-col gap-2.5', tel ? 'left-0 right-0' : 'right-0 w-[348px]', cal.esce ? 'anim-swapout' : 'anim-swapin')}>
            <Calendario iniziale={periodo.k === 'custom' ? periodo.r : null} ultimo={oggi} riepilogoVuoto="Scegli inizio e fine"
              onApplica={r => { onPeriodo({ k: 'custom', r }); cal.chiudi() }} />
          </div>
        )}
      </div>
      <div data-mm className={cn('relative', tel ? 'flex flex-auto' : 'flex flex-none')}>
        <button type="button" onClick={() => { cal.chiudi(); mm.alterna() }} className={cn(voce(!!meseSel), 'w-full gap-1.5', tel ? 'pl-2 pr-2.5' : 'pl-3 pr-2.5')}>
          {meseSel ? (tel ? meseSel.l.slice(0, 3) : meseSel.l) : tel ? 'Mesi' : 'Altri mesi'}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {mm.aperto && (
          <div className={cn('absolute right-0 top-[calc(100%+8px)] z-40 flex w-[180px] flex-col gap-0.5 rounded-[10px] border border-border bg-card p-1.5 shadow-[0_10px_30px_rgba(20,30,50,.12)]', mm.esce ? 'anim-swapout' : 'anim-swapin')}>
            {mesi.map(x => (
              <button key={x.k} type="button" onClick={() => { onPeriodo({ k: 'mesi', mese: x.k }); mm.chiudi() }}
                className={cn('flex h-11 cursor-pointer items-center justify-between rounded-[7px] px-3 text-left text-sm font-medium text-foreground active:scale-[0.98]', meseSel?.k === x.k ? 'bg-[oklch(0.96_0.02_180)] dark:bg-[oklch(0.28_0.03_180)]' : 'bg-transparent')}>
                {x.l}{meseSel?.k === x.k && SPUNTA}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function MenuConfronto({ modo, onModo, custom, onCustom, opzioni, apriRef, oggi, tel, locali, coppia, onCoppia }: {
  modo: ModoConfronto
  onModo: (m: ModoConfronto) => void
  custom: Intervallo | null
  onCustom: (r: Intervallo) => void
  locali: { id: string; nome: string; colore: string }[]
  coppia: CoppiaLocali | null
  onCoppia: (c: CoppiaLocali) => void
  opzioni: { prev: string; yoy: string; customDefault: Intervallo }
  apriRef?: React.MutableRefObject<(() => void) | null>
  oggi: string
  tel: boolean
}) {
  const p = usePannello('[data-pop]')
  const [cal, setCal] = useState(false)
  const [scegliLoc, setScegliLoc] = useState(false)
  useEffect(() => { if (apriRef) apriRef.current = () => setTimeout(() => { setCal(modo === 'custom'); setScegliLoc(modo === 'locali'); p.apri() }, 0) })
  const nome = (id?: string) => locali.find(l => l.id === id)?.nome ?? ''
  const voci: [ModoConfronto, string, string][] = [
    [null, 'Nessun confronto', ''],
    ['prev', 'Periodo precedente', opzioni.prev],
    ['yoy', 'Stesso periodo anno prima', opzioni.yoy],
    ['custom', 'Personalizzato', custom ? intervallo(custom.a, custom.b) : 'scegli le date'],
    ...(locali.length > 1 ? [['locali', 'Tra locali', coppia ? `${nome(coppia.a)} contro ${nome(coppia.b)}, stesso periodo` : 'due locali nello stesso periodo'] as [ModoConfronto, string, string]] : []),
  ]
  const attivo = !!modo
  return (
    // Sul telefono il pulsante occupa metà riga: il pannello si ancora alla
    // riga intera (il contenitore "relative" in AnalisiClient), non al
    // pulsante, altrimenti largo quanto lo schermo uscirebbe a sinistra.
    <div data-pop className={tel ? 'flex flex-[1_1_0]' : 'relative flex-none'}>
      <button type="button" onClick={() => { setCal(modo === 'custom'); setScegliLoc(modo === 'locali'); p.alterna() }}
        className={cn('flex h-10 w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[8px] border px-3 text-[13px] font-medium transition-[background,color] duration-200 active:scale-[0.97]',
          attivo ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.82_0.01_250)] bg-card text-foreground dark:border-line-strong')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 4v16" /><path d="M3 8l4-4 4 4" /><path d="M17 20V4" /><path d="M13 16l4 4 4-4" /></svg>
        {attivo ? 'Confronto attivo' : 'Confronta'}
      </button>
      {p.aperto && (
        <div className={cn(pannello, 'top-[calc(100%+8px)] flex flex-col gap-2.5', tel ? 'inset-x-0' : 'right-0 w-[348px]', p.esce ? 'anim-swapout' : 'anim-swapin')}>
          <div className="flex flex-col gap-0.5">
            {voci.map(([k, l, sub]) => (
              <button key={l} type="button"
                onClick={() => { if (k === 'custom') { setScegliLoc(false); setCal(true); return } if (k === 'locali') { setCal(false); setScegliLoc(true); return } onModo(k); p.chiudi() }}
                className={cn('flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[8px] px-3 py-1 text-left active:scale-[0.98]', modo === k ? 'bg-[oklch(0.96_0.02_180)] dark:bg-[oklch(0.28_0.03_180)]' : 'bg-transparent')}>
                <span className="flex flex-1 flex-col gap-px">
                  <span className="text-sm font-medium">{l}</span>
                  {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
                </span>
                {modo === k && !(k === 'custom' && cal) && !(k === 'locali' && scegliLoc) && SPUNTA}
              </button>
            ))}
          </div>
          {scegliLoc && (
            <SceltaCoppia locali={locali} iniziale={coppia} onApplica={c => { onCoppia(c); p.chiudi() }} />
          )}
          {cal && (
            <Calendario bordo iniziale={custom ?? opzioni.customDefault} ultimo={oggi} riepilogoVuoto="Scegli il periodo B"
              onApplica={r => { onCustom(r); onModo('custom'); p.chiudi() }} />
          )}
        </div>
      )}
    </div>
  )
}

/** Scelta dei due locali da confrontare: A in alto, B sotto, mai lo stesso. */
function SceltaCoppia({ locali, iniziale, onApplica }: { locali: { id: string; nome: string; colore: string }[]; iniziale: CoppiaLocali | null; onApplica: (c: CoppiaLocali) => void }) {
  const [a, setA] = useState<string | null>(iniziale?.a ?? locali[0]?.id ?? null)
  const [b, setB] = useState<string | null>(iniziale?.b ?? locali[1]?.id ?? null)
  const riga = (l: 'A' | 'B', val: string | null, set: (id: string) => void, altro: string | null) => (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className={cn('inline-flex h-4 w-4 items-center justify-center rounded-[4px] text-[9px] font-semibold', l === 'A' ? 'bg-[oklch(0.58_0.12_180)] text-white' : 'bg-[oklch(0.76_0.012_250)] text-[oklch(0.25_0.01_250)]')}>{l}</span>
        Locale {l}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {locali.map(x => {
          const on = val === x.id, off = altro === x.id
          return (
            <button key={x.id} type="button" disabled={off} onClick={() => set(x.id)}
              className={cn('flex h-10 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-[background] duration-200 active:scale-[0.97] disabled:opacity-35',
                on ? 'border-foreground bg-foreground text-background' : 'border-[oklch(0.86_0.01_250)] bg-card dark:border-line-strong')}>
              <span className="h-2 w-2 rounded-full" style={{ background: x.colore }} />{x.nome}
            </button>
          )
        })}
      </div>
    </div>
  )
  return (
    <div className="flex flex-col gap-3 border-t border-[oklch(0.93_0.01_250)] pt-2.5 dark:border-border">
      {riga('A', a, setA, b)}
      {riga('B', b, setB, a)}
      <div className="flex items-center gap-2 border-t border-[oklch(0.93_0.01_250)] pt-1.5 dark:border-border">
        <span className="flex-1 text-xs font-medium text-[oklch(0.35_0.01_250)] dark:text-foreground/80">Stesso periodo per entrambi</span>
        <button type="button" onClick={() => a && b && a !== b && onApplica({ a, b })} className="flex h-11 cursor-pointer items-center rounded-[10px] bg-primary px-[18px] text-sm font-medium text-primary-foreground transition-opacity duration-200 active:scale-[0.97]" style={{ opacity: a && b && a !== b ? 1 : 0.35 }}>Applica</button>
      </div>
    </div>
  )
}

export function PulsanteEsporta({ disabilitato, onScegli, tel }: { disabilitato: boolean; onScegli: (f: 'xlsx' | 'pdf') => void; tel: boolean }) {
  const p = usePannello('[data-esporta]')
  return (
    <div data-esporta className={cn('relative', tel ? 'flex flex-[1_1_0]' : 'flex-none')}>
      <button type="button" disabled={disabilitato} onClick={p.alterna}
        className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[8px] border border-[oklch(0.82_0.01_250)] bg-card px-3.5 text-[13px] font-medium active:scale-[0.97] disabled:cursor-default disabled:opacity-45 dark:border-line-strong">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></svg>
        Esporta
      </button>
      {p.aperto && (
        <div className={cn('absolute right-0 top-[calc(100%+8px)] z-40 flex w-[180px] flex-col gap-0.5 rounded-[10px] border border-border bg-card p-1.5 shadow-[0_10px_30px_rgba(20,30,50,.12)]', p.esce ? 'anim-swapout' : 'anim-swapin')}>
          {(['xlsx', 'pdf'] as const).map(f => (
            <button key={f} type="button" onClick={() => { onScegli(f); p.chiudi() }} className="flex h-11 cursor-pointer items-center rounded-[7px] px-3 text-left text-sm font-medium active:scale-[0.98]">
              {f === 'xlsx' ? 'Excel' : 'PDF'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
