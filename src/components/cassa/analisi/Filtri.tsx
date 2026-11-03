'use client'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { MESI, capit, giorni, intervallo, t, s } from '@/lib/analisi'

// Filtri del design Manager Analisi: pillole dei locali (riordinabili con
// una pressione lunga), periodo a segmenti con "Date" (calendario) e
// "Altri mesi", poi Confronta ed Esporta con i loro pannelli.

export interface LocaleF { id: string; nome: string; colore: string }

const CHIAVE_ORDINE = 'inturno.locOrderL'

export function leggiOrdine(): string[] {
  try { return JSON.parse(localStorage.getItem(CHIAVE_ORDINE) || '[]') } catch { return [] }
}

export function PilloleLocali({ locali, sel, onSel, ordine, onOrdine }: {
  locali: LocaleF[]; sel: string[]; onSel: (s: string[]) => void; ordine: string[]; onOrdine: (o: string[]) => void
}) {
  const [trascina, setTrascina] = useState<string | null>(null)
  const trascinato = useRef(false)
  const rk = (id: string) => { const i = ordine.indexOf(id); return i < 0 ? 999 : i }
  const lista = [...locali].map((l, i) => ({ l, i })).sort((a, b) => rk(a.l.id) - rk(b.l.id) || a.i - b.i).map(x => x.l)
  const corrente = useRef<string[]>([])
  const idLista = lista.map(l => l.id).join(',')
  useEffect(() => { corrente.current = idLista.split(',') }, [idLista])

  function premi(e: React.PointerEvent, id: string) {
    const x0 = e.clientX, y0 = e.clientY
    let attivo = false
    const tm = setTimeout(() => { attivo = true; trascinato.current = true; navigator.vibrate?.(10); setTrascina(id) }, 420)
    const blocca = (ev: TouchEvent) => { if (attivo) ev.preventDefault() }
    const muovi = (ev: PointerEvent) => {
      if (!attivo) { if (Math.abs(ev.clientX - x0) > 8 || Math.abs(ev.clientY - y0) > 8) fine(); return }
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-li]')
      if (!el?.dataset.li || el.dataset.li === id) return
      const o = corrente.current.slice(), a = o.indexOf(id), b = o.indexOf(el.dataset.li)
      if (a < 0 || b < 0) return
      o.splice(a, 1); o.splice(b, 0, id)
      onOrdine(o)
    }
    const fine = () => {
      clearTimeout(tm)
      window.removeEventListener('pointermove', muovi); window.removeEventListener('pointerup', fine)
      window.removeEventListener('pointercancel', fine); window.removeEventListener('touchmove', blocca)
      if (attivo) {
        try { localStorage.setItem(CHIAVE_ORDINE, JSON.stringify(corrente.current)) } catch { /* memoria non disponibile */ }
        setTrascina(null)
        setTimeout(() => { trascinato.current = false }, 50)
      }
    }
    window.addEventListener('pointermove', muovi); window.addEventListener('pointerup', fine)
    window.addEventListener('pointercancel', fine); window.addEventListener('touchmove', blocca, { passive: false })
  }

  const pill = 'flex h-10 flex-none select-none items-center gap-2 rounded-full border px-4 text-sm font-medium transition-[transform,box-shadow] active:scale-[0.97]'
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden" onContextMenu={e => e.preventDefault()}>
      <button type="button" onClick={() => onSel([])}
        className={cn(pill, sel.length === 0 ? 'border-primary bg-primary text-primary-foreground' : 'border-line-strong bg-card')}>
        Tutti i locali
      </button>
      {lista.map(l => {
        const on = sel.includes(l.id), drag = trascina === l.id
        return (
          <button key={l.id} type="button" data-li={l.id}
            onPointerDown={e => premi(e, l.id)}
            onClick={() => {
              if (trascinato.current) { trascinato.current = false; return }
              const n = on ? sel.filter(x => x !== l.id) : [...sel, l.id]
              onSel(n.length === locali.length ? [] : n)
            }}
            className={cn(pill, on ? 'border-primary bg-primary text-primary-foreground' : 'border-line-strong bg-card', drag && 'relative z-[2] scale-[1.08] shadow-float')}
            style={{ touchAction: drag ? 'none' : undefined }}>
            <span className="h-2 w-2 rounded-full" style={{ background: on ? 'currentColor' : l.colore }} />{l.nome}
          </button>
        )
      })}
    </div>
  )
}

/** Chiude il pannello al tocco fuori da [data-pop]. */
function useFuori(aperto: boolean, chiudi: () => void) {
  useEffect(() => {
    if (!aperto) return
    const h = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('[data-pop]')) chiudi() }
    const id = setTimeout(() => window.addEventListener('pointerdown', h, true), 0)
    return () => { clearTimeout(id); window.removeEventListener('pointerdown', h, true) }
  }, [aperto, chiudi])
}

export interface Intervallo { a: string; b: string }

/** Calendario a intervallo del design: primo tocco inizio, secondo fine. */
export function Calendario({ iniziale, ultimo, riepilogoVuoto, onApplica }: { iniziale: Intervallo | null; ultimo: string; riepilogoVuoto: string; onApplica: (r: Intervallo) => void }) {
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

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center">
        <button type="button" aria-label="Mese precedente" onClick={() => { if (m) setM(m - 1); else { setM(11); setY(y - 1) } }} className="flex h-11 w-11 items-center justify-center rounded-full active:scale-[0.97]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <span className="flex-1 text-center text-[15px] font-semibold">{capit(MESI[m])} {y}</span>
        <button type="button" aria-label="Mese successivo" disabled={!puoAvanti} onClick={() => { if (m === 11) { setM(0); setY(y + 1) } else setM(m + 1) }} className="flex h-11 w-11 items-center justify-center rounded-full active:scale-[0.97] disabled:opacity-30">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>
      <div className="grid grid-cols-7">{['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((g, i) => <span key={i} className="pb-1 pt-0.5 text-center text-[11px] font-medium text-muted-foreground">{g}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {celle.map((c, i) => {
          if (!c) return <div key={i} className="h-10" />
          const dis = c.d > ultimo
          if (dis) return <div key={i} className="flex h-10 items-center justify-center font-mono text-[13px] text-muted-foreground/50">{c.n}</div>
          const st = c.d === a, en = c.d === fine, dentro = a && b && c.d > a && c.d < b, bordo = st || (b && c.d === b)
          const entrambi = st && (!b || b === a)
          return (
            <button key={i} type="button"
              onClick={() => { if (!a || b) { setA(c.d); setB(null) } else if (c.d < a) { setB(a); setA(c.d) } else setB(c.d) }}
              className={cn('flex h-10 items-center justify-center font-mono text-[13px] font-medium transition-colors',
                bordo ? 'bg-primary text-primary-foreground' : dentro ? 'bg-[oklch(0.93_0.04_180)] dark:bg-[oklch(0.3_0.04_180)]' : '',
                entrambi ? 'rounded-[10px]' : st ? 'rounded-l-[10px]' : bordo && en ? 'rounded-r-[10px]' : dentro ? '' : 'rounded-[10px]')}>
              {c.n}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-border pt-1.5">
        <span className="flex-1 text-xs font-medium text-foreground/80">
          {a ? `${intervallo(a, fine!)} · ${giorni(a, fine!)} ${giorni(a, fine!) === 1 ? 'giorno' : 'giorni'}` : riepilogoVuoto}
        </span>
        <button type="button" disabled={!a} onClick={() => a && onApplica({ a, b: fine! })} className="h-11 rounded-[10px] bg-primary px-[18px] text-sm font-medium text-primary-foreground transition-opacity active:scale-[0.97] disabled:opacity-35">Applica</button>
      </div>
    </div>
  )
}

export type Periodo = { k: 'oggi' | 'sett' | 'mese' | 'anno' } | { k: 'mesi'; mese: string } | { k: 'custom'; r: Intervallo }
export type ModoConfronto = null | 'prev' | 'yoy' | 'custom'

export function BarraPeriodo({ periodo, onPeriodo, mesi, oggi, tel }: {
  periodo: Periodo; onPeriodo: (p: Periodo) => void; mesi: { k: string; l: string }[]; oggi: string; tel: boolean
}) {
  const [pop, setPop] = useState<null | 'mesi' | 'date'>(null)
  const chiudi = () => setPop(null)
  useFuori(!!pop, chiudi)
  const seg = (on: boolean) => cn('flex h-9 flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium', on ? 'bg-card shadow-sm' : 'text-muted-foreground')
  const meseSel = periodo.k === 'mesi' ? mesi.find(x => x.k === periodo.mese) : undefined
  return (
    <div className="relative" data-pop>
      <div className="flex items-center gap-0.5 overflow-x-auto rounded-[12px] bg-secondary p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {([['oggi', 'Oggi'], ['sett', tel ? 'Sett.' : 'Settimana'], ['mese', 'Mese'], ['anno', 'Anno']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => onPeriodo({ k })} className={cn(seg(periodo.k === k), 'flex-1 sm:flex-none')}>{l}</button>
        ))}
        <button type="button" onClick={() => setPop(pop === 'date' ? null : 'date')} className={cn(seg(periodo.k === 'custom'), 'flex-1 sm:flex-none')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>
          {!tel && periodo.k === 'custom' ? (periodo.r.a === periodo.r.b ? intervallo(periodo.r.a, periodo.r.a).replace(/ \d{4}$/, '') : `${intervallo(periodo.r.a, periodo.r.b).replace(/ \d{4}/g, '').replace(' → ', ' – ')}`) : 'Date'}
        </button>
        <button type="button" onClick={() => setPop(pop === 'mesi' ? null : 'mesi')} className={cn(seg(!!meseSel), 'flex-1 sm:flex-none')}>
          {meseSel ? (tel ? meseSel.l.slice(0, 3) : meseSel.l) : tel ? 'Mesi' : 'Altri mesi'}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>
      {pop === 'mesi' && (
        <div className="anim-swapin absolute right-0 top-[calc(100%+6px)] z-[46] flex w-48 flex-col gap-0.5 rounded-[14px] border border-border bg-card p-1.5 shadow-float">
          {mesi.map(x => (
            <button key={x.k} type="button" onClick={() => { onPeriodo({ k: 'mesi', mese: x.k }); chiudi() }}
              className={cn('flex h-11 items-center rounded-[8px] px-3 text-left text-sm font-medium', meseSel?.k === x.k ? 'bg-[oklch(0.96_0.02_180)] dark:bg-[oklch(0.28_0.03_180)]' : 'hover:bg-background')}>
              {x.l}
            </button>
          ))}
        </div>
      )}
      {pop === 'date' && (
        <div className="anim-swapin absolute right-0 top-[calc(100%+6px)] z-[46] w-[min(348px,calc(100vw-32px))] rounded-[14px] border border-border bg-card p-3 shadow-float">
          <Calendario iniziale={periodo.k === 'custom' ? periodo.r : null} ultimo={oggi} riepilogoVuoto="Scegli inizio e fine"
            onApplica={r => { onPeriodo({ k: 'custom', r }); chiudi() }} />
        </div>
      )}
    </div>
  )
}

export function MenuConfronto({ modo, onModo, custom, onCustom, opzioni, children, apriRef, oggi }: {
  oggi: string
  apriRef?: React.MutableRefObject<(() => void) | null>
  modo: ModoConfronto
  onModo: (m: ModoConfronto) => void
  custom: Intervallo | null
  onCustom: (r: Intervallo) => void
  opzioni: { prev: string; yoy: string }
  children: (apri: () => void, attivo: boolean) => React.ReactNode
}) {
  const [aperto, setAperto] = useState(false)
  const [cal, setCal] = useState(false)
  const chiudi = () => { setAperto(false); setCal(false) }
  useFuori(aperto, chiudi)
  useEffect(() => { if (apriRef) apriRef.current = () => setTimeout(() => setAperto(true), 0) }, [apriRef])
  const voci: [ModoConfronto, string, string][] = [
    [null, 'Nessun confronto', ''],
    ['prev', 'Periodo precedente', opzioni.prev],
    ['yoy', 'Stesso periodo anno prima', opzioni.yoy],
    ['custom', 'Personalizzato', custom ? intervallo(custom.a, custom.b) : 'scegli le date'],
  ]
  return (
    <div className="relative" data-pop>
      {children(() => (aperto ? chiudi() : setAperto(true)), !!modo)}
      {aperto && (
        <div className="anim-swapin absolute right-0 top-[calc(100%+6px)] z-[46] flex w-[min(348px,calc(100vw-32px))] flex-col gap-2.5 rounded-[14px] border border-border bg-card p-3 shadow-float">
          <div className="flex flex-col gap-0.5">
            {voci.map(([k, l, sub]) => (
              <button key={l} type="button"
                onClick={() => { if (k === 'custom') { setCal(true); return } onModo(k); chiudi() }}
                className={cn('flex min-h-11 items-center gap-2.5 rounded-[8px] px-3 py-1 text-left', modo === k ? 'bg-[oklch(0.96_0.02_180)] dark:bg-[oklch(0.28_0.03_180)]' : 'hover:bg-background')}>
                <span className="flex flex-1 flex-col gap-px">
                  <span className="text-sm font-medium">{l}</span>
                  {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
                </span>
                {modo === k && !(k === 'custom' && cal) && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="oklch(0.45 0.1 180)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                )}
              </button>
            ))}
          </div>
          {cal && (
            <div className="border-t border-border pt-2.5">
              <Calendario iniziale={custom} ultimo={oggi} riepilogoVuoto="Scegli il periodo B"
                onApplica={r => { onCustom(r); onModo('custom'); chiudi() }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
