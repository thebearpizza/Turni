'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

// Filtri secondari sul telefono (reparto, tipologia...): un solo pulsante
// "Filtri" che apre un foglio dal basso, invece di una riga di pillole
// sempre aperta che toglie spazio alla lista. Sul tablet le pagine tengono
// le pillole in riga: questo componente è solo per il telefono.

export interface GruppoFiltri {
  titolo: string
  opzioni: { k: string; l: string }[]
  /** Chiave scelta, o null per "tutti". */
  valore: string | null
  onCambia: (k: string | null) => void
  /** Etichetta della scelta "tutti" (predefinita: "Tutti"). */
  tutti?: string
}

export function FiltriFoglio({ gruppi, className }: { gruppi: GruppoFiltri[]; className?: string }) {
  const [stato, setStato] = useState<'chiuso' | 'aperto' | 'esce'>('chiuso')
  const chiudi = () => { setStato('esce'); setTimeout(() => setStato('chiuso'), 320) }
  useEffect(() => {
    if (stato !== 'aperto') return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setStato('esce'); setTimeout(() => setStato('chiuso'), 320) } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [stato])
  const attivi = gruppi.filter(g => g.valore !== null)
  const riassunto = attivi.map(g => g.opzioni.find(o => o.k === g.valore)?.l).filter(Boolean).join(' · ')
  const pill = (on: boolean) => cn('flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors duration-200 active:scale-[0.97]', on ? 'border-primary bg-primary text-primary-foreground' : 'border-line-strong bg-card text-foreground')

  return (
    <>
      <button type="button" data-sk-keep="" onClick={() => setStato('aperto')} aria-haspopup="dialog"
        className={cn('flex h-11 min-w-0 flex-none items-center gap-2 rounded-[10px] border px-3.5 text-sm font-medium active:scale-[0.97]', attivi.length ? 'border-primary bg-primary text-primary-foreground' : 'border-line-strong bg-card', className)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="flex-none"><path d="M4 7h16" /><path d="M7 12h10" /><path d="M10 17h4" /></svg>
        <span className="truncate">{riassunto || 'Filtri'}</span>
      </button>
      {stato !== 'chiuso' && typeof document !== 'undefined' && createPortal(
        <div onClick={chiudi} className="fixed inset-0 z-[70] flex items-end transition-[background-color] duration-300" style={{ background: stato === 'esce' ? 'rgba(15,20,30,0)' : 'rgba(15,20,30,.28)' }}>
          <div role="dialog" aria-modal="true" aria-label="Filtri" onClick={e => e.stopPropagation()}
            className={cn('flex max-h-[80dvh] w-full flex-col gap-4 overflow-y-auto overscroll-contain rounded-t-[20px] border border-border bg-card px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-4 shadow-[0_20px_60px_rgba(20,30,50,.18)]', stato === 'esce' ? 'anim-swapout' : 'anim-swapin')}>
            <div className="flex items-center justify-between">
              <span className="text-[17px] font-semibold">Filtri</span>
              {attivi.length > 0 && <button type="button" onClick={() => gruppi.forEach(g => g.onCambia(null))} className="flex h-11 items-center px-2 text-sm font-medium text-muted-foreground active:scale-[0.97]">Azzera</button>}
            </div>
            {gruppi.map(g => (
              <div key={g.titolo} className="flex flex-col gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">{g.titolo}</span>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => g.onCambia(null)} className={pill(g.valore === null)}>{g.tutti ?? 'Tutti'}</button>
                  {g.opzioni.map(o => <button key={o.k} type="button" onClick={() => g.onCambia(g.valore === o.k ? null : o.k)} className={pill(g.valore === o.k)}>{o.l}</button>)}
                </div>
              </div>
            ))}
            <button type="button" onClick={chiudi} className="flex h-[52px] flex-none items-center justify-center rounded-[12px] bg-primary text-[15px] font-medium text-primary-foreground active:scale-[0.98]">Mostra risultati</button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
