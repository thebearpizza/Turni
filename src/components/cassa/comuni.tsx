'use client'
import { SelettoreMese } from '@/components/shared/SelettoreMese'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Tastierino, type TastoTastierino } from '@/components/ui/tastierino'
import { cn } from '@/lib/utils'

// Mattoni comuni delle schermate di Cassa (Chiusura Tablet v2, Cassiere
// e Dipendente 3b, MTCassa): campi a tastierino, pillole di stato, icone
// SVG del design, fogli modali con swapin/swapout e formati degli importi.

export const USCITA = 320
export const TEAL = 'oklch(0.58 0.12 180)'

/** Telefono (< 640 px) o tablet: i prototipi hanno layout distinti. */
export function useTelefono() {
  return useSyncExternalStore(
    cb => { const mq = window.matchMedia('(max-width: 639px)'); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb) },
    () => window.matchMedia('(max-width: 639px)').matches,
    () => false
  )
}

/** Apertura con swapin e chiusura con swapout di 320 ms prima di smontare. */
export function useApriChiudi() {
  const [aperto, setAperto] = useState(false)
  const [esce, setEsce] = useState(false)
  const tm = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apri = useCallback(() => { if (tm.current) clearTimeout(tm.current); setEsce(false); setAperto(true) }, [])
  const chiudi = useCallback(() => {
    setEsce(true)
    if (tm.current) clearTimeout(tm.current)
    tm.current = setTimeout(() => { setAperto(false); setEsce(false) }, USCITA)
  }, [])
  useEffect(() => () => { if (tm.current) clearTimeout(tm.current) }, [])
  return { aperto, esce, apri, chiudi }
}

// ── Formati (come eu/eu2 dei prototipi: punto per le migliaia, "−") ──
export function n2(n: number): string {
  const [a, b] = Math.abs(n).toFixed(2).split('.')
  return (n < -0.0049 ? '−' : '') + a.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + b
}
export const eur = (n: number) => `€ ${n2(n)}`
export const eur0 = (n: number) => `€ ${Math.round(Math.abs(n)).toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)}`
/** Differenza con segno: "+12,00 €" / "−12,00 €" / "0,00 €". */
export const diffTesto = (d: number) => (Math.abs(d) < 0.005 ? '0,00 €' : `${d > 0 ? '+' : ''}${n2(d)} €`)
/** Variazione con segno in euro: "+€ 36,00". */
export const segno = (d: number) => (Math.abs(d) < 0.005 ? '€ 0,00' : `${d > 0 ? '+' : '−'}${eur(Math.abs(d))}`)

// ── Pillole di stato (pill, maiuscolo, 10 px, peso 600) ─────────────
export type Tono = 'ok' | 'warn' | 'neg' | 'neu'
export const TONO: Record<Tono, string> = {
  ok: 'bg-ok-tint text-ok',
  warn: 'bg-warn-tint text-warn',
  neg: 'bg-neg-tint text-neg',
  neu: 'bg-[oklch(0.93_0.01_250)] text-muted-foreground dark:bg-secondary',
}
export function Pillola({ tono, children, className }: { tono: Tono; children: React.ReactNode; className?: string }) {
  return <span className={cn('whitespace-nowrap rounded-full px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[.05em]', TONO[tono], className)}>{children}</span>
}
/** Pillola grigia della categoria di spesa. */
export function PillolaCategoria({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-[oklch(0.94_0.01_250)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.05em] text-muted-foreground dark:bg-secondary">{children}</span>
}

// ── Icone SVG copiate dai file di design ────────────────────────────
export const IconaPiu = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M5 12h14" /><path d="M12 5v14" /></svg>
)
export const IconaPiuPieno = () => (
  <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z" /></svg>
)
export const IconaX = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
)
export const IconaSpunta = ({ size = 18, stroke = 'currentColor', w = 2.2 }: { size?: number; stroke?: string; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
)
export const IconaMatita = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" /></svg>
)
export const IconaGiu = () => (
  <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor" aria-hidden><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" /></svg>
)
export const IconaAvviso = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg>
)
export const Freccia = ({ dir }: { dir: 'sx' | 'dx' }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={dir === 'sx' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} /></svg>
)
export const ChevronEspandi = ({ aperto }: { aperto: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="oklch(0.47 0.01 250)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    style={{ transition: 'transform 300ms cubic-bezier(0.22,1,0.36,1)', transform: `rotate(${aperto ? 180 : 0}deg)` }}><path d="M6 9l6 6 6-6" /></svg>
)

// ── Tastierino: buffer digitato come nel prototipo ──────────────────
// Il primo tasto sostituisce il valore (che resta visibile finché non si
// digita); ogni tasto propaga subito il numero, così riepilogo e
// differenza si aggiornano mentre si scrive.
export function useBuffer(decimali: number, onNumero: (n: number) => void) {
  const [buffer, setBuffer] = useState<string>('')
  const premi = useCallback((k: TastoTastierino) => {
    setBuffer(prev => {
      let b = prev
      if (k === 'del') b = b.slice(0, -1)
      else if (k === ',') { if (decimali === 0 || b.includes(',')) return prev; b = (b || '0') + ',' }
      else {
        const dec = b.split(',')[1]
        if (dec !== undefined && dec.length >= decimali) return prev
        if (b.replace(',', '').length >= 8) return prev
        b = b === '0' ? k : b + k
      }
      const n = parseFloat((b || '0').replace(',', '.'))
      if (Number.isFinite(n)) onNumero(n)
      return b
    })
  }, [decimali, onNumero])
  return { buffer, premi, azzera: () => setBuffer('') }
}
const mostraBuffer = (b: string) => { const [i, d] = b.split(','); const f = (i === '' ? '0' : Number(i).toLocaleString('it-IT')); return d !== undefined ? `${f},${d}` : f }

export const TAGLIA = {
  // Misure ridotte su richiesta ("troppo grandi"): prima 64/56/52/48 px.
  xl: 'h-12 px-4 text-xl',          // chiusura su tablet: campi da 48 px, Geist Mono 20
  l: 'h-12 px-4 text-lg',            // importo della nuova spesa, contanti per banca su telefono
  m: 'h-11 px-3.5 text-[17px]',
  s: 'h-11 px-3.5 text-base',       // telefono (3b)
}

export interface CampoCassaProps {
  etichetta?: string
  nota?: string
  valore: number | null
  onCambia?: (n: number) => void
  decimali?: number
  unita?: string
  /** "auto": calcolato (sfondo grigio, nota AUTO); "ro": riportato e bloccato. */
  variante?: 'edit' | 'auto' | 'ro'
  taglia?: keyof typeof TAGLIA
  /** Campo obbligatorio non ancora compilato dopo un tentativo di avanzare. */
  errore?: boolean
  /** Bordo nero spesso: il campo "attivo" del passaggio (design). */
  evidenzia?: boolean
  onRimuovi?: () => void
  etichettaRimuovi?: string
  className?: string
  classeEtichetta?: string
}

/** Campo numerico del design con tastierino flottante ancorato. */
export function CampoCassa({ etichetta, nota, valore, onCambia, decimali = 2, unita = '€', variante = 'edit', taglia = 'xl', errore, evidenzia, onRimuovi, etichettaRimuovi, className, classeEtichetta }: CampoCassaProps) {
  const [aperto, setAperto] = useState(false)
  const modificabile = variante === 'edit' && !!onCambia
  const { buffer, premi, azzera } = useBuffer(decimali, n => onCambia?.(n))

  useEffect(() => {
    if (!aperto) return
    const k = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); premi(e.key as TastoTastierino) }
      else if (e.key === ',' || e.key === '.') { e.preventDefault(); premi(',') }
      else if (e.key === 'Backspace') { e.preventDefault(); premi('del') }
      else if (e.key === 'Enter') { e.preventDefault(); setAperto(false) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [aperto, premi])

  const testo = aperto && buffer ? mostraBuffer(buffer) : valore === null ? (decimali ? '0,00' : '0') : decimali ? n2(valore) : String(valore)
  const muto = variante !== 'edit' || (valore === null && !(aperto && buffer))

  const box = (
    <div
      role={modificabile ? 'button' : undefined}
      tabIndex={modificabile ? 0 : -1}
      aria-label={etichetta}
      onKeyDown={e => { if (modificabile && !aperto && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); azzera(); setAperto(true) } }}
      className={cn('relative flex w-full items-center justify-between rounded-[12px] font-mono font-medium tabular-nums outline-none transition-[border-color] duration-150',
        TAGLIA[taglia],
        variante === 'edit' ? 'border bg-card' : 'border border-transparent bg-[oklch(0.94_0.01_250)] dark:bg-secondary',
        variante === 'edit' && (aperto ? 'border-[1.5px] border-[oklch(0.58_0.12_180)]' : evidenzia ? 'border-[1.5px] border-foreground' : errore ? 'border-[1.5px] border-[oklch(0.6_0.13_25)]' : 'border-line-strong'),
        modificabile && 'cursor-pointer',
        muto ? 'text-muted-foreground' : aperto && buffer ? 'text-[oklch(0.45_0.1_180)] dark:text-[oklch(0.75_0.1_180)]' : 'text-foreground',
        className)}
    >
      <span className="min-w-0 truncate">{testo}</span>
      {unita && <span className="flex-none text-[0.66em] text-muted-foreground">{unita}</span>}
    </div>
  )

  const contenuto = !modificabile ? box : (
    <PopoverPrimitive.Root open={aperto} onOpenChange={o => { if (o) azzera(); setAperto(o) }}>
      <PopoverPrimitive.Trigger asChild>{box}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content side="bottom" align="start" sideOffset={8} collisionPadding={12} onOpenAutoFocus={e => e.preventDefault()}
          className="z-[70] outline-none data-[state=closed]:anim-swapout data-[state=open]:anim-swapin">
          <Tastierino compatto onKey={premi} onDone={() => setAperto(false)} senzaVirgola={decimali === 0}
            onRemove={onRimuovi ? () => { setAperto(false); onRimuovi() } : undefined} removeLabel={etichettaRimuovi} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )

  if (!etichetta) return contenuto
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className={cn('flex justify-between text-sm font-medium leading-5', classeEtichetta)}>
        {etichetta}
        {(nota || variante === 'auto') && <span className="font-mono text-[11px] font-medium uppercase tracking-[.05em] text-muted-foreground">{nota ?? 'AUTO'}</span>}
      </span>
      {contenuto}
    </div>
  )
}

/** Riga di un elenco che si modifica col tastierino (dettaglio 5e). */
export function RigaTastierino({ children, valore, onCambia, decimali = 2, onRimuovi, etichettaRimuovi, bloccata, className }: {
  children: (stato: { aperto: boolean; testo: string | null }) => React.ReactNode
  valore: number; onCambia: (n: number) => void; decimali?: number; onRimuovi?: () => void; etichettaRimuovi?: string; bloccata?: boolean; className?: string
}) {
  const [aperto, setAperto] = useState(false)
  const { buffer, premi, azzera } = useBuffer(decimali, onCambia)
  useEffect(() => {
    if (!aperto) return
    const k = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); premi(e.key as TastoTastierino) }
      else if (e.key === ',' || e.key === '.') { e.preventDefault(); premi(',') }
      else if (e.key === 'Backspace') { e.preventDefault(); premi('del') }
      else if (e.key === 'Enter') { e.preventDefault(); setAperto(false) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [aperto, premi])
  void valore
  const riga = (
    <div role={bloccata ? undefined : 'button'} tabIndex={bloccata ? -1 : 0}
      className={cn('relative transition-[background-color] duration-150', !bloccata && 'cursor-pointer', aperto && 'bg-[oklch(0.96_0.02_180)] dark:bg-[oklch(0.28_0.03_180)]', className)}>
      {children({ aperto, testo: aperto && buffer ? mostraBuffer(buffer) : null })}
    </div>
  )
  if (bloccata) return riga
  return (
    <PopoverPrimitive.Root open={aperto} onOpenChange={o => { if (o) azzera(); setAperto(o) }}>
      <PopoverPrimitive.Trigger asChild>{riga}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content side="bottom" align="end" alignOffset={12} sideOffset={6} collisionPadding={12} onOpenAutoFocus={e => e.preventDefault()}
          className="z-[70] outline-none data-[state=closed]:anim-swapout data-[state=open]:anim-swapin">
          <Tastierino compatto onKey={premi} onDone={() => setAperto(false)} senzaVirgola={decimali === 0}
            onRemove={onRimuovi ? () => { setAperto(false); onRimuovi() } : undefined} removeLabel={etichettaRimuovi} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/** Menu a tendina del design (Categoria "Pulizia ▾"). */
export function MenuScelta<T extends string>({ valore, opzioni, onScegli, vuoto = 'Scegli', piede }: {
  valore: T | null; opzioni: { k: T; l: string }[]; onScegli: (k: T) => void; vuoto?: string; piede?: React.ReactNode
}) {
  const [aperto, setAperto] = useState(false)
  const sel = opzioni.find(o => o.k === valore)
  return (
    <PopoverPrimitive.Root open={aperto} onOpenChange={setAperto}>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" className="flex h-12 w-full items-center justify-between rounded-[12px] bg-[oklch(0.94_0.01_250)] px-4 text-[15px] font-medium active:scale-[0.99] dark:bg-secondary">
          <span className={cn('truncate', !sel && 'text-muted-foreground')}>{sel?.l ?? vuoto}</span>
          <span className="text-muted-foreground">▾</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content side="bottom" align="start" sideOffset={6} collisionPadding={12}
          className="z-[70] max-h-[320px] w-[var(--radix-popover-trigger-width)] min-w-[200px] overflow-y-auto overscroll-contain rounded-[6px] border border-border bg-card shadow-[0_2px_8px_rgba(20,30,50,.05)] outline-none data-[state=closed]:anim-swapout data-[state=open]:anim-swapin">
          {opzioni.length === 0 && <div className="px-4 py-4 text-sm text-muted-foreground">Nessuna categoria</div>}
          {opzioni.map(o => (
            <button key={o.k} type="button" onClick={() => { onScegli(o.k); setAperto(false) }}
              className={cn('flex min-h-[52px] w-full items-center border-b border-border px-4 text-left text-base font-medium last:border-b-0', o.k === valore && 'bg-[oklch(0.94_0.04_180)] dark:bg-[oklch(0.3_0.05_180)]')}>
              {o.l}
            </button>
          ))}
          {piede && <div onClick={() => setAperto(false)}>{piede}</div>}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/** Foglio modale: centrato su tablet, dal basso su telefono. */
export function Foglio({ aperto, esce, onChiudi, titolo, sotto, children, largo }: {
  aperto: boolean; esce: boolean; onChiudi: () => void; titolo: string; sotto?: string; children: React.ReactNode; largo?: boolean
}) {
  const tel = useTelefono()
  useEffect(() => {
    if (!aperto) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onChiudi() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [aperto, onChiudi])
  if (!aperto || typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[65]">
      <div onClick={onChiudi} className="absolute inset-0 transition-[background] duration-300" style={{ background: esce ? 'rgba(15,20,30,0)' : 'rgba(15,20,30,.22)' }} />
      <div className={cn('absolute flex max-h-[92dvh] flex-col overflow-hidden border border-border bg-card shadow-[0_20px_60px_rgba(20,30,50,.18)]',
        esce ? 'anim-swapout' : 'anim-swapin',
        tel ? 'inset-x-0 bottom-0 rounded-t-[20px] pb-[env(safe-area-inset-bottom)]' : cn('left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[14px]', largo ? 'w-[560px]' : 'w-[460px]'))}
        style={tel ? undefined : { translate: '-50% -50%', left: '50%', top: '50%' }}>
        <div className="flex flex-none items-center gap-3 border-b border-border px-5 py-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[17px] font-semibold">{titolo}</span>
            {sotto && <span className="text-[13px] text-muted-foreground">{sotto}</span>}
          </div>
          <button type="button" onClick={onChiudi} aria-label="Chiudi" className="-my-2 -mr-2.5 flex h-11 w-11 flex-none items-center justify-center rounded-full text-muted-foreground active:scale-[0.96]"><IconaX /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
      </div>
    </div>,
    document.body
  )
}

/** Data lunga con iniziale maiuscola: "Martedì 6 ottobre". */
const GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const GG = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
const dt = (d: string) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)))
export const dataLunga = (d: string) => { const x = dt(d); return `${GIORNI[x.getUTCDay()]} ${x.getUTCDate()} ${MESI[x.getUTCMonth()]}` }
export const dataBreve = (d: string) => { const x = dt(d); return `${GG[x.getUTCDay()]} ${x.getUTCDate()} ${MESI[x.getUTCMonth()].slice(0, 3)}` }
export const dataNum = (d: string) => `${+d.slice(8, 10)}/${+d.slice(5, 7)}`
export const meseNome = (m: string) => { const s = MESI[+m.slice(5, 7) - 1]; return s.charAt(0).toUpperCase() + s.slice(1) }
export const giornoSettimana = (d: string) => dt(d).getUTCDay()
export const piuGiorni = (d: string, n: number) => new Date(dt(d).getTime() + n * 864e5).toISOString().slice(0, 10)

/**
 * Pagina non scrollabile: occupa lo spazio del guscio sopra la barra in
 * basso; lo scroll è interno ai pannelli. Lo spazio in fondo lo fornisce
 * il guscio con --spazio-dock (ripiego: altezza del dock flottante).
 */
export function Contenitore({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-x-0 top-0 flex flex-col" style={{ bottom: 'var(--spazio-dock, calc(env(safe-area-inset-bottom) + 104px))' }}>
      {children}
    </div>
  )
}

/** Mese con frecce (MTCassa): "Ottobre 2026". */
export function NavMese({ mese, min, max, onCambia, className }: { mese: string; min: string; max: string; onCambia: (m: string) => void; className?: string }) {
  const sposta = (n: number) => { const [y, m] = mese.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7) }
  const p = sposta(-1), s = sposta(1), puoP = p >= min, puoS = s <= max
  return <SelettoreMese etichetta={`${meseNome(`${mese}-01`)} ${mese.slice(0, 4)}`} onPrec={() => onCambia(p)} onSucc={() => onCambia(s)} precOk={puoP} succOk={puoS} className={className} />
}

