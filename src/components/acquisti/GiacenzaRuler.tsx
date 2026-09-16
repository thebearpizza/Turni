'use client'
import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// Cursore a righello in stile timer iOS (Dynamic Island): tacche che
// scorrono sotto un indicatore fisso al centro. A differenza dello
// scorrimento nativo (trascina a sinistra per aumentare, come una
// pellicola che scorre), qui la mappatura è quella richiesta
// esplicitamente: destra = aumenta, sinistra = diminuisce — le tacche
// si ricalcolano ad ogni frame dal valore corrente invece di seguire
// 1:1 la traslazione del dito.
//
// Nota: niente vero feedback aptico su iPhone — Safari non ha mai
// implementato la Vibration API (solo le app native possono vibrare).
// navigator.vibrate() qui sotto è quindi un no-op silenzioso su iOS,
// ma funziona su Android/Chrome: costa nulla lasciarlo.
const PX_PER_UNIT = 18
const MAJOR_EVERY = 5
const VISIBLE_HALF_RANGE = 26

interface Props {
  value: number
  unit?: string | null
  min?: number
  max?: number
  onCommit: (value: number) => void
}

export function GiacenzaRuler({ value, unit, min = 0, max = 999, onCommit }: Props) {
  const [dragging, setDragging] = useState(false)
  const [liveValue, setLiveValue] = useState(value)
  const drag = useRef<{ startX: number; startValue: number } | null>(null)

  const displayValue = dragging ? liveValue : value

  function vibra() {
    try { navigator.vibrate?.(3) } catch { /* iOS: API assente, no-op */ }
  }

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { startX: e.clientX, startValue: value }
    setLiveValue(value)
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const deltaUnits = Math.round((e.clientX - d.startX) / PX_PER_UNIT)
    const next = Math.min(max, Math.max(min, d.startValue + deltaUnits))
    setLiveValue(prev => {
      if (prev !== next) vibra()
      return next
    })
  }
  function fine() {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (d && liveValue !== d.startValue) onCommit(liveValue)
  }

  const centro = Math.round(displayValue)
  const ticks: React.ReactNode[] = []
  for (let n = Math.max(min, centro - VISIBLE_HALF_RANGE); n <= Math.min(max, centro + VISIBLE_HALF_RANGE); n++) {
    const major = n % MAJOR_EVERY === 0
    const x = (n - displayValue) * PX_PER_UNIT
    ticks.push(
      <div key={n} className="absolute top-0 flex flex-col items-center" style={{ left: `calc(50% + ${x}px)`, transform: 'translateX(-50%)' }}>
        {major && (
          <span className="mb-1 text-xs font-bold whitespace-nowrap" style={{ color: 'hsl(var(--primary))' }}>{n}</span>
        )}
        <div
          className={cn('rounded-full', major ? 'h-9 w-[3px]' : 'h-5 w-[2px]')}
          style={{ background: major ? 'hsl(var(--primary))' : 'color-mix(in srgb, hsl(var(--primary)) 40%, transparent)' }}
        />
      </div>
    )
  }

  return (
    <div className="select-none">
      <div
        className="relative h-[108px] touch-none overflow-hidden rounded-xl bg-black"
        style={{
          maskImage: 'linear-gradient(to right, transparent, black 18%, black 82%, transparent)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 18%, black 82%, transparent)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={fine}
        onPointerCancel={fine}
      >
        <div className="absolute inset-x-0 top-6 h-16">{ticks}</div>
        <div
          className="absolute bottom-2 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[9px] border-x-transparent"
          style={{ borderTopColor: 'hsl(var(--primary))' }}
        />
      </div>
      <p className="cassa-numeric mt-2 text-center text-3xl font-bold" style={{ color: 'hsl(var(--primary))' }}>
        {displayValue}{unit && <span className="ml-1.5 text-base font-normal text-muted-foreground">{unit}</span>}
      </p>
    </div>
  )
}
