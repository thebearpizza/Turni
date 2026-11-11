'use client'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
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

  // FLIP: dopo ogni scambio le pillole spostate partono dalla posizione di
  // prima e scivolano nella nuova (la trascinata segue il dito a parte).
  const primaDi = useRef<Map<string, number> | null>(null)
  useLayoutEffect(() => {
    const vecchie = primaDi.current
    primaDi.current = null
    if (!vecchie || !contenitore.current) return
    for (const el of contenitore.current.querySelectorAll<HTMLElement>('[data-li]')) {
      const n = el.dataset.li!, da = vecchie.get(n)
      if (da === undefined || n === sollevata) continue
      const d = da - el.offsetLeft
      if (!d) continue
      el.style.transition = 'none'
      el.style.transform = `translateX(${d}px)`
      void el.offsetWidth
      el.style.transition = 'transform 260ms cubic-bezier(0.22,1,0.36,1)'
      el.style.transform = ''
    }
  }, [provvisorio, sollevata])

  function premi(e: React.PointerEvent, nome: string) {
    if (e.button !== 0) return
    const x0 = e.clientX, y0 = e.clientY
    const box = contenitore.current
    const el0 = e.currentTarget as HTMLElement
    // Distanza fra il dito e il bordo sinistro della pillola: resta fissa.
    const presa = x0 - el0.getBoundingClientRect().left
    let attivo = false, ultimoX = x0
    const pillola = () => box?.querySelector<HTMLElement>(`[data-li="${CSS.escape(nome)}"]`) ?? null
    // Posizione voluta (coordinate del contenuto, scroll compreso) meno quella
    // di layout: la pillola resta sotto il dito anche dopo gli scambi.
    const segui = () => {
      const el = pillola()
      if (!el || !box) return
      const voluta = ultimoX - box.getBoundingClientRect().left + box.scrollLeft - presa
      el.style.transition = 'box-shadow 200ms, scale 200ms'
      el.style.transform = `translateX(${voluta - el.offsetLeft}px)`
      return voluta + el.offsetWidth / 2
    }
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
      ultimoX = ev.clientX
      // Vicino ai bordi la fila scorre, per portare la pillola oltre.
      if (box) {
        const r = box.getBoundingClientRect()
        if (ev.clientX < r.left + 24) box.scrollLeft -= 8
        else if (ev.clientX > r.right - 24) box.scrollLeft += 8
      }
      const centro = segui()
      if (centro === undefined || !box) return
      // Scambio quando il centro della pillola supera il centro della vicina
      // (posizioni di layout, non quelle a metà animazione).
      const els = [...box.querySelectorAll<HTMLElement>('[data-li]')]
      const o = nomi.current.slice(), i = o.indexOf(nome)
      if (i < 0) return
      const mezzo = (n: string | undefined) => { const el = n === undefined ? null : els.find(x => x.dataset.li === n); return el ? el.offsetLeft + el.offsetWidth / 2 : null }
      const dopo = mezzo(o[i + 1]), prima = mezzo(o[i - 1])
      let j = i
      if (dopo !== null && centro > dopo) j = i + 1
      else if (prima !== null && centro < prima) j = i - 1
      if (j === i) return
      primaDi.current = new Map(els.map(x => [x.dataset.li!, x.offsetLeft]))
      o.splice(i, 1); o.splice(j, 0, nome)
      nomi.current = o
      setProvvisorio(o)
      requestAnimationFrame(segui)
    }
    const fine = () => {
      clearTimeout(tm)
      window.removeEventListener('pointermove', muovi)
      window.removeEventListener('pointerup', fine)
      window.removeEventListener('pointercancel', fine)
      window.removeEventListener('touchmove', blocca)
      if (attivo) {
        // Rientro morbido nella posizione finale, poi si salva l'ordine.
        const el = pillola()
        if (el) { el.style.transition = 'transform 220ms cubic-bezier(0.22,1,0.36,1)'; el.style.transform = '' }
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
  // La fila ha 12 px di margine sopra e sotto (compensati) perché la
  // pillola sollevata e la sua ombra non vengano tagliate dallo scroll
  // orizzontale; quel margine non intercetta i tocchi.
  const base = 'relative flex h-10 flex-none cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-full border px-[14px] text-sm font-medium transition-[background-color,color,scale,box-shadow] duration-200 [-webkit-touch-callout:none] [-webkit-user-select:none]'
  const stato = (on: boolean) => (on ? 'border-primary bg-primary text-primary-foreground' : 'border-line-strong bg-card text-foreground')

  return (
    <div
      ref={contenitore}
      onContextMenu={e => e.preventDefault()}
      className={cn('pointer-events-none relative -mx-4 -my-3 flex min-w-0 gap-1.5 overflow-x-auto overscroll-x-contain px-4 py-3 [&>*]:pointer-events-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
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
            style={su ? { scale: '1.08', boxShadow: '0 8px 20px rgba(20,30,50,.22)', touchAction: 'none' } : undefined}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: on ? 'currentColor' : l.colore }} />
            {l.nome}
          </button>
        )
      })}
    </div>
  )
}
