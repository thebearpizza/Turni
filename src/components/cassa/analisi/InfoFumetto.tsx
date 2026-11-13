'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { USCITA_MS } from './Sovrapposizioni'

// Piccola "i" con una spiegazione: col mouse si apre al passaggio, al tocco
// tenendo premuto e si chiude lasciando. Stesso aspetto e stesse
// animazioni dei fumetti di Analisi. Sta spesso dentro una riga toccabile:
// il tocco sulla "i" non arriva alla riga.

const ATTESA_TOCCO = 280

export function InfoFumetto({ titolo, testo, className }: { titolo: string; testo: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [ancora, setAncora] = useState<DOMRect | null>(null)
  const [esce, setEsce] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const uscita = useRef<ReturnType<typeof setTimeout> | null>(null)

  const apri = () => {
    if (uscita.current) clearTimeout(uscita.current)
    setEsce(false)
    if (ref.current) setAncora(ref.current.getBoundingClientRect())
  }
  const chiudi = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setEsce(true)
    if (uscita.current) clearTimeout(uscita.current)
    uscita.current = setTimeout(() => { setAncora(null); setEsce(false) }, USCITA_MS)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (uscita.current) clearTimeout(uscita.current) }, [])
  // Lo scroll della pagina sposterebbe la "i" sotto il fumetto: si chiude.
  useEffect(() => {
    if (!ancora || esce) return
    const via = () => chiudi()
    window.addEventListener('scroll', via, true)
    return () => window.removeEventListener('scroll', via, true)
  }, [ancora, esce])

  const ferma = (e: React.SyntheticEvent) => { e.stopPropagation() }
  return (
    <>
      <span
        ref={ref}
        role="img"
        aria-label={`${titolo}: ${testo}`}
        className={cn('inline-flex h-5 w-5 flex-none cursor-help touch-none select-none items-center justify-center rounded-full text-muted-foreground [-webkit-touch-callout:none] hover:text-foreground', className)}
        onPointerEnter={e => { if (e.pointerType === 'mouse') apri() }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') chiudi() }}
        onPointerDown={e => {
          e.stopPropagation()
          if (e.pointerType === 'mouse') return
          timer.current = setTimeout(apri, ATTESA_TOCCO)
        }}
        onPointerUp={e => { e.stopPropagation(); if (e.pointerType !== 'mouse') chiudi() }}
        onPointerCancel={() => chiudi()}
        onClick={ferma}
        onContextMenu={e => e.preventDefault()}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9.5" /><path d="M12 11v5.5" /><path d="M12 7.6v.1" strokeWidth="2.6" />
        </svg>
      </span>
      {ancora && typeof document !== 'undefined' && createPortal(<Corpo ancora={ancora} esce={esce} titolo={titolo} testo={testo} />, document.body)}
    </>
  )
}

function Corpo({ ancora, esce, titolo, testo }: { ancora: DOMRect; esce: boolean; titolo: string; testo: string }) {
  const vw = window.innerWidth
  const w = Math.min(280, vw - 24)
  const cx = ancora.left + ancora.width / 2
  const left = Math.max(12, Math.min(vw - 12 - w, cx - w / 2))
  // Sopra la "i" (il dito la copre da sotto), sotto se non c'è spazio.
  const sopra = ancora.top > 160
  const stile: React.CSSProperties = sopra ? { left, width: w, bottom: window.innerHeight - ancora.top + 8 } : { left, width: w, top: ancora.bottom + 8 }
  return (
    <div className="pointer-events-none fixed z-[84]" style={stile} role="tooltip">
      <div className={cn('flex flex-col gap-1 rounded-[14px] border border-border bg-card px-4 py-3 shadow-[0_14px_40px_rgba(20,30,50,.16)]', esce ? 'anim-swapout' : 'anim-swapin')}>
        <span className="text-[15px] font-semibold">{titolo}</span>
        <span className="text-[13px] leading-[1.45] text-muted-foreground">{testo}</span>
      </div>
    </div>
  )
}
