'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { rilevaAngoli, warpProspettiva, angoliDefault, type Quadrilatero } from '@/lib/cassa/documentScan'
import { cn } from '@/lib/utils'
import { IcoX } from './comuni'

// Scanner del design (Acquisti cattura, 11a): fondo scuro, bordi rilevati
// sull'anteprima con i quattro angoli trascinabili (anche toccando il foglio
// si sposta l'angolo più vicino), "Usa foto originale" o "Ritaglia e
// aggiungi", e "Ripristina bordi rilevati" dopo una correzione a mano.

// Risoluzione di lavoro per rilevamento bordi e warp: l'OCR deve leggere
// prezzi e nomi piccoli, quindi conta la leggibilità più della velocità.
const MAX_LATO_LAVORO = 2200

interface Props {
  file: File
  onConfirm: (file: File) => void
  onCancel: () => void
  /** Numero della pagina nel caricamento, per il sottotitolo. */
  pagina?: number
}

export function DocumentScanner({ file, onConfirm, onCancel, pagina }: Props) {
  const sorgenteRef = useRef<HTMLCanvasElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [anteprima, setAnteprima] = useState<string | null>(null)
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null)
  const [quad, setQuad] = useState<Quadrilatero | null>(null)
  const [rilevati, setRilevati] = useState<Quadrilatero | null>(null)
  const [auto, setAuto] = useState(false)
  const [mosso, setMosso] = useState(false)
  const [resa, setResa] = useState(0)
  const [trascina, setTrascina] = useState<number | null>(null)
  const [elabora, setElabora] = useState(false)

  useEffect(() => {
    let annullato = false
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      if (annullato) { URL.revokeObjectURL(url); return }
      const s = Math.min(1, MAX_LATO_LAVORO / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s)
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) { URL.revokeObjectURL(url); return }
      ctx.drawImage(img, 0, 0, w, h)
      sorgenteRef.current = c
      const a = rilevaAngoli(c)
      const q = a ?? angoliDefault(w, h)
      setAuto(!!a); setQuad(q); setRilevati(q); setDim({ w, h }); setAnteprima(url)
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
    return () => { annullato = true }
  }, [file])

  // Larghezza resa dell'anteprima: converte fra coordinate del dito e dell'immagine.
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setResa(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [anteprima])

  const scala = dim && resa ? resa / dim.w : 1

  const sposta = useCallback((i: number, dx: number, dy: number, o: { x: number; y: number }) => {
    if (!dim) return
    setQuad(prev => {
      if (!prev) return prev
      const n = [...prev] as Quadrilatero
      n[i] = { x: Math.max(0, Math.min(dim.w, o.x + dx / scala)), y: Math.max(0, Math.min(dim.h, o.y + dy / scala)) }
      return n
    })
    setMosso(true)
  }, [dim, scala])

  function inizia(i: number, e: React.PointerEvent) {
    e.preventDefault(); e.stopPropagation()
    if (!quad) return
    const sx = e.clientX, sy = e.clientY, o = { ...quad[i] }
    setTrascina(i)
    const mv = (ev: PointerEvent) => { ev.preventDefault(); sposta(i, ev.clientX - sx, ev.clientY - sy, o) }
    const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); setTrascina(null) }
    // Listener non passivo: su telefono il trascinamento non deve scorrere la pagina.
    document.addEventListener('pointermove', mv, { passive: false })
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
  }

  // Tocco sul foglio: prende l'angolo più vicino.
  function toccaBox(e: React.PointerEvent) {
    const el = boxRef.current
    if (!el || !quad) return
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / scala, y = (e.clientY - r.top) / scala
    let best = 0, bd = Infinity
    quad.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = i } })
    inizia(best, e)
  }

  function conferma(raddrizza: boolean) {
    const c = sorgenteRef.current
    if (!c || !quad) return
    setElabora(true)
    const finale = (raddrizza ? warpProspettiva(c, quad) : null) ?? c
    finale.toBlob(blob => {
      setElabora(false)
      if (!blob) return
      onConfirm(new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.85)
  }

  const hint = mosso ? 'Angoli spostati a mano' : auto ? 'Bordi rilevati: trascina gli angoli se non sono precisi' : 'Bordi non rilevati: trascina gli angoli sui bordi del documento'

  return (
    <div className="flex h-full min-h-[560px] flex-col bg-[oklch(0.16_0.01_250)] text-white">
      <div className="flex flex-none items-center gap-2.5 px-4 py-2">
        <button type="button" onClick={onCancel} aria-label="Annulla" className="flex h-11 w-11 items-center justify-center opacity-80 active:scale-[0.96]"><IcoX s={18} /></button>
        <div className="flex flex-1 flex-col items-center">
          <span className="text-base font-semibold">Ritaglia la pagina</span>
          {pagina ? <span className="text-xs opacity-65">Pagina {pagina}</span> : null}
        </div>
        <div className="w-11" />
      </div>
      <div className={cn('mx-4 mt-1 flex min-h-10 flex-none items-center gap-2 rounded-[6px] px-3 text-[13px] font-medium transition-colors duration-200', mosso ? 'bg-[oklch(0.3_0.04_240)]' : 'bg-[oklch(0.26_0.01_250)]')}>{hint}</div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {!anteprima || !dim || !quad ? (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : (
          <div ref={boxRef} onPointerDown={toccaBox}
            className="relative max-h-full cursor-grab touch-none select-none overflow-hidden rounded-[6px]"
            style={{ aspectRatio: `${dim.w} / ${dim.h}`, width: `min(100%, calc((100dvh - 330px) * ${dim.w / dim.h}))` }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- anteprima locale da blob URL */}
            <img src={anteprima} alt="Pagina da ritagliare" draggable={false} className="block h-full w-full" />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${dim.w * scala} ${dim.h * scala}`} aria-hidden>
              <polygon points={quad.map(p => `${p.x * scala},${p.y * scala}`).join(' ')} fill="oklch(0.58 0.12 240 / .16)" stroke="oklch(0.7 0.14 240)" strokeWidth="2" />
            </svg>
            {quad.map((p, i) => (
              <div key={i} onPointerDown={e => inizia(i, e)}
                className="absolute -ml-7 -mt-7 flex h-14 w-14 cursor-grab touch-none items-center justify-center"
                style={{ left: p.x * scala, top: p.y * scala }}>
                <div className="box-border h-[26px] w-[26px] rounded-full border-2 border-white bg-[oklch(0.58_0.12_240)] shadow-[0_1px_4px_rgba(0,0,0,.3)] transition-transform duration-[120ms]" style={{ transform: `scale(${trascina === i ? 1.25 : 1})` }} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-none flex-col gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+20px)]">
        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <button type="button" disabled={elabora || !quad} onClick={() => conferma(false)} className="flex h-[52px] items-center justify-center rounded-[6px] border border-[oklch(0.4_0.01_250)] text-[15px] font-medium active:scale-[0.98] disabled:opacity-50">Usa foto originale</button>
          <button type="button" disabled={elabora || !quad} onClick={() => conferma(true)} className="flex h-[52px] items-center justify-center rounded-[6px] bg-white text-[15px] font-semibold text-[oklch(0.2_0.01_250)] active:scale-[0.98] disabled:opacity-50">{elabora ? 'Ritaglio…' : 'Ritaglia e aggiungi'}</button>
        </div>
        <button type="button" disabled={!mosso} onClick={() => { if (rilevati) setQuad(rilevati); setMosso(false) }} className="flex h-10 items-center justify-center text-sm font-medium opacity-70 disabled:opacity-30">Ripristina bordi rilevati</button>
      </div>
    </div>
  )
}
