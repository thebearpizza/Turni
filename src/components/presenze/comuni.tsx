'use client'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import type { AbsenceType } from '@/types'

// Pezzi condivisi dalle schede Presenze e Assenze del design (MTPresenze,
// MTAssenze): barra del mese, foglio modale (in alto su tablet, dal basso
// sul telefono), pulsante "Elimina" a due tocchi, avatar con le iniziali e
// i colori dei tipi di assenza.

export const TZ = 'Europe/Rome'
export const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
export const GG = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
export const GG_LUNGHI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']

// Telefono = viewport sotto i 640 px, come nel resto del design.
export function useTelefono(): boolean {
  return useSyncExternalStore(
    cb => { const mq = window.matchMedia('(max-width: 639px)'); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb) },
    () => window.matchMedia('(max-width: 639px)').matches,
    () => false,
  )
}

// Date come stringhe "yyyy-MM-dd" del calendario di Roma: l'aritmetica si fa
// in UTC a mezzogiorno, così l'ora legale non sposta mai il giorno.
export const daIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)) }
export const aIso = (d: Date) => d.toISOString().slice(0, 10)
export const piuGiorni = (s: string, n: number) => { const d = daIso(s); d.setUTCDate(d.getUTCDate() + n); return aIso(d) }
export const giorniTra = (a: string, b: string) => Math.round((daIso(b).getTime() - daIso(a).getTime()) / 864e5) + 1
export const etichettaMese = (mese: string) => { const [y, m] = mese.split('-').map(Number); return MESI[m - 1].replace(/^./, c => c.toUpperCase()) + ' ' + y }
export const spostaMese = (mese: string, n: number) => { const [y, m] = mese.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7) }
export const ultimoDelMese = (mese: string) => { const [y, m] = mese.split('-').map(Number); return `${mese}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }
/** "9 ottobre" */
export const dataBreve = (s: string) => { const d = daIso(s); return d.getUTCDate() + ' ' + MESI[d.getUTCMonth()] }
/** "Ven 9 ottobre" */
export const dataConGiorno = (s: string) => GG[daIso(s).getUTCDay()] + ' ' + dataBreve(s)
/** "Venerdì 9 ottobre" */
export const dataLunga = (s: string) => GG_LUNGHI[daIso(s).getUTCDay()] + ' ' + dataBreve(s)
export const iniziali = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 3).map(x => x[0]?.toUpperCase()).join('')

// Colori dei tipi di assenza (MTAssenze, TY): [etichetta, sfondo, bordo, testo].
export const TIPI: Record<AbsenceType, { l: string; bg: string; bd: string; fg: string; cls: string }> = {
  ferie: { l: 'Ferie', bg: 'oklch(0.93 0.04 290)', bd: 'oklch(0.8 0.07 290)', fg: 'oklch(0.4 0.1 290)', cls: 'dark:!bg-[oklch(0.32_0.05_290)] dark:!border-[oklch(0.45_0.07_290)] dark:!text-[oklch(0.85_0.07_290)]' },
  malattia: { l: 'Malattia', bg: 'oklch(0.93 0.035 250)', bd: 'oklch(0.8 0.06 250)', fg: 'oklch(0.38 0.08 250)', cls: 'dark:!bg-[oklch(0.32_0.04_250)] dark:!border-[oklch(0.45_0.06_250)] dark:!text-[oklch(0.85_0.06_250)]' },
  riposo: { l: 'Riposo', bg: 'oklch(0.93 0.04 25)', bd: 'oklch(0.82 0.07 25)', fg: 'oklch(0.45 0.1 25)', cls: 'dark:!bg-[oklch(0.32_0.05_25)] dark:!border-[oklch(0.45_0.07_25)] dark:!text-[oklch(0.85_0.07_25)]' },
  assenza_ingiustificata: { l: 'Ingiustificata', bg: 'oklch(0.9 0.02 250)', bd: 'oklch(0.7 0.02 250)', fg: 'oklch(0.3 0.01 250)', cls: 'dark:!bg-[oklch(0.3_0.01_250)] dark:!border-[oklch(0.45_0.01_250)] dark:!text-[oklch(0.85_0.01_250)]' },
}
export const ORDINE_TIPI: AbsenceType[] = ['ferie', 'malattia', 'riposo', 'assenza_ingiustificata']

export const FRECCIA_SX = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
export const FRECCIA_DX = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
export const ICONA_PIU = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M5 12h14" /><path d="M12 5v14" /></svg>
export const ICONA_X = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
export const ICONA_FOTO = (s: number) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>

/** Pulsante tondo 40×40 delle frecce del mese. */
export function FrecciaTonda({ dir, onClick, disabilitata }: { dir: 'sx' | 'dx'; onClick: () => void; disabilitata?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabilitata}
      aria-label={dir === 'sx' ? 'Mese precedente' : 'Mese successivo'}
      className={cn('flex h-10 w-10 flex-none items-center justify-center rounded-[20px] border border-[oklch(0.88_0.01_250)] bg-card active:scale-[0.96] dark:border-line-strong', disabilitata && 'opacity-30 active:scale-100')}
    >
      {dir === 'sx' ? FRECCIA_SX : FRECCIA_DX}
    </button>
  )
}

/** Barra del mese: ‹ Ottobre 2026 › (flessibile sul telefono, 132 px su tablet). */
export function BarraMese({ mese, onPrec, onSucc, succDisabilitato }: { mese: string; onPrec: () => void; onSucc: () => void; succDisabilitato?: boolean }) {
  return (
    <>
      <FrecciaTonda dir="sx" onClick={onPrec} />
      <span className="min-w-0 flex-[1_1_0] text-center text-[15px] font-semibold sm:min-w-[132px] sm:flex-none">{etichettaMese(mese)}</span>
      <FrecciaTonda dir="dx" onClick={onSucc} disabilitata={succDisabilitato} />
    </>
  )
}

/** Pulsante principale nero della barra (Aggiungi presenza / Nuova assenza). */
export function PulsanteNero({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex h-10 flex-none items-center gap-2 rounded-[8px] bg-primary px-4 text-sm font-semibold text-primary-foreground active:scale-[0.97]">
      {ICONA_PIU}{children}
    </button>
  )
}

export function Avatar({ nome, grande = true, className }: { nome: string; grande?: boolean; className?: string }) {
  return (
    <div className={cn('flex flex-none items-center justify-center rounded-full bg-[oklch(0.93_0.01_250)] text-[13px] font-semibold dark:bg-[oklch(0.28_0.01_250)]', grande ? 'h-10 w-10' : 'h-9 w-9', className)}>
      {iniziali(nome)}
    </div>
  )
}

export function BadgeTipo({ tipo, className }: { tipo: AbsenceType; className?: string }) {
  const T = TIPI[tipo]
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.05em]', T.cls, className)} style={{ background: T.bg, color: T.fg }}>
      {T.l}
    </span>
  )
}

/** Stato vuoto centrato delle liste. */
export function Vuoto({ titolo, testo }: { titolo: string; testo: string }) {
  return (
    <div className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center text-pretty">
      <span className="text-[15px] font-semibold">{titolo}</span>
      <span className="text-[13px] text-muted-foreground">{testo}</span>
    </div>
  )
}

// Durata di uscita delle animazioni del design (swapout).
export const USCITA = 320

/**
 * Foglio modale del design: su tablet una scheda di 580/600 px in alto
 * (padding 150/130 px), sul telefono un foglio dal basso a tutta
 * larghezza. Scrim e uscita con swapout di 320 ms.
 */
export function Foglio({ aperto, esce, onChiudi, titolo, larghezza, altoTablet, children, coda }: {
  aperto: boolean; esce: boolean; onChiudi: () => void; titolo: string
  larghezza: number; altoTablet: number; children: ReactNode; coda?: ReactNode
}) {
  const tel = useTelefono()
  // Il foglio va sopra intestazione e barra in basso del guscio: portale
  // sul body, montato solo nel browser.
  const montato = useSyncExternalStore(() => () => {}, () => true, () => false)
  if (!aperto || !montato) return null
  return createPortal(
    <div
      onClick={onChiudi}
      className={cn('fixed inset-0 z-[70] box-border flex justify-center transition-[background-color] duration-300', tel ? 'items-end pt-[72px]' : 'items-start')}
      style={{ background: esce ? 'rgba(15,20,30,0)' : 'rgba(15,20,30,.28)', paddingTop: tel ? undefined : altoTablet }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog" aria-label={titolo}
        className={cn('box-border flex max-h-full flex-col overflow-y-auto overscroll-contain border border-border bg-card shadow-[0_20px_60px_rgba(20,30,50,.18)]', tel ? 'w-full rounded-t-[20px] pb-[calc(20px+env(safe-area-inset-bottom))]' : 'rounded-[14px]', esce ? 'anim-swapout' : 'anim-swapin')}
        style={{ width: tel ? '100%' : `min(${larghezza}px, calc(100vw - 32px))`, maxHeight: tel ? '100%' : `calc(100dvh - ${altoTablet + 24}px)` }}
      >
        <div className="flex items-center gap-3 border-b border-border px-[22px] py-[18px]">
          <span className="flex-1 text-xl font-semibold">{titolo}</span>
          <button type="button" onClick={onChiudi} aria-label="Chiudi" className="flex h-11 w-11 items-center justify-center rounded-[22px] text-muted-foreground active:scale-[0.96]">{ICONA_X}</button>
        </div>
        <div className="flex flex-col gap-4 px-[22px] py-[18px]">{children}</div>
        {coda}
      </div>
    </div>,
    document.body,
  )
}

/** Gestisce apertura/uscita animata di un foglio: `chiudi()` aspetta lo swapout. */
export function useFoglio<T>() {
  const [dati, setDati] = useState<T | null>(null)
  const [esce, setEsce] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const apri = (d: T) => { if (timer.current) clearTimeout(timer.current); setEsce(false); setDati(d) }
  const chiudi = () => {
    setEsce(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { setDati(null); setEsce(false) }, USCITA)
  }
  return { dati, setDati, esce, apri, chiudi }
}

/** Etichetta di un campo del foglio (500 14px). */
export function Etichetta({ children }: { children: ReactNode }) {
  return <span className="text-sm font-medium">{children}</span>
}

/** Pillole per scegliere il dipendente (con il locale in piccolo). */
export function SceltaDipendente({ dipendenti, scelto, onScegli }: {
  dipendenti: { id: string; nome: string; locale: string }[]; scelto: string | null; onScegli: (id: string) => void
}) {
  return (
    <div className="flex max-h-[128px] flex-wrap gap-1.5 overflow-y-auto overscroll-contain">
      {dipendenti.map(e => {
        const on = e.id === scelto
        return (
          <button
            key={e.id} type="button" onClick={() => onScegli(e.id)}
            className={cn('flex h-[38px] items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium active:scale-[0.97]', on ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-card text-foreground dark:border-line-strong')}
          >
            {e.nome}<span className="text-[11px] font-normal opacity-70">{e.locale}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Riga dei tre pulsanti in fondo al foglio: [Elimina] Annulla Salva. */
export function PulsantiFoglio({ conElimina, confermaElimina, onElimina, onAnnulla, onSalva, etichettaSalva, salvaAttivo, occupato }: {
  conElimina: boolean; confermaElimina: boolean; onElimina: () => void; onAnnulla: () => void; onSalva: () => void
  etichettaSalva: string; salvaAttivo: boolean; occupato?: boolean
}) {
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: conElimina ? '1fr 1fr 2fr' : '1fr 2fr' }}>
      {conElimina && (
        // Eliminazione a due tocchi come nel design: il primo trasforma il
        // pulsante in "Conferma" rosso pieno, il secondo elimina.
        <button
          type="button" onClick={onElimina} disabled={occupato}
          className={cn('flex h-[52px] items-center justify-center rounded-[6px] border text-[15px] font-medium transition-[background-color,color] duration-200 active:scale-[0.98]',
            confermaElimina ? 'border-[oklch(0.55_0.15_25)] bg-[oklch(0.55_0.15_25)] text-white' : 'border-[oklch(0.85_0.05_25)] bg-transparent text-[oklch(0.45_0.1_25)] dark:border-[oklch(0.45_0.08_25)] dark:text-neg')}
        >
          {confermaElimina ? 'Conferma' : 'Elimina'}
        </button>
      )}
      <button type="button" onClick={onAnnulla} className="flex h-[52px] items-center justify-center rounded-[6px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">Annulla</button>
      <button
        type="button" onClick={onSalva} disabled={!salvaAttivo || occupato}
        className="flex h-[52px] items-center justify-center rounded-[6px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:active:scale-100"
        style={{ opacity: salvaAttivo && !occupato ? 1 : 0.4 }}
      >
        {etichettaSalva}
      </button>
    </div>
  )
}
