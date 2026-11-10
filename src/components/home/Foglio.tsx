'use client'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

// Fogli delle Home (MTHome: dettaglio della chiusura sul telefono;
// Direttore v2: richieste e timbratura con foto): velo che sfuma in 320 ms
// e pannello che entra con swapin ed esce con swapout, come nel prototipo.

/** Stato di un foglio: il valore resta montato durante l'uscita (320 ms). */
export function useFoglio<T>(iniziale: T | null = null) {
  const [valore, setValore] = useState<T | null>(iniziale)
  const [uscita, setUscita] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apri = useCallback((v: T) => {
    if (timer.current) clearTimeout(timer.current)
    setUscita(false)
    setValore(v)
  }, [])
  const chiudi = useCallback(() => {
    setUscita(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { setValore(null); setUscita(false) }, 320)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return { valore, uscita, apri, chiudi }
}

export function Foglio({ uscita, onChiudi, etichetta, className, children }: {
  uscita: boolean
  onChiudi: () => void
  etichetta: string
  /** Classi del pannello: posizione e forma (in basso sul telefono, al centro sul tablet). */
  className?: string
  children: React.ReactNode
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onChiudi() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onChiudi])

  // Il portale esiste solo nel browser: sul server (rotta dell'assistente
  // aperta direttamente) il foglio compare all'idratazione.
  const client = useSyncExternalStore(() => () => {}, () => true, () => false)
  if (!client) return null
  return createPortal(
    <div
      onClick={onChiudi}
      className={cn('fixed inset-0 z-[80] flex transition-[background-color] duration-[320ms]', uscita ? 'bg-[rgba(15,20,30,0)]' : 'bg-[rgba(15,20,30,.28)]')}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={etichetta}
        onClick={e => e.stopPropagation()}
        className={cn('flex flex-col overflow-y-auto overscroll-contain border border-border bg-card shadow-[0_20px_60px_rgba(20,30,50,.18)]', uscita ? 'anim-swapout' : 'anim-swapin', className)}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

export const IconaChiudi = ({ s = 20 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
)
