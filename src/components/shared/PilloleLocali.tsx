'use client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'

// Pillole dei locali del design (Manager Analisi, MTTurni, MTPresenze,
// MTAssenze, MTReport, MTCassa, MTAcquisti, MTAltro): "Tutti i locali" e
// una pillola per locale col suo pallino. Con una pressione lunga (420 ms)
// la pillola si solleva (scala 1,08 e ombra) e si trascina per cambiare
// l'ordine, che resta salvato sul dispositivo e vale per tutte le
// schermate (stessa chiave del prototipo, ordine per nome).

const CHIAVE = 'inturno.locOrderL'
const ascoltatori = new Set<() => void>()
const avvisa = () => ascoltatori.forEach(l => l())

function iscrivi(l: () => void) {
  ascoltatori.add(l)
  const daAltraScheda = (e: StorageEvent) => { if (e.key === CHIAVE) l() }
  window.addEventListener('storage', daAltraScheda)
  return () => { ascoltatori.delete(l); window.removeEventListener('storage', daAltraScheda) }
}
function leggi(): string {
  try { return localStorage.getItem(CHIAVE) ?? '[]' } catch { return '[]' }
}
function salva(ordine: string[]) {
  try { localStorage.setItem(CHIAVE, JSON.stringify(ordine)) } catch { /* memoria non disponibile: l'ordine vale solo per questa visita */ }
  avvisa()
}

export interface LocalePillola { id: string; nome: string; colore: string }

export function PilloleLocali({ locali, selezionati, onCambia, multipla = false, etichettaTutti = 'Tutti i locali', className, tuttiComeVuoto = false, nascondiSeUno = true, senzaTutti = false }: {
  locali: LocalePillola[]
  /** Locali scelti; vuoto = tutti. */
  selezionati: string[]
  onCambia: (ids: string[]) => void
  /** Più locali insieme (Analisi) o uno solo (le altre sezioni). */
  multipla?: boolean
  etichettaTutti?: string
  className?: string
  /** Scegliere tutti i locali uno per uno equivale a "Tutti" (selezione vuota). */
  tuttiComeVuoto?: boolean
  /** Con un solo locale il filtro non serve. */
  nascondiSeUno?: boolean
  /** Niente pillola "Tutti i locali": si sceglie sempre un locale (Turni). */
  senzaTutti?: boolean
}) {
  const raw = useSyncExternalStore(iscrivi, leggi, () => '[]')
  // Durante il trascinamento l'ordine vive in memoria e si salva al rilascio.
  const [provvisorio, setProvvisorio] = useState<string[] | null>(null)
  const [sollevata, setSollevata] = useState<string | null>(null)
  const trascinato = useRef(false)
  const contenitore = useRef<HTMLDivElement>(null)

  let salvato: string[] = []
  try { salvato = JSON.parse(raw) } catch { /* ordine non leggibile: ordine naturale */ }
  const ordine = provvisorio ?? salvato
  const rango = (nome: string) => { const i = ordine.indexOf(nome); return i < 0 ? 999 : i }
  const lista = locali.map((l, i) => ({ l, i })).sort((a, b) => rango(a.l.nome) - rango(b.l.nome) || a.i - b.i).map(x => x.l)
  const nomi = useRef<string[]>([])
  const chiaveNomi = lista.map(l => l.nome).join('\u0000')
  useEffect(() => { nomi.current = chiaveNomi.split('\u0000') }, [chiaveNomi])

  function premi(e: React.PointerEvent, nome: string) {
    if (e.button !== 0) return
    const x0 = e.clientX, y0 = e.clientY
    let attivo = false
    const tm = setTimeout(() => {
      attivo = true
      trascinato.current = true
      navigator.vibrate?.(10)
      setProvvisorio(nomi.current.slice())
      setSollevata(nome)
    }, 420)
    const blocca = (ev: TouchEvent) => { if (attivo) ev.preventDefault() }
    const muovi = (ev: PointerEvent) => {
      if (!attivo) {
        if (Math.abs(ev.clientX - x0) > 8 || Math.abs(ev.clientY - y0) > 8) fine()
        return
      }
      // Scambio solo quando il dito supera il centro della pillola accanto:
      // dopo lo scambio la vicina si sposta oltre il dito, quindi non torna
      // indietro anche se le due pillole hanno larghezze diverse.
      const els = [...(contenitore.current?.querySelectorAll<HTMLElement>('[data-li]') ?? [])]
      const o = nomi.current.slice(), i = o.indexOf(nome)
      if (i < 0) return
      const centro = (n: string) => { const el = els.find(x => x.dataset.li === n); if (!el) return null; const r = el.getBoundingClientRect(); return r.left + r.width / 2 }
      const dopo = o[i + 1] !== undefined ? centro(o[i + 1]) : null
      const prima = o[i - 1] !== undefined ? centro(o[i - 1]) : null
      let j = i
      if (dopo !== null && ev.clientX > dopo) j = i + 1
      else if (prima !== null && ev.clientX < prima) j = i - 1
      if (j === i) return
      o.splice(i, 1); o.splice(j, 0, nome)
      nomi.current = o
      setProvvisorio(o)
    }
    const fine = () => {
      clearTimeout(tm)
      window.removeEventListener('pointermove', muovi)
      window.removeEventListener('pointerup', fine)
      window.removeEventListener('pointercancel', fine)
      window.removeEventListener('touchmove', blocca)
      if (attivo) {
        salva(nomi.current)
        setProvvisorio(null)
        setSollevata(null)
        setTimeout(() => { trascinato.current = false }, 50)
      }
    }
    window.addEventListener('pointermove', muovi)
    window.addEventListener('pointerup', fine)
    window.addEventListener('pointercancel', fine)
    window.addEventListener('touchmove', blocca, { passive: false })
  }

  if (nascondiSeUno && locali.length <= 1) return null
  const base = 'relative flex h-10 flex-none cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-full border px-[14px] text-sm font-medium transition-[background-color,color] duration-200 [-webkit-touch-callout:none] [-webkit-user-select:none]'
  const stato = (on: boolean) => (on ? 'border-primary bg-primary text-primary-foreground' : 'border-line-strong bg-card text-foreground')

  return (
    <div
      ref={contenitore}
      onContextMenu={e => e.preventDefault()}
      className={cn('-mx-4 flex min-w-0 gap-1.5 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
    >
      {!senzaTutti && (
        <button type="button" onClick={() => onCambia([])} className={cn(base, 'z-[1] active:scale-[0.97]', stato(selezionati.length === 0))}>
          {etichettaTutti}
        </button>
      )}
      {lista.map(l => {
        const on = selezionati.includes(l.id), su = sollevata === l.nome
        return (
          <button
            key={l.id} type="button" data-li={l.nome}
            onPointerDown={e => premi(e, l.nome)}
            onClick={() => {
              if (trascinato.current) { trascinato.current = false; return }
              if (!multipla) { onCambia([l.id]); return }
              const n = on ? selezionati.filter(x => x !== l.id) : [...selezionati, l.id]
              onCambia(tuttiComeVuoto && n.length === locali.length ? [] : n)
            }}
            className={cn(base, stato(on), su ? 'z-[2]' : 'z-[1] active:scale-[0.97]')}
            style={su ? { transform: 'scale(1.08)', boxShadow: '0 8px 20px rgba(20,30,50,.22)', touchAction: 'none' } : undefined}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: on ? 'currentColor' : l.colore }} />
            {l.nome}
          </button>
        )
      })}
    </div>
  )
}
