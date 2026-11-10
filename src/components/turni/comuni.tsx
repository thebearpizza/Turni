'use client'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { useTelefono, daIso, piuGiorni, MESI } from '@/components/presenze/comuni'
import type { Turn } from '@/types'

// Pezzi condivisi della sezione Turni (MTTurni.dc.html, ModificaTurno.dc.html,
// Capo Servizio.dc.html): orari in minuti, settimana da lunedì, rotella
// ancorata con chiusura al tocco fuori, fogli modali e controlli segmentati.

export { useTelefono, daIso, piuGiorni, MESI }

export const TZ = 'Europe/Rome'
export const WD = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
export const WDL = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']
export const USCITA = 320

// Ordine dei reparti del design (REP): sala, pizzeria, bar, cucina; i reparti
// sconosciuti in ordine alfabetico dopo, chi non ne ha per ultimo.
const ORDINE_REPARTI = ['sala', 'pizzeria', 'bar', 'cucina']
export function pesoReparto(d: string | null): number {
  if (!d) return 999
  const i = ORDINE_REPARTI.indexOf(d.toLowerCase())
  return i === -1 ? 100 : i
}

/** Minuti → "HH:MM" (modulo 24 ore: 25:30 è l'01:30 dello stesso turno). */
export const hm = (m: number) => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') }
/** "HH:MM[:SS]" → minuti dalla mezzanotte. */
export const toM = (s: string) => { const [h, m] = String(s).split(':').map(Number); return ((h || 0) % 24) * 60 + (m || 0) }
/** Durata di una fascia: fine ≤ inizio vuol dire oltre mezzanotte, stesso giorno lavorativo. */
export const durata = (a: string, b: string) => { let x = toM(b) - toM(a); if (x <= 0) x += 1440; return x }
export const durataTurno = (t: Pick<Turn, 'start_time' | 'end_time' | 'is_rest_day'>) => t.is_rest_day ? 0 : durata(t.start_time, t.end_time)
/** "38h" / "38h 30" del monte ore del design. */
export const ore = (m: number) => Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') : '')
/** "Giulia R." come nelle righe del telefono. */
export const nomeBreve = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p.slice(1).join(' ').charAt(0)}.` : p[0] ?? '' }

/** Lunedì (yyyy-MM-dd) della settimana che contiene il giorno dato. */
export function lunediDi(iso: string): string {
  const g = (daIso(iso).getUTCDay() + 6) % 7
  return piuGiorni(iso, -g)
}
export const giorniSettimana = (lun: string) => Array.from({ length: 7 }, (_, i) => piuGiorni(lun, i))
export const numeroGiorno = (iso: string) => daIso(iso).getUTCDate()
/** Indice 0=lunedì … 6=domenica. */
export const indiceGiorno = (iso: string) => (daIso(iso).getUTCDay() + 6) % 7
/** "Venerdì 16 ottobre" */
export const giornoLungo = (iso: string) => WDL[indiceGiorno(iso)] + ' ' + numeroGiorno(iso) + ' ' + MESI[daIso(iso).getUTCMonth()]
/** "12 – 18 ottobre" come nella barra della settimana. */
export const etichettaSettimana = (lun: string) => { const fine = piuGiorni(lun, 6); return numeroGiorno(lun) + ' – ' + numeroGiorno(fine) + ' ' + MESI[daIso(fine).getUTCMonth()] }
/** "12–18 ottobre" del sottotitolo e dei fogli. */
export const etichettaSettimanaStretta = (lun: string) => etichettaSettimana(lun).replace(' – ', '–')
/** "5 – 11 ott" del capo servizio. */
export const etichettaSettimanaBreve = (lun: string) => { const fine = piuGiorni(lun, 6); return numeroGiorno(lun) + ' – ' + numeroGiorno(fine) + ' ' + MESI[daIso(fine).getUTCMonth()].slice(0, 3) }

// ── Icone del design (SVG copiati dal file) ─────────────────────────────
export const ICONA_PIU = (s = 16, w = 2.2) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" aria-hidden><path d="M5 12h14" /><path d="M12 5v14" /></svg>
export const ICONA_X = (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
export const ICONA_FISSI = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></svg>
export const ICONA_PERSONA = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
// Copia settimana e Genera con IA non sono nel prototipo: icone a tratto
// con lo stesso spessore delle altre della barra.
export const ICONA_COPIA = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="8" y="8" width="13" height="13" rx="2.5" /><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8" /></svg>
export const ICONA_IA = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>

// ── Rotella ancorata ────────────────────────────────────────────────────
/**
 * Una sola rotella aperta alla volta (chiave del campo). Aprirne un'altra
 * fa uscire la prima (swapout 320 ms) e poi entrare la nuova; un tocco
 * fuori da [data-kp] la chiude mantenendo il valore.
 */
export function useRotella() {
  const [k, setK] = useState<string | null>(null)
  const [esce, setEsce] = useState(false)
  const kRef = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const off = useRef<(() => void) | null>(null)

  const chiudi = useCallback(() => {
    if (!kRef.current) return
    kRef.current = null
    setEsce(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { setK(null); setEsce(false) }, USCITA)
    off.current?.(); off.current = null
  }, [])

  const apri = useCallback((key: string) => {
    if (kRef.current === key) return
    const prima = kRef.current
    kRef.current = key
    if (timer.current) clearTimeout(timer.current)
    if (prima) {
      setEsce(true)
      timer.current = setTimeout(() => { setK(key); setEsce(false) }, USCITA)
    } else { setK(key); setEsce(false) }
    if (off.current) return
    const h = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('[data-kp]')) chiudi() }
    const t = setTimeout(() => window.addEventListener('pointerdown', h, true), 0)
    off.current = () => { clearTimeout(t); window.removeEventListener('pointerdown', h, true) }
  }, [chiudi])

  // Chiusura immediata, senza animazione (cambio di modalità del foglio).
  const azzera = useCallback(() => {
    kRef.current = null
    if (timer.current) clearTimeout(timer.current)
    off.current?.(); off.current = null
    setK(null); setEsce(false)
  }, [])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); off.current?.() }, [])
  return { k, esce, apri, chiudi, azzera, anim: esce ? 'anim-swapout' : 'anim-swapin' }
}

/** Bordo dei campi: teal 1,5 px quando la rotella del campo è aperta. */
export const bordoCampo = (attivo: boolean) => attivo
  ? 'border-[1.5px] border-[oklch(0.58_0.12_180)]'
  : 'border border-line-strong'

// ── Fogli ───────────────────────────────────────────────────────────────
function useMontato() { return useSyncExternalStore(() => () => {}, () => true, () => false) }

/**
 * Velo del design (scrim rgba(15,20,30,.28), 320 ms): su tablet il
 * contenuto in alto a `altoTablet` px, sul telefono un foglio dal basso.
 * Portale sul body perché copre intestazione e barra del guscio.
 */
export function Velo({ aperto, esce, onChiudi, altoTablet, children }: {
  aperto: boolean; esce: boolean; onChiudi: () => void; altoTablet: number; children: ReactNode
}) {
  const tel = useTelefono()
  const montato = useMontato()
  if (!aperto || !montato) return null
  return createPortal(
    <div
      onClick={onChiudi}
      className={cn('fixed inset-0 z-[70] box-border flex justify-center transition-[background-color] duration-300', tel ? 'items-end pt-[72px]' : 'items-start px-4')}
      style={{ background: esce ? 'rgba(15,20,30,0)' : 'rgba(15,20,30,.28)', paddingTop: tel ? undefined : altoTablet }}
    >
      {children}
    </div>,
    document.body,
  )
}

/** Foglio con titolo e sottotitolo (Nuovo turno, Turni fissi, IA). */
export function FoglioTurni({ aperto, esce, onChiudi, titolo, sotto, larghezza = 600, altoTablet = 160, children }: {
  aperto: boolean; esce: boolean; onChiudi: () => void; titolo: string; sotto?: string
  larghezza?: number; altoTablet?: number; children: ReactNode
}) {
  const tel = useTelefono()
  return (
    <Velo aperto={aperto} esce={esce} onChiudi={onChiudi} altoTablet={altoTablet}>
      <div
        onClick={e => e.stopPropagation()}
        role="dialog" aria-label={titolo}
        className={cn('box-border flex max-h-full flex-col overflow-y-auto overscroll-contain border border-border bg-card shadow-[0_20px_60px_rgba(20,30,50,.18)]',
          tel ? 'w-full rounded-t-[20px] pb-[calc(20px+env(safe-area-inset-bottom))]' : 'rounded-[14px]', esce ? 'anim-swapout' : 'anim-swapin')}
        style={{ width: tel ? '100%' : `min(${larghezza}px, 100%)`, maxHeight: tel ? '100%' : `calc(100dvh - ${altoTablet + 24}px)` }}
      >
        <div className="flex items-center gap-3 border-b border-border px-[22px] py-[18px]">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-xl font-semibold">{titolo}</span>
            {sotto && <span className="text-[13px] text-muted-foreground">{sotto}</span>}
          </div>
          <button type="button" onClick={onChiudi} aria-label="Chiudi" className="flex h-11 w-11 flex-none items-center justify-center rounded-[22px] text-muted-foreground active:scale-[0.96]">{ICONA_X(20)}</button>
        </div>
        <div className="flex flex-col gap-4 px-[22px] py-[18px]">{children}</div>
      </div>
    </Velo>
  )
}

/** Apertura e uscita animata di un foglio: `chiudi()` aspetta lo swapout. */
export function useApertura<T>() {
  const [dati, setDati] = useState<T | null>(null)
  const [esce, setEsce] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const apri = useCallback((d: T) => { if (timer.current) clearTimeout(timer.current); setEsce(false); setDati(d) }, [])
  const chiudi = useCallback(() => {
    setEsce(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { setDati(null); setEsce(false) }, USCITA)
  }, [])
  return { dati, setDati, esce, apri, chiudi }
}

// ── Controlli ───────────────────────────────────────────────────────────
/** Controllo segmentato del design (fondo 0.93, voce attiva bianca con ombra). */
export function Segmento<K extends string | number | boolean>({ voci, valore, onCambia, alto = 38, className, voceCls }: {
  voci: { k: K; l: string }[]; valore: K; onCambia: (k: K) => void; alto?: number; className?: string; voceCls?: string
}) {
  return (
    <div className={cn('flex gap-0.5 rounded-[9px] bg-[oklch(0.93_0.01_250)] p-[3px] dark:bg-[oklch(0.26_0.01_250)]', className)}>
      {voci.map(v => {
        const on = v.k === valore
        return (
          <button
            key={String(v.k)} type="button" onClick={() => onCambia(v.k)}
            className={cn('flex flex-1 items-center justify-center rounded-[7px] text-[13px] font-semibold transition-[background-color] duration-200',
              on ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-muted-foreground', voceCls)}
            style={{ height: alto }}
          >
            {v.l}
          </button>
        )
      })}
    </div>
  )
}

/** Pillola a scelta (dipendente, ripetizione, settimane): attiva su ink. */
export function Pillola({ attiva, onClick, children, className }: { attiva: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button" onClick={onClick}
      className={cn('flex h-[38px] flex-none items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium active:scale-[0.97]',
        attiva ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-card text-foreground dark:border-line-strong', className)}
    >
      {children}
    </button>
  )
}

/** Pulsanti in fondo ai fogli: Annulla (1fr) e azione principale (2fr). */
export function PulsantiFine({ onAnnulla, onConferma, etichetta, attivo, occupato }: {
  onAnnulla: () => void; onConferma: () => void; etichetta: string; attivo: boolean; occupato?: boolean
}) {
  return (
    <div className="grid grid-cols-[1fr_2fr] gap-2.5">
      <button type="button" onClick={onAnnulla} className="flex h-[52px] items-center justify-center rounded-[6px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">Annulla</button>
      <button
        type="button" onClick={onConferma} disabled={!attivo || occupato}
        className="flex h-[52px] items-center justify-center rounded-[6px] bg-primary text-[15px] font-semibold text-primary-foreground transition-opacity duration-200 active:scale-[0.98] disabled:active:scale-100"
        style={{ opacity: attivo && !occupato ? 1 : 0.4 }}
      >
        {etichetta}
      </button>
    </div>
  )
}
