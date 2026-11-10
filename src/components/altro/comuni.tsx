'use client'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { useTelefono } from '@/components/presenze/comuni'

// Pezzi condivisi delle schede di Altro (MTAltro.dc.html: Bacheca, ODS,
// Dipendenti, Ristoranti) e delle sezioni analoghe del direttore: barra con
// locali, reparti, indicatori e pulsante nero; elenco in una card con
// intestazione a colonne; dettaglio a destra su tablet e foglio dal basso sul
// telefono; foglio "Nuovo …" con gruppi di pillole; foglio delle credenziali.

export { useTelefono }

export const USCITA = 320
export const SWAPIN = 'swapin 680ms cubic-bezier(0.22,1,0.36,1) both'
export const SWAPOUT = 'swapout 320ms cubic-bezier(0.4,0,1,1) both'

// Toni dei badge del prototipo (B: ok, warn, neg, neu, tl) con il loro
// equivalente scuro.
export type Tono = 'ok' | 'warn' | 'neg' | 'neu' | 'tl'
export const TONI: Record<Tono, string> = {
  ok: 'bg-ok-tint text-ok',
  warn: 'bg-warn-tint text-warn',
  neg: 'bg-neg-tint text-neg',
  neu: 'bg-[oklch(0.93_0.01_250)] text-muted-foreground dark:bg-secondary',
  tl: 'bg-[oklch(0.94_0.04_180)] text-[oklch(0.4_0.08_180)] dark:bg-[oklch(0.3_0.05_180)] dark:text-[oklch(0.85_0.07_180)]',
}
/** Colore del quadratino quando la riga vale per tutti i locali. */
export const GRIGIO_TUTTI = 'oklch(0.6 0.01 250)'

export function Badge({ tono, children, className }: { tono: Tono; children: ReactNode; className?: string }) {
  return <span className={cn('flex-none whitespace-nowrap rounded-full px-[9px] py-[3px] text-[10px] font-semibold uppercase tracking-[.05em]', TONI[tono], className)}>{children}</span>
}

export const ICONA_PIU = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M5 12h14" /><path d="M12 5v14" /></svg>
export const ICONA_X = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
export const ICONA_RIGENERA = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></svg>
export const ICONA_COPIA = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
export const ICONA_CONDIVIDI = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 15V4" /><path d="M8 8l4-4 4 4" /><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" /></svg>
export const ICONA_MIRINO = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3" /><path d="M12 19v3" /><path d="M2 12h3" /><path d="M19 12h3" /></svg>
export const ICONA_SCARICA = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></svg>

// Montato solo nel browser (i fogli vanno in un portale sul body, sopra
// intestazione e barra del guscio).
export function useMontato() {
  return useSyncExternalStore(() => () => {}, () => true, () => false)
}

/** Apertura/uscita animata (swapout 320 ms prima di smontare). */
export function useUscita<T>() {
  const [dati, setDati] = useState<T | null>(null)
  const [esce, setEsce] = useState(false)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (t.current) clearTimeout(t.current) }, [])
  const apri = (d: T) => { if (t.current) clearTimeout(t.current); setEsce(false); setDati(d) }
  const chiudi = (poi?: () => void) => {
    setEsce(true)
    if (t.current) clearTimeout(t.current)
    t.current = setTimeout(() => { setDati(null); setEsce(false); poi?.() }, USCITA)
  }
  return { dati, setDati, esce, apri, chiudi }
}

// ── Barra in alto ───────────────────────────────────────────────────────

export interface Kpi { l: string; v: string; c?: string }
export interface Scheda { k: string; l: string; on: boolean; onClick: () => void }

export function BarraAltro({ locali, schede, kpis, nuovo }: {
  locali?: ReactNode
  schede?: Scheda[]
  kpis: Kpi[]
  nuovo?: { l: string; onClick: () => void; disabilitato?: boolean }
}) {
  const tel = useTelefono()
  // Sul telefono i reparti hanno senso solo se sono almeno due.
  const conSchede = !!schede && (tel ? schede.length >= 2 : schede.length > 0)
  if (!locali && !conSchede && !nuovo && !kpis.length) return null
  return (
    <div className="flex flex-none flex-wrap items-center gap-2.5">
      {locali && <div data-sk-keep="" className={cn('min-w-0', tel ? 'flex-[1_1_100%]' : 'flex-[0_1_auto]')}>{locali}</div>}
      {conSchede && (
        <div data-sk-keep="" className={cn('flex min-w-0 gap-1.5 overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', tel ? 'flex-[1_1_100%]' : 'flex-none')}>
          {schede!.map(s => (
            <button key={s.k} type="button" onClick={s.onClick}
              className={cn('flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border px-3 text-[13px] font-medium transition-[background-color,color] duration-200 active:scale-[0.97]',
                tel ? 'flex-[1_1_auto]' : 'flex-none',
                s.on ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-card text-foreground dark:border-line-strong')}>
              {s.l}
            </button>
          ))}
        </div>
      )}
      {!tel && <span className="block flex-1" />}
      {kpis.map(k => (
        <div key={k.l} className={cn('flex min-w-0 flex-col', tel ? 'flex-[1_1_0] items-start px-0.5' : 'flex-none items-end px-2.5')}>
          <span className="text-xs font-medium text-muted-foreground">{k.l}</span>
          <span className="font-mono text-[17px] font-semibold" style={k.c ? { color: k.c } : undefined}>{k.v}</span>
        </div>
      ))}
      {nuovo && (
        <button data-sk-keep="" type="button" onClick={nuovo.onClick} disabled={nuovo.disabilitato}
          title={nuovo.disabilitato ? "Disponibile dopo l'attivazione" : undefined}
          className="flex h-10 flex-none items-center gap-2 rounded-[8px] bg-primary px-4 text-sm font-semibold text-primary-foreground active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100">
          {ICONA_PIU}{nuovo.l}
        </button>
      )}
    </div>
  )
}

/** Pillole dei locali senza "Tutti" (Ristoranti): le pillole condivise, riordinabili come altrove. */
export function PilloleSenzaTutti({ locali, scelto, onScegli }: { locali: { id: string; nome: string; colore: string }[]; scelto: string | null; onScegli: (id: string) => void }) {
  return (
    <PilloleLocali senzaTutti nascondiSeUno={false} className="sm:mx-0 sm:px-0" locali={locali}
      selezionati={scelto ? [scelto] : []} onCambia={ids => { if (ids[0]) onScegli(ids[0]) }} />
  )
}

// ── Elenco ──────────────────────────────────────────────────────────────

export interface RigaAltro {
  key: string
  a: string
  as: string
  /** Colore del quadratino del locale. */
  lc: string
  b: string
  c: string
  /** Colore della colonna C (default muted). */
  cc?: string
  t: string
  tono: Tono
  nuova?: boolean
}

export interface Testata { l: string; a: 'left' | 'right' }

export function ElencoAltro({ testate, colonne, righe, scelta, onScegli, vuoto, coda, inLinea }: {
  testate: Testata[]
  colonne: string
  righe: RigaAltro[]
  scelta: string | null
  onScegli: (k: string) => void
  vuoto?: { t: string; s: string }
  /** Riga extra in fondo all'elenco (es. "Aggiungi fascia"). */
  coda?: ReactNode
  /** Telefono, Ristoranti: l'elenco non riempie lo spazio ma scorre con la pagina. */
  inLinea?: boolean
}) {
  const tel = useTelefono()
  return (
    <div className={cn('anim-swapin flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-border bg-card', inLinea ? 'flex-none' : 'flex-[1_1_auto]')}>
      {!tel && (
        <div className="grid flex-none gap-2.5 border-b border-border bg-[oklch(0.97_0.01_250)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground dark:bg-secondary" style={{ gridTemplateColumns: colonne }}>
          {testate.map(h => <span key={h.l} style={{ textAlign: h.a }}>{h.l}</span>)}
        </div>
      )}
      <div className={cn('min-h-0 flex-1 overscroll-contain', !inLinea && 'overflow-y-auto')}>
        {righe.length === 0 && vuoto && (
          <div key={vuoto.t} className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center text-pretty">
            <span className="text-[15px] font-semibold">{vuoto.t}</span>
            <span className="text-[13px] text-muted-foreground">{vuoto.s}</span>
          </div>
        )}
        {righe.map(r => {
          const on = r.key === scelta
          return (
            <button
              key={r.key} type="button" onClick={() => onScegli(r.key)}
              className={cn('grid min-h-[56px] w-full items-center border-b border-[oklch(0.94_0.01_250)] text-left transition-[background-color] duration-200 active:scale-[0.995] dark:border-border',
                tel ? 'gap-x-3 gap-y-1 py-2.5 pl-4 pr-3.5' : 'gap-2.5 px-4', on ? 'bg-primary text-primary-foreground' : 'bg-transparent text-foreground', r.nuova && 'anim-swapin')}
              style={{ gridTemplateColumns: tel ? 'minmax(0,1fr) auto' : colonne }}
            >
              <span className="flex min-w-0 flex-col gap-px" style={tel ? { gridArea: '1 / 1 / 2 / 2' } : undefined}>
                <span className="text-sm font-medium text-pretty">{r.a}</span>
                <span className={cn('flex min-w-0 items-center gap-1.5 text-xs', on ? 'text-[oklch(0.85_0.01_250)] dark:text-[oklch(0.35_0.01_250)]' : 'text-muted-foreground')}>
                  <span className="h-[7px] w-[7px] flex-none rounded-[2px]" style={{ background: r.lc }} />
                  <span className="truncate">{r.as}</span>
                </span>
              </span>
              <span className="whitespace-nowrap text-right font-mono text-sm font-medium" style={tel ? { gridArea: '1 / 2 / 2 / 3' } : undefined}>{r.b}</span>
              <span className={cn('whitespace-nowrap text-right font-mono font-medium', tel ? 'text-[12.5px]' : 'text-sm', !on && !r.cc && 'text-muted-foreground')}
                style={{ ...(tel ? { gridArea: '2 / 2 / 3 / 3' } : {}), ...(!on && r.cc ? { color: r.cc } : {}) }}>{r.c}</span>
              <span className={tel ? 'justify-self-start' : 'justify-self-end'} style={tel ? { gridArea: '2 / 1 / 3 / 2' } : undefined}>
                <Badge tono={r.tono}>{r.t}</Badge>
              </span>
            </button>
          )
        })}
        {coda}
      </div>
    </div>
  )
}

// ── Dettaglio ───────────────────────────────────────────────────────────

export interface RigaSezione { l: string; v: string; c?: string; forte?: boolean; vecchio?: string }
export interface SezioneDettaglio { h: string; righe: RigaSezione[]; coda?: ReactNode }
export interface AzioneDettaglio { l: string; onClick: () => void; stile: 'contorno' | 'nero' | 'neg' | 'negPieno'; disabilitata?: boolean }
export interface DatiDettaglio {
  titolo: string
  sotto: string
  tag: string
  tono: Tono
  msg?: string
  stats?: { l: string; v: string; c?: string }[]
  extra?: ReactNode
  sezioni?: SezioneDettaglio[]
  giorni?: { l: string; on: boolean; onClick: () => void }[]
  azioni?: AzioneDettaglio[]
}

function CorpoDettaglio({ d, tel, onChiudi }: { d: DatiDettaglio; tel: boolean; onChiudi?: () => void }) {
  const cx = tel ? 'px-3.5' : 'px-[18px]'
  return (
    <>
      <div className={cn('flex flex-none items-center gap-3 border-b border-border py-3.5', cx)}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-lg font-semibold text-pretty">{d.titolo}</span>
          <span className="text-[13px] text-muted-foreground text-pretty">{d.sotto}</span>
        </div>
        <Badge tono={d.tono}>{d.tag}</Badge>
        {tel && onChiudi && (
          <button type="button" onClick={onChiudi} aria-label="Chiudi" className="-my-2 -ml-1 -mr-2.5 flex h-11 w-11 flex-none items-center justify-center rounded-[22px] text-muted-foreground active:scale-[0.96]">{ICONA_X}</button>
        )}
      </div>
      <div className={cn('flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain py-3.5', cx)}>
        {d.msg && <div className="whitespace-pre-wrap rounded-[10px] bg-[oklch(0.965_0.01_250)] px-3.5 py-3 text-sm font-medium leading-[1.45] text-[oklch(0.3_0.01_250)] dark:bg-secondary dark:text-foreground">{d.msg}</div>}
        {d.stats && d.stats.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {d.stats.map(s => (
              <div key={s.l} className="flex flex-col gap-[3px] rounded-[10px] bg-background px-3.5 py-3">
                <span className="text-xs font-medium text-muted-foreground">{s.l}</span>
                <span className="font-mono text-lg font-semibold" style={s.c ? { color: s.c } : undefined}>{s.v}</span>
              </div>
            ))}
          </div>
        )}
        {d.extra}
        {(d.sezioni ?? []).map(sc => (
          <div key={sc.h} className="flex flex-col">
            <span className="pb-1.5 text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">{sc.h}</span>
            {sc.righe.map((x, i) => (
              <div key={x.l + i} className="-mx-2 grid min-h-10 items-center gap-3 rounded-[6px] border-t border-[oklch(0.94_0.01_250)] px-2 dark:border-border" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
                <span className={cn('py-2 text-sm leading-[1.35] text-[oklch(0.3_0.01_250)] dark:text-[oklch(0.85_0.01_250)]', x.forte ? 'font-semibold' : 'font-normal')}>{x.l}</span>
                {x.vecchio ? <span className="font-mono text-[13px] font-medium text-[oklch(0.55_0.01_250)] line-through">{x.vecchio}</span> : <span />}
                <span className={cn('whitespace-nowrap font-mono text-sm', x.forte ? 'font-semibold' : 'font-normal', !x.c && 'text-foreground')} style={x.c ? { color: x.c } : undefined}>{x.v}</span>
              </div>
            ))}
            {sc.coda}
          </div>
        ))}
        {d.giorni && d.giorni.length > 0 && (
          <div className="-mt-2 grid grid-cols-7 gap-1.5">
            {d.giorni.map(g => (
              <button key={g.l} type="button" onClick={g.onClick}
                className={cn('flex h-11 items-center justify-center rounded-[8px] border text-[13px] font-medium transition-[background-color] duration-200 active:scale-[0.96]',
                  g.on ? 'border-[oklch(0.84_0.06_25)] bg-neg-tint text-neg dark:border-[oklch(0.45_0.08_25)]' : 'border-[oklch(0.88_0.01_250)] bg-card text-foreground dark:border-line-strong')}>
                {g.l}
              </button>
            ))}
          </div>
        )}
      </div>
      {d.azioni && d.azioni.length > 0 && (
        <div className={cn('grid flex-none gap-2.5 border-t border-border pb-4 pt-3', cx)} style={{ gridTemplateColumns: `repeat(${d.azioni.length},minmax(0,1fr))` }}>
          {d.azioni.map(a => (
            <button key={a.l} type="button" onClick={a.onClick} disabled={a.disabilitata}
              className={cn('box-border flex h-[52px] items-center justify-center gap-2 rounded-[8px] border px-3 text-center text-[15px] font-semibold leading-[1.2] transition-[background-color] duration-200 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100',
                a.stile === 'contorno' && 'border-line-strong bg-transparent text-foreground',
                a.stile === 'nero' && 'border-primary bg-primary text-primary-foreground',
                a.stile === 'neg' && 'border-[oklch(0.85_0.05_25)] bg-transparent text-neg dark:border-[oklch(0.45_0.08_25)]',
                a.stile === 'negPieno' && 'border-[oklch(0.45_0.1_25)] bg-[oklch(0.45_0.1_25)] text-white')}>
              {a.l}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

/**
 * Pannello del dettaglio. Tablet: card a destra (o "Seleziona una riga").
 * Telefono: foglio dal basso con scrim; `inLinea` (Ristoranti) lo mostra
 * come card dentro la pagina che scorre.
 */
export function PannelloDettaglio({ d, chiave, esce, onChiudi, inLinea, sempreFoglio }: {
  d: DatiDettaglio | null; chiave: string; esce: boolean; onChiudi: () => void; inLinea?: boolean
  /** Viste pensate per il telefono (capo servizio): foglio dal basso anche su tablet. */
  sempreFoglio?: boolean
}) {
  const tel = useTelefono() || !!sempreFoglio
  const montato = useMontato()
  if (tel && !inLinea) {
    if (!d || !montato) return null
    return createPortal(
      <div onClick={onChiudi} className="fixed inset-0 z-[70] flex flex-col justify-end pt-[72px] transition-[background-color] duration-300" style={{ background: esce ? 'rgba(15,20,30,0)' : 'rgba(15,20,30,.22)' }}>
        <div key={chiave} onClick={e => e.stopPropagation()} role="dialog" aria-label={d.titolo}
          className={cn('flex h-full min-h-0 flex-col overflow-hidden rounded-t-[20px] border border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_20px_60px_rgba(20,30,50,.18)]', esce ? 'anim-swapout' : 'anim-swapin')}>
          <CorpoDettaglio d={d} tel onChiudi={onChiudi} />
        </div>
      </div>,
      document.body,
    )
  }
  return (
    <div key={chiave} className={cn('relative flex min-h-0 flex-none flex-col overflow-hidden rounded-[12px] border border-border bg-card', esce ? 'anim-swapout' : 'anim-swapin')}>
      {d ? <CorpoDettaglio d={d} tel={tel} /> : (
        <div className="flex flex-1 items-center justify-center py-12 text-sm font-medium text-muted-foreground">Seleziona una riga per vedere il dettaglio.</div>
      )}
    </div>
  )
}

/** Contenitore della scheda: barra, griglia elenco + dettaglio. */
export function GrigliaAltro({ inLinea, children }: { inLinea?: boolean; children: ReactNode }) {
  const tel = useTelefono()
  return (
    <div className={cn('min-h-0 flex-1 gap-4',
      tel && inLinea ? '-mx-4 flex flex-col overflow-y-auto overscroll-contain px-4' : tel ? 'grid grid-cols-[minmax(0,1fr)]' : 'grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]')}>
      {children}
    </div>
  )
}

// ── Foglio "Nuovo …" e fogli modali ─────────────────────────────────────

/** Foglio modale del prototipo: in alto su tablet, dal basso sul telefono. */
export function FoglioAltro({ aperto, esce, onChiudi, larghezza = 620, altoTablet = 150, z = 70, testata, children }: {
  aperto: boolean; esce: boolean; onChiudi: () => void; larghezza?: number; altoTablet?: number; z?: number
  testata: ReactNode; children: ReactNode
}) {
  const tel = useTelefono()
  const montato = useMontato()
  if (!aperto || !montato) return null
  return createPortal(
    <div onClick={onChiudi}
      className={cn('fixed inset-0 box-border flex justify-center transition-[background-color] duration-300', tel ? 'items-end pt-[72px]' : 'items-start')}
      style={{ zIndex: z, background: esce ? 'rgba(15,20,30,0)' : 'rgba(15,20,30,.28)', paddingTop: tel ? undefined : altoTablet }}>
      <div onClick={e => e.stopPropagation()} role="dialog"
        className={cn('box-border flex max-h-full flex-col overflow-y-auto overscroll-contain border border-border bg-card shadow-[0_20px_60px_rgba(20,30,50,.18)]',
          tel ? 'w-full rounded-t-[20px] pb-[calc(20px+env(safe-area-inset-bottom))]' : 'rounded-[14px]', esce ? 'anim-swapout' : 'anim-swapin')}
        style={{ width: tel ? '100%' : `min(${larghezza}px, calc(100vw - 32px))`, maxHeight: tel ? '100%' : `calc(100dvh - ${altoTablet + 24}px)` }}>
        {testata}
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function TestataFoglio({ titolo, onChiudi }: { titolo: string; onChiudi: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-[22px]">
      <span className="flex-1 text-xl font-semibold">{titolo}</span>
      <button type="button" onClick={onChiudi} aria-label="Chiudi" className="flex h-11 w-11 items-center justify-center rounded-[22px] text-muted-foreground active:scale-[0.96]">{ICONA_X}</button>
    </div>
  )
}

export function CorpoFoglio({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 px-4 py-4 sm:px-[22px]">{children}</div>
}

export function Campo({ etichetta, children, className, style }: { etichetta: string; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)} style={style}>
      <span className="text-sm font-medium">{etichetta}</span>
      {children}
    </div>
  )
}

export const CLASSE_INPUT = 'box-border h-[52px] min-w-0 rounded-[6px] border border-line-strong bg-card px-3.5 text-base text-foreground outline-none placeholder:text-muted-foreground'

export function Testo({ value, onChange, placeholder, mono, inputMode, autoCapitalize, className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; autoCapitalize?: string; className?: string
}) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode} autoCapitalize={autoCapitalize}
      spellCheck={mono ? false : undefined} autoCorrect={mono ? 'off' : undefined}
      className={cn(CLASSE_INPUT, mono ? 'font-mono font-medium' : 'font-normal', className)} />
  )
}

/** Gruppo di pillole (scelta singola o multipla) del foglio. */
export function GruppoPillole<T extends string>({ etichetta, opzioni, scelte, onTocca, griglia7, anima }: {
  etichetta: string
  opzioni: { v: T; l: string }[]
  scelte: T[]
  onTocca: (v: T) => void
  /** Giorni della settimana: griglia a 7 colonne. */
  griglia7?: boolean
  /** Il gruppo compare con lo swapin (gruppi che dipendono da una scelta). */
  anima?: boolean
}) {
  return (
    <div className={cn('flex flex-col gap-2', anima && 'anim-swapin')}>
      <span className="text-sm font-medium">{etichetta}</span>
      <div className={griglia7 ? 'grid grid-cols-7 gap-1.5' : 'flex flex-wrap gap-1.5'}>
        {opzioni.map(o => {
          const on = scelte.includes(o.v)
          return (
            <button key={o.v} type="button" onClick={() => onTocca(o.v)}
              className={cn('flex h-10 items-center justify-center rounded-full border text-[13px] font-medium transition-[background-color,color] duration-200 active:scale-[0.97]',
                griglia7 ? 'px-0' : 'px-3.5', on ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-card text-foreground dark:border-line-strong')}>
              {o.l}
            </button>
          )
        })}
        {opzioni.length === 0 && <span className="text-[13px] text-muted-foreground">Nessuna opzione disponibile.</span>}
      </div>
    </div>
  )
}

export function Nota({ children }: { children: ReactNode }) {
  return <span className="text-[13px] text-muted-foreground text-pretty">{children}</span>
}

/** Annulla · Salva del foglio (1fr 2fr), con l'eventuale Elimina a due tocchi davanti. */
export function PulsantiSalva({ onAnnulla, onSalva, etichetta, attivo, occupato, elimina }: {
  onAnnulla: () => void; onSalva: () => void; etichetta: string; attivo: boolean; occupato?: boolean
  elimina?: { conferma: boolean; onClick: () => void }
}) {
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: elimina ? '1fr 1fr 2fr' : '1fr 2fr' }}>
      {elimina && (
        <button type="button" onClick={elimina.onClick} disabled={occupato}
          className={cn('flex h-[52px] items-center justify-center rounded-[6px] border text-[15px] font-medium transition-[background-color,color] duration-200 active:scale-[0.98]',
            elimina.conferma ? 'border-[oklch(0.45_0.1_25)] bg-[oklch(0.45_0.1_25)] text-white' : 'border-[oklch(0.85_0.05_25)] text-neg dark:border-[oklch(0.45_0.08_25)]')}>
          {elimina.conferma ? 'Conferma' : 'Elimina'}
        </button>
      )}
      <button type="button" onClick={onAnnulla} className="flex h-[52px] items-center justify-center rounded-[6px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">Annulla</button>
      <button type="button" onClick={onSalva} disabled={!attivo || occupato}
        className="flex h-[52px] items-center justify-center rounded-[6px] bg-primary text-[15px] font-semibold text-primary-foreground transition-opacity duration-200 active:scale-[0.98] disabled:active:scale-100"
        style={{ opacity: attivo && !occupato ? 1 : 0.4 }}>
        {etichetta}
      </button>
    </div>
  )
}

/** Doppio tocco "Elimina" → "Conferma" (3 s), come in Ristoranti. */
export function useDoppioTocco() {
  const [armato, setArmato] = useState<string | null>(null)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (t.current) clearTimeout(t.current) }, [])
  const tocca = (k: string, azione: () => void) => {
    if (armato === k) { if (t.current) clearTimeout(t.current); setArmato(null); azione(); return }
    setArmato(k)
    if (t.current) clearTimeout(t.current)
    t.current = setTimeout(() => setArmato(null), 3000)
  }
  return { armato, tocca, reset: () => setArmato(null) }
}

// ── Credenziali ─────────────────────────────────────────────────────────

const CARATTERI_PW = 'abcdefghjkmnpqrstuvwxyz23456789'
/** Password di 8 caratteri senza simboli ambigui (prototipo: genPw). */
export function generaPassword(): string {
  const a = new Uint32Array(8)
  crypto.getRandomValues(a)
  return Array.from(a, x => CARATTERI_PW[x % CARATTERI_PW.length]).join('')
}

/** Username proposto dal nome: "mario.esposito", senza accenti, con un numero se già usato. */
export function usernameDa(nome: string, esistenti: string[]): string {
  const b = nome.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean).join('.')
  let u = b, k = 2
  while (u && esistenti.includes(u)) u = b + k++
  return u
}

export async function copia(testo: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(testo); return true } catch { return false }
}
