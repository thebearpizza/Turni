'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { rilevaAngoli, warpProspettiva, angoliDefault, type Quadrilatero } from '@/lib/cassa/documentScan'
import { Button } from '@/components/ui/button'
import { Loader2, ScanLine } from 'lucide-react'

// Oltre questa risoluzione di lavoro il warp diventa lento sui telefoni
// senza guadagno utile: l'uscita è comunque limitata a 1600px di lato.
const MAX_LATO_LAVORO = 2000

interface Props {
  file: File
  onConfirm: (file: File) => void
  onCancel: () => void
}

// Ritaglio prospettico "statico" di una pagina già fotografata: rileva i
// bordi, li mostra trascinabili sopra l'anteprima e raddrizza. Se il
// rilevamento sbaglia (poco contrasto col piano, ombre) l'utente sposta
// i quattro angoli a mano, oppure salta del tutto la correzione.
export function DocumentScanner({ file, onConfirm, onCancel }: Props) {
  const sorgenteRef = useRef<HTMLCanvasElement | null>(null)
  const contenitoreRef = useRef<HTMLDivElement | null>(null)
  const [anteprima, setAnteprima] = useState<string | null>(null)
  const [dimensioni, setDimensioni] = useState<{ w: number; h: number } | null>(null)
  const [quad, setQuad] = useState<Quadrilatero | null>(null)
  const [rilevatoAuto, setRilevatoAuto] = useState(false)
  const [larghezzaResa, setLarghezzaResa] = useState(0)
  const [trascinando, setTrascinando] = useState<number | null>(null)
  const [elaborando, setElaborando] = useState(false)

  useEffect(() => {
    let annullato = false
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      if (annullato) { URL.revokeObjectURL(url); return }

      const scala = Math.min(1, MAX_LATO_LAVORO / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.round(img.naturalWidth * scala)
      const h = Math.round(img.naturalHeight * scala)

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) { URL.revokeObjectURL(url); return }
      ctx.drawImage(img, 0, 0, w, h)
      sorgenteRef.current = canvas

      const angoli = rilevaAngoli(canvas)
      setRilevatoAuto(!!angoli)
      setQuad(angoli ?? angoliDefault(w, h))
      setDimensioni({ w, h })
      setAnteprima(url)
    }

    img.onerror = () => { URL.revokeObjectURL(url) }
    img.src = url

    return () => { annullato = true }
  }, [file])

  // Larghezza effettiva a schermo dell'anteprima: serve a convertire fra
  // coordinate del dito e coordinate dell'immagine sorgente.
  useEffect(() => {
    const el = contenitoreRef.current
    if (!el) return
    const aggiorna = () => setLarghezzaResa(el.clientWidth)
    aggiorna()
    const ro = new ResizeObserver(aggiorna)
    ro.observe(el)
    return () => ro.disconnect()
  }, [anteprima])

  const scala = dimensioni && larghezzaResa ? larghezzaResa / dimensioni.w : 1

  const spostaAngolo = useCallback((indice: number, clientX: number, clientY: number) => {
    const el = contenitoreRef.current
    if (!el || !dimensioni) return
    const rect = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(dimensioni.w, (clientX - rect.left) / scala))
    const y = Math.max(0, Math.min(dimensioni.h, (clientY - rect.top) / scala))
    setQuad(prev => {
      if (!prev) return prev
      const next = [...prev] as Quadrilatero
      next[indice] = { x, y }
      return next
    })
  }, [dimensioni, scala])

  useEffect(() => {
    if (trascinando === null) return
    const muovi = (e: PointerEvent) => { e.preventDefault(); spostaAngolo(trascinando, e.clientX, e.clientY) }
    const rilascia = () => setTrascinando(null)
    // Listener non-passive sul documento: senza preventDefault il
    // trascinamento su mobile scrollerebbe la pagina invece di muovere
    // l'angolo (stesso motivo dello scrub sui grafici).
    document.addEventListener('pointermove', muovi, { passive: false })
    document.addEventListener('pointerup', rilascia)
    document.addEventListener('pointercancel', rilascia)
    return () => {
      document.removeEventListener('pointermove', muovi)
      document.removeEventListener('pointerup', rilascia)
      document.removeEventListener('pointercancel', rilascia)
    }
  }, [trascinando, spostaAngolo])

  async function conferma(raddrizza: boolean) {
    const canvas = sorgenteRef.current
    if (!canvas || !quad) return
    setElaborando(true)

    const risultato = raddrizza ? warpProspettiva(canvas, quad) : canvas
    const finale = risultato ?? canvas

    finale.toBlob(blob => {
      setElaborando(false)
      if (!blob) return
      const nome = file.name.replace(/\.[^.]+$/, '') + '.jpg'
      onConfirm(new File([blob], nome, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.85)
  }

  if (!anteprima || !dimensioni || !quad) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const puntiPoligono = quad.map(p => `${p.x * scala},${p.y * scala}`).join(' ')

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ScanLine className="h-3.5 w-3.5 shrink-0" />
        {rilevatoAuto
          ? 'Bordi rilevati — trascina gli angoli se non sono precisi.'
          : 'Bordi non rilevati automaticamente: trascina gli angoli sui bordi del documento.'}
      </p>

      <div
        ref={contenitoreRef}
        className="relative w-full select-none overflow-hidden rounded-md border border-border"
        style={{ touchAction: 'none' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- anteprima locale da blob URL, next/image non si applica */}
        <img src={anteprima} alt="Pagina da ritagliare" className="block w-full" draggable={false} />

        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${dimensioni.w * scala} ${dimensioni.h * scala}`}
          style={{ touchAction: 'none' }}
        >
          <polygon points={puntiPoligono} fill="hsl(var(--primary) / 0.15)" stroke="hsl(var(--primary))" strokeWidth={2} />
          {quad.map((p, i) => (
            <circle
              key={i}
              cx={p.x * scala}
              cy={p.y * scala}
              // Raggio generoso: deve restare afferrabile con un dito.
              r={14}
              fill="hsl(var(--primary))"
              stroke="white"
              strokeWidth={2}
              style={{ cursor: 'grab' }}
              onPointerDown={e => { e.preventDefault(); setTrascinando(i) }}
            />
          ))}
        </svg>
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={elaborando}>Annulla</Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => conferma(false)} disabled={elaborando}>
            Usa foto originale
          </Button>
          <Button type="button" size="sm" onClick={() => conferma(true)} disabled={elaborando}>
            {elaborando ? <><Loader2 className="h-4 w-4 animate-spin" /> Ritaglio…</> : 'Ritaglia e aggiungi'}
          </Button>
        </div>
      </div>
    </div>
  )
}
