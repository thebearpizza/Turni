'use client'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

// Foglio del design (MTAssenze, "Nuova assenza"): sul telefono sale dal
// basso a tutta larghezza con gli angoli alti a 20 px; da tablet è un
// riquadro di 600 px in alto, raggio 14. Velo rgba(15,20,30,.28) che
// sfuma in 320 ms all'uscita, contenuto con swapin 680 / swapout 320.
// Montato in un portale su <body>: i contenitori animati con filter
// (swapin) diventerebbero il riferimento dei figli position:fixed.

const nessunaIscrizione = () => () => {}

interface Props {
  titolo: string
  onClose: () => void
  children: (chiudi: () => void) => React.ReactNode
  className?: string
}

export function Foglio({ titolo, onClose, children, className }: Props) {
  const [uscita, setUscita] = useState(false)
  const chiudi = useCallback(() => setUscita(true), [])

  // Dopo lo swapout (320 ms) il foglio si smonta davvero. onClose in un
  // ref: i chiamanti la passano inline e un nuovo render (es. l'orologio
  // della Home ogni secondo) non deve far ripartire l'attesa.
  const suChiusura = useRef(onClose)
  useEffect(() => { suChiusura.current = onClose }, [onClose])
  useEffect(() => {
    if (!uscita) return
    const t = setTimeout(() => suChiusura.current(), 320)
    return () => clearTimeout(t)
  }, [uscita])

  useEffect(() => {
    const prima = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') chiudi() }
    window.addEventListener('keydown', esc)
    return () => {
      document.body.style.overflow = prima
      window.removeEventListener('keydown', esc)
    }
  }, [chiudi])

  // Il portale esiste solo nel browser (il foglio può essere aperto già
  // al primo render, es. /home?bacheca=1).
  const nelBrowser = useSyncExternalStore(nessunaIscrizione, () => true, () => false)
  if (!nelBrowser) return null

  return createPortal(
    <div
      onClick={chiudi}
      className="fixed inset-0 z-[70] box-border flex items-end justify-center pt-[72px] transition-[background-color] duration-[320ms] sm:items-start sm:pt-[130px]"
      style={{ backgroundColor: uscita ? 'rgba(15,20,30,0)' : 'rgba(15,20,30,.28)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titolo}
        onClick={e => e.stopPropagation()}
        className={cn(
          'box-border flex max-h-full w-full flex-col overflow-y-auto overscroll-contain rounded-t-[20px] border border-border bg-card pb-[calc(20px+env(safe-area-inset-bottom))] shadow-[0_20px_60px_rgba(20,30,50,.18)] sm:max-h-[calc(100%-24px)] sm:w-[600px] sm:rounded-[14px] sm:pb-0',
          uscita ? 'anim-swapout' : 'anim-swapin',
          className
        )}
      >
        <div className="sticky top-0 z-[1] flex flex-none items-center gap-3 border-b border-border bg-card px-[22px] py-[18px]">
          <span className="flex-1 text-xl font-semibold">{titolo}</span>
          <button
            type="button"
            onClick={chiudi}
            aria-label="Chiudi"
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground active:scale-[0.96]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
          </button>
        </div>
        {children(chiudi)}
      </div>
    </div>,
    document.body
  )
}
