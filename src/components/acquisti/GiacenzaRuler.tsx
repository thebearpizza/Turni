'use client'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// Rotella in stile timer iOS (Dynamic Island): tacche che seguono il
// dito 1:1 come una vera rotella fisica, non un righello che scatta a
// unità intere. Trascinare a sinistra aumenta il valore, a destra lo
// diminuisce (la rotella "gira" verso i numeri più alti che stanno più
// a destra sulla riga — lo stesso verso di uno scorrimento nativo).
//
// Per restare fluida (niente scatti), la posizione durante il
// trascinamento è scritta DIRETTAMENTE sul nodo DOM via ref (un
// translateX continuo, non arrotondato) invece che tramite stato React
// — un nuovo render/reconciliation ad ogni pixel di movimento è
// esattamente la causa più comune di scatti in un drag React, stesso
// principio già usato per il foglio di navigazione (DockNav). Il
// valore arrotondato (per il numero grande e la vibrazione) si
// aggiorna solo quando supera una soglia intera.
//
// Nota: niente vero feedback aptico su iPhone — Safari non ha mai
// implementato la Vibration API (solo le app native possono vibrare).
// navigator.vibrate() qui sotto è quindi un no-op silenzioso su iOS,
// ma funziona su Android/Chrome: costa nulla lasciarlo.
const PX_PER_UNIT = 18
const MAJOR_EVERY = 5
const HALF_RANGE = 90 // ampio abbastanza da coprire un trascinamento lungo senza dover ridisegnare le tacche a metà gesto

interface Props {
  value: number
  unit?: string | null
  min?: number
  max?: number
  onCommit: (value: number) => void
}

// Nessun tetto artificiale: una giacenza reale non ha un massimo
// sensato da indovinare. Il solo limite vero è 0 in basso (non esiste
// una giacenza negativa) — la rotella scorre "all'infinito" verso l'alto.
export function GiacenzaRuler({ value, unit, min = 0, max = Infinity, onCommit }: Props) {
  const [dragging, setDragging] = useState(false)
  const [renderCenter, setRenderCenter] = useState(value)
  const stripRef = useRef<HTMLDivElement>(null)
  const numberRef = useRef<HTMLSpanElement>(null)
  const drag = useRef<{ startX: number; startValue: number; lastValue: number } | null>(null)
  const pendingDx = useRef<number | null>(null)
  const rafId = useRef(0)

  // Da ferma, la rotella resta centrata sul valore corrente (dopo un
  // commit, o un aggiornamento realtime da un altro dispositivo).
  useEffect(() => {
    if (!dragging) setRenderCenter(value)
  }, [value, dragging])

  function vibra() {
    try { navigator.vibrate?.(3) } catch { /* iOS: API assente, no-op */ }
  }

  function scrivi(dx: number) {
    if (stripRef.current) stripRef.current.style.transform = `translateX(${dx}px)`
    const d = drag.current
    if (!d) return
    const live = d.startValue - dx / PX_PER_UNIT
    const rounded = Math.min(max, Math.max(min, Math.round(live)))
    if (rounded !== d.lastValue) {
      d.lastValue = rounded
      if (numberRef.current) numberRef.current.textContent = String(rounded)
      vibra()
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { startX: e.clientX, startValue: value, lastValue: value }
    setRenderCenter(value)
    setDragging(true)
    if (stripRef.current) stripRef.current.style.transform = 'translateX(0px)'
    if (numberRef.current) numberRef.current.textContent = String(value)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    pendingDx.current = e.clientX - drag.current.startX
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0
        if (pendingDx.current !== null) scrivi(pendingDx.current)
      })
    }
  }
  function fine() {
    cancelAnimationFrame(rafId.current)
    rafId.current = 0
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (stripRef.current) stripRef.current.style.transform = 'translateX(0px)'
    if (d && d.lastValue !== d.startValue) {
      setRenderCenter(d.lastValue) // evita lo scatto indietro-e-poi-avanti in attesa del commit
      onCommit(d.lastValue)
    }
  }

  const ticks: React.ReactNode[] = []
  for (let n = Math.max(min, Math.floor(renderCenter) - HALF_RANGE); n <= Math.min(max, Math.floor(renderCenter) + HALF_RANGE); n++) {
    const major = n % MAJOR_EVERY === 0
    const x = (n - renderCenter) * PX_PER_UNIT
    ticks.push(
      <div key={n} className="absolute top-0 flex flex-col items-center" style={{ left: `calc(50% + ${x}px)`, transform: 'translateX(-50%)' }}>
        {major && (
          <span className="mb-0.5 text-[11px] font-bold whitespace-nowrap" style={{ color: 'hsl(var(--primary))' }}>{n}</span>
        )}
        <div
          className={cn('rounded-full', major ? 'h-7 w-[3px]' : 'h-4 w-[2px]')}
          style={{ background: major ? 'hsl(var(--primary))' : 'color-mix(in srgb, hsl(var(--primary)) 40%, transparent)' }}
        />
      </div>
    )
  }

  return (
    <div className="select-none">
      <div
        className="relative h-20 touch-none overflow-hidden rounded-xl bg-black"
        style={{
          maskImage: 'linear-gradient(to right, transparent, black 18%, black 82%, transparent)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 18%, black 82%, transparent)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={fine}
        onPointerCancel={fine}
      >
        <div ref={stripRef} className="absolute inset-x-0 top-2 h-11" style={{ willChange: 'transform' }}>{ticks}</div>
        <div
          className="absolute bottom-1.5 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[7px] border-x-transparent"
          style={{ borderTopColor: 'hsl(var(--primary))' }}
        />
      </div>
      <p className="cassa-numeric mt-2 text-center text-3xl font-bold" style={{ color: 'hsl(var(--primary))' }}>
        <span ref={numberRef}>{value}</span>{unit && <span className="ml-1.5 text-base font-normal text-muted-foreground">{unit}</span>}
      </p>
    </div>
  )
}
