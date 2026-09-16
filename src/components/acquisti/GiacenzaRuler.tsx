'use client'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// Rotella in stile timer iOS (Dynamic Island): tacche che seguono il
// dito 1:1 come una vera rotella fisica, non un righello che scatta a
// unità intere. Trascinare a sinistra aumenta il valore, a destra lo
// diminuisce (la rotella "gira" verso i numeri più alti che stanno più
// a destra sulla riga — lo stesso verso di uno scorrimento nativo).
//
// Per restare fluida (niente scatti), la posizione durante il gesto è
// scritta DIRETTAMENTE sul nodo DOM via ref (un translateX continuo,
// non arrotondato) invece che tramite stato React — un nuovo
// render/reconciliation ad ogni pixel di movimento è esattamente la
// causa più comune di scatti in un drag React, stesso principio già
// usato per il foglio di navigazione (DockNav).
//
// Al rilascio, se il gesto era veloce, la rotella prosegue per inerzia
// e rallenta con attrito costante (ciclo rAF che integra la fisica
// frame per frame, stessa idea della molla di DockNav ma con un
// attrito verso velocità zero invece di una molla verso un bersaglio).
//
// Nota: niente vero feedback aptico su iPhone — Safari non ha mai
// implementato la Vibration API (solo le app native possono vibrare).
// navigator.vibrate() qui sotto è quindi un no-op silenzioso su iOS,
// ma funziona su Android/Chrome: costa nulla lasciarlo.
const PX_PER_UNIT = 18
const MAJOR_EVERY = 5
const HALF_RANGE = 110 // copre anche un lancio molto forte (vedi V_MAX/ATTRITO) senza esaurire le tacche pre-disegnate a metà corsa
const EDGE_RANGE = 15 // unità oltre le quali le tacche a riposo sono già rimpicciolite/sfumate al massimo
const FLING_SOGLIA = 250 // px/s — sotto non scatta l'inerzia, è un rilascio "controllato"
const V_MAX = 2400 // px/s — velocità massima in ingresso al lancio, limita anche quanto lontano può arrivare la corsa
const ATTRITO = 1800 // px/s² — quanto rapidamente rallenta il lancio

interface Drag {
  startValue: number
  lastValue: number
  startX: number
  lastX: number
  lastT: number
  v: number
}

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
  const [animating, setAnimating] = useState(false)
  const [renderCenter, setRenderCenter] = useState(value)
  const stripRef = useRef<HTMLDivElement>(null)
  const numberRef = useRef<HTMLSpanElement>(null)
  const drag = useRef<Drag | null>(null)
  const pendingDx = useRef<number | null>(null)
  const rafId = useRef(0)
  // Un pointerup/pointercancel duplicato per lo stesso gesto (capita su
  // iOS) non deve rielaborare/azzerare il lancio già avviato.
  const gestitoRef = useRef(false)

  // Da ferma, la rotella resta centrata sul valore corrente (dopo un
  // commit, o un aggiornamento realtime da un altro dispositivo).
  useEffect(() => {
    if (!animating) setRenderCenter(value)
  }, [value, animating])

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

  function concludi() {
    const d = drag.current
    drag.current = null
    setAnimating(false)
    if (stripRef.current) stripRef.current.style.transform = 'translateX(0px)'
    if (d && d.lastValue !== d.startValue) {
      setRenderCenter(d.lastValue) // evita lo scatto indietro-e-poi-avanti in attesa del commit
      onCommit(d.lastValue)
    }
  }

  function lanciaInerzia(dxIniziale: number, vIniziale: number) {
    let dx = dxIniziale
    let v = vIniziale
    let t0 = performance.now()
    const step = (t: number) => {
      const d = drag.current
      if (!d) return // il gesto è già stato concluso altrove (es. ripreso in mano a metà corsa)
      const dt = Math.min((t - t0) / 1000, 0.032)
      t0 = t
      const segno = v > 0 ? 1 : -1
      v -= segno * ATTRITO * dt
      if (segno * v < 0) v = 0
      dx += v * dt
      const live = d.startValue - dx / PX_PER_UNIT
      if (live <= min || live >= max) {
        // Ha raggiunto un limite reale (es. zero): si ferma lì, non
        // continua a "scorrere nel vuoto" oltre il bordo.
        const limite = Math.min(max, Math.max(min, live))
        scrivi((d.startValue - limite) * PX_PER_UNIT)
        concludi()
        return
      }
      scrivi(dx)
      if (Math.abs(v) < 40) { concludi(); return }
      rafId.current = requestAnimationFrame(step)
    }
    rafId.current = requestAnimationFrame(step)
  }

  function onPointerDown(e: React.PointerEvent) {
    gestitoRef.current = false
    cancelAnimationFrame(rafId.current)
    rafId.current = 0
    // Se si afferra la rotella mentre sta ancora scorrendo per
    // inerzia, il punto raggiunto finora diventa definitivo (si
    // "blocca" lì) invece di tornare al valore precedente al lancio.
    const interrotto = drag.current
    let valoreIniziale = value
    if (interrotto) {
      valoreIniziale = interrotto.lastValue
      drag.current = null
      if (interrotto.lastValue !== interrotto.startValue) {
        setRenderCenter(interrotto.lastValue)
        onCommit(interrotto.lastValue)
      }
    }
    const t = performance.now()
    drag.current = { startValue: valoreIniziale, lastValue: valoreIniziale, startX: e.clientX, lastX: e.clientX, lastT: t, v: 0 }
    setAnimating(true)
    setRenderCenter(valoreIniziale)
    if (stripRef.current) stripRef.current.style.transform = 'translateX(0px)'
    if (numberRef.current) numberRef.current.textContent = String(valoreIniziale)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const t = performance.now()
    const dt = t - d.lastT
    if (dt > 0) { d.v = Math.max(-V_MAX, Math.min(V_MAX, (e.clientX - d.lastX) / dt * 1000)); d.lastT = t; d.lastX = e.clientX }
    pendingDx.current = e.clientX - d.startX
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0
        if (pendingDx.current !== null) scrivi(pendingDx.current)
      })
    }
  }
  function fine() {
    if (gestitoRef.current) return // pointerup + pointercancel duplicati per lo stesso gesto
    gestitoRef.current = true
    cancelAnimationFrame(rafId.current)
    rafId.current = 0
    const d = drag.current
    if (!d) return
    const dxAttuale = pendingDx.current ?? 0
    pendingDx.current = null
    if (Math.abs(d.v) > FLING_SOGLIA) lanciaInerzia(dxAttuale, d.v)
    else concludi()
  }

  const ticks: React.ReactNode[] = []
  for (let n = Math.max(min, Math.floor(renderCenter) - HALF_RANGE); n <= Math.min(max, Math.floor(renderCenter) + HALF_RANGE); n++) {
    const major = n % MAJOR_EVERY === 0
    const x = (n - renderCenter) * PX_PER_UNIT
    // Un po' di tridimensionalità SOLO a riposo: applicarla anche
    // durante il gesto la farebbe apparire sballata (il centro visivo
    // si sposta col dito/l'inerzia, ma qui il calcolo resta ancorato
    // al valore fermo) — a riposo invece si anima dolcemente verso la
    // forma corretta invece di scattare di colpo.
    const t = animating ? 0 : Math.min(1, Math.abs(n - renderCenter) / EDGE_RANGE)
    const scala = 1 - 0.45 * t
    const opacita = 1 - 0.55 * t
    ticks.push(
      <div
        key={n}
        className="absolute top-0 flex flex-col items-center"
        style={{
          left: `calc(50% + ${x}px)`,
          transform: `translateX(-50%) scaleY(${scala})`,
          opacity: opacita,
          transition: animating ? 'none' : 'transform 220ms ease-out, opacity 220ms ease-out',
        }}
      >
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
          boxShadow: 'inset 0 3px 8px rgba(0,0,0,.7), inset 0 -3px 8px rgba(0,0,0,.7), inset 0 0 24px rgba(0,0,0,.5)',
          background: 'radial-gradient(ellipse at 50% 40%, #161616, #000 75%)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={fine}
        onPointerCancel={fine}
      >
        <div ref={stripRef} className="absolute inset-x-0 top-2 h-11" style={{ willChange: 'transform' }}>{ticks}</div>
        <div
          className="absolute bottom-1.5 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[7px] border-x-transparent"
          style={{ borderTopColor: 'hsl(var(--primary))', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.6))' }}
        />
      </div>
      <p className="cassa-numeric mt-2 text-center text-3xl font-bold" style={{ color: 'hsl(var(--primary))' }}>
        <span ref={numberRef}>{value}</span>{unit && <span className="ml-1.5 text-base font-normal text-muted-foreground">{unit}</span>}
      </p>
    </div>
  )
}
