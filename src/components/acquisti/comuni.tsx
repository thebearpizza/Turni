'use client'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import type { ArticoloTipologia } from '@/types'

// Pezzi comuni delle quattro sezioni di Acquisti (MTAcquisti.dc.html):
// formati, badge, colori di tipologia, icone e il foglio modale del design.

export const TZ = 'Europe/Rome'
export const USCITA_MS = 320
export const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
export const MESI_LUNGHI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

export interface Locale { id: string; nome: string; colore: string }
export const localiDa = (rs: { id: string; name: string }[]): Locale[] => rs.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) }))

/** "€ 1.234,50" con lo spazio indivisibile del prototipo. */
export const eu = (v: number, d = 2) => '€ ' + Math.abs(v).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' } as Intl.NumberFormatOptions)
export const euSegno = (v: number, d = 2) => (v < 0 ? '−' : '') + eu(v, d)
/** Numero senza simbolo (quantità, giacenze): fino a 3 decimali. */
export const nf = (v: number, d = 3) => v.toLocaleString('it-IT', { maximumFractionDigits: d, useGrouping: 'always' } as Intl.NumberFormatOptions)
export const n2 = (v: number) => v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** "12 ott" da una data yyyy-MM-dd. */
export const dataBreve = (s: string) => { const [, m, d] = s.split('-').map(Number); return `${d} ${MESI_BREVI[m - 1]}` }
export const dataLunga = (s: string) => `${dataBreve(s)} ${s.slice(0, 4)}`
export const dataNumerica = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }
export const etichettaMese = (mese: string) => { const [y, m] = mese.split('-').map(Number); return `${MESI_LUNGHI[m - 1]} ${y}` }
export const spostaMese = (mese: string, n: number) => { const [y, m] = mese.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7) }
export const fineMese = (mese: string) => { const [y, m] = mese.split('-').map(Number); return `${mese}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }
export const arrotonda2 = (v: number) => Math.round(v * 100) / 100

// Toni dei badge del design.
export type Tono = 'ok' | 'warn' | 'neg' | 'neu'
export const BADGE: Record<Tono, string> = {
  ok: 'bg-ok-tint text-ok',
  warn: 'bg-warn-tint text-warn',
  neg: 'bg-neg-tint text-neg',
  neu: 'bg-[oklch(0.93_0.01_250)] text-muted-foreground dark:bg-secondary',
}
export const TESTO: Record<Tono, string> = { ok: 'text-ok', warn: 'text-warn', neg: 'text-neg', neu: 'text-muted-foreground' }

export function Badge({ tono, children, className }: { tono: Tono; children: ReactNode; className?: string }) {
  return (
    <span className={cn('whitespace-nowrap rounded-full px-[9px] py-[3px] text-[10px] font-semibold uppercase tracking-[.05em]', BADGE[tono], className)}>{children}</span>
  )
}

// Tipologie del catalogo: etichetta e colore del quadratino (TIP del prototipo).
export const TIPOLOGIE: Record<ArticoloTipologia, { l: string; c: string }> = {
  food: { l: 'Food', c: 'oklch(0.58 0.12 180)' },
  beverage: { l: 'Beverage', c: 'oklch(0.6 0.11 250)' },
  detergenza: { l: 'Detergenza', c: 'oklch(0.72 0.12 75)' },
  altro_no_food: { l: 'Altro no food', c: 'oklch(0.62 0.12 330)' },
}
export const ORDINE_TIPOLOGIE: ArticoloTipologia[] = ['food', 'beverage', 'detergenza', 'altro_no_food']

export const ALIQUOTE = [0, 4, 5, 10, 22]

// ── Icone del design (sempre SVG, mai glifi) ────────────────────────────
export const IcoX = ({ s = 20 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
export const IcoPiu = ({ s = 16 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M5 12h14" /><path d="M12 5v14" /></svg>
export const IcoSx = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
export const IcoDx = ({ s = 16, className }: { s?: number; className?: string }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden><path d="M9 6l6 6-6 6" /></svg>
export const IcoGiu = ({ s = 14, className, style }: { s?: number; className?: string; style?: React.CSSProperties }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden><path d="M6 9l6 6 6-6" /></svg>
export const IcoMatita = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-muted-foreground" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>
export const IcoScan = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 8V6a2 2 0 0 1 2-2h2" /><path d="M16 4h2a2 2 0 0 1 2 2v2" /><path d="M20 16v2a2 2 0 0 1-2 2h-2" /><path d="M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M8 12h8" /></svg>
export const IcoAvviso = () => <svg width="16" height="16" viewBox="0 0 16 16" className="mt-px flex-none" aria-hidden><path d="M8 1.8L15 14H1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M8 6.2v3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="8" cy="11.9" r="0.9" fill="currentColor" /></svg>
export const IcoErrore = () => (
  <span className="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full bg-neg">
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>
  </span>
)

/** Montato nel browser (i portali sul body servono solo lì). */
export function useMontato() {
  return useSyncExternalStore(() => () => {}, () => true, () => false)
}

/** Apertura/uscita animata (swapout di 320 ms prima di smontare). */
export function useUscita<T>() {
  // Un solo stato con un numero di apertura: un'uscita in ritardo non
  // chiude un foglio riaperto nel frattempo.
  const [s, setS] = useState<{ dati: T | null; esce: boolean; n: number }>({ dati: null, esce: false, n: 0 })
  const apri = (d: T) => setS(x => ({ dati: d, esce: false, n: x.n + 1 }))
  const setDati = (f: (d: T | null) => T | null) => setS(x => ({ ...x, dati: f(x.dati) }))
  const chiudi = (dopo?: () => void) => {
    let n = -1
    setS(x => { n = x.n; return { ...x, esce: true } })
    setTimeout(() => { setS(x => (x.n === n && x.esce ? { dati: null, esce: false, n: x.n } : x)); dopo?.() }, USCITA_MS)
  }
  return { dati: s.dati, esce: s.esce, apri, chiudi, setDati }
}

/** Piede dei fogli: Annulla e l'azione principale. */
export function PiedeModale({ tel, onAnnulla, onOk, etichetta, pericolo, disabilitato }: { tel: boolean; onAnnulla: () => void; onOk: () => void; etichetta: string; pericolo?: boolean; disabilitato?: boolean }) {
  return (
    <div className={cn('grid flex-none grid-cols-[1fr_1.6fr] gap-2.5 border-t border-border py-3', tel ? 'px-4' : 'px-[22px]')}>
      <Bottone onClick={onAnnulla}>Annulla</Bottone>
      <Bottone tipo={pericolo ? 'pericoloPieno' : 'primario'} disabled={disabilitato} onClick={onOk}>{etichetta}</Bottone>
    </div>
  )
}

/**
 * Foglio modale di MTAcquisti (Nuova fattura, Scansiona fattura, Importa
 * XML): sul tablet una scheda di 600 px a 130 px dall'alto, sul telefono un
 * foglio dal basso a tutta larghezza. Scrim .28, uscita swapout 320 ms.
 */
export function Modale({ tel, esce, onChiudi, titolo, sotto, children, larghezza = 600, piede }: {
  tel: boolean; esce: boolean; onChiudi: () => void; titolo: string; sotto?: string
  children: ReactNode; larghezza?: number; piede?: ReactNode
}) {
  const montato = useMontato()
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onChiudi() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onChiudi])
  if (!montato) return null
  return createPortal(
    <div
      onClick={onChiudi}
      className={cn('fixed inset-0 z-[70] box-border flex justify-center transition-[background-color] duration-300', tel ? 'items-end pt-[72px]' : 'items-start px-4 pb-6 pt-[130px]')}
      style={{ background: esce ? 'rgba(15,20,30,0)' : 'rgba(15,20,30,.28)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog" aria-label={titolo}
        className={cn('relative box-border flex max-h-full flex-col overflow-y-auto overscroll-contain border border-border bg-card shadow-[0_20px_60px_rgba(20,30,50,.18)]',
          tel ? 'w-full rounded-t-[20px] pb-[calc(20px+env(safe-area-inset-bottom))]' : 'rounded-[14px]', esce ? 'anim-swapout' : 'anim-swapin')}
        style={{ width: tel ? '100%' : larghezza, maxWidth: '100%' }}
      >
        <div className={cn('flex flex-none items-center gap-3 border-b border-border py-4', tel ? 'px-4' : 'px-[22px]')}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-xl font-semibold">{titolo}</span>
            {sotto && <span className="text-sm text-muted-foreground">{sotto}</span>}
          </div>
          <button type="button" onClick={onChiudi} aria-label="Chiudi" className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-muted-foreground active:scale-[0.96]"><IcoX /></button>
        </div>
        {children}
        {piede}
      </div>
    </div>,
    document.body,
  )
}

/** Pulsante a tutta cella del design (52 px, raggio 8). */
export function Bottone({ onClick, children, tipo = 'secondario', disabled, className, alto = 52 }: {
  onClick?: () => void; children: ReactNode; tipo?: 'primario' | 'secondario' | 'pericolo' | 'pericoloPieno'; disabled?: boolean; className?: string; alto?: number
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      style={{ height: alto }}
      className={cn('flex items-center justify-center gap-2 rounded-[8px] border px-3 text-[15px] transition-[background-color,transform] duration-200 active:scale-[0.98] disabled:pointer-events-none',
        tipo === 'primario' && 'border-primary bg-primary font-semibold text-primary-foreground disabled:border-[oklch(0.85_0.01_250)] disabled:bg-[oklch(0.85_0.01_250)] disabled:text-[oklch(0.5_0.01_250)]',
        tipo === 'secondario' && 'border-line-strong bg-card font-medium disabled:opacity-50',
        tipo === 'pericolo' && 'border-line-strong bg-transparent font-semibold text-neg disabled:opacity-50',
        tipo === 'pericoloPieno' && 'border-neg bg-neg font-semibold text-white disabled:opacity-50 dark:text-background',
        className)}
    >
      {children}
    </button>
  )
}

/** Ottieni il chiudi-al-tocco-fuori per un tastierino ancorato. */
export function useToccoFuori(attivo: boolean, selettore: string, chiudi: () => void) {
  useEffect(() => {
    if (!attivo) return
    const h = (e: PointerEvent) => { if (!(e.target as Element).closest?.(selettore)) chiudi() }
    const id = setTimeout(() => window.addEventListener('pointerdown', h, true), 0)
    return () => { clearTimeout(id); window.removeEventListener('pointerdown', h, true) }
  }, [attivo, selettore, chiudi])
}

/** Buffer del tastierino: "1240,5" → 1240.5 (null se vuoto). */
export function numeroDa(b: string): number | null {
  if (b === '' || b === ',') return null
  const n = parseFloat(b.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
/** Regola di digitazione del prototipo: virgola unica, max 2 (o 3) decimali, max 7 cifre. */
export function digita(prev: string, k: string, decimali = 2): string {
  let v = prev
  if (k === 'del') return v.slice(0, -1)
  if (k === ',') { if (decimali === 0 || v.includes(',')) return v; return (v || '0') + ',' }
  if (v.replace(',', '').length >= 7) return v
  if (v.includes(',') && v.split(',')[1].length >= decimali) return v
  v = v === '0' ? k : v + k
  return v
}
