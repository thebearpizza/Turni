'use client'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import { Home, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

// ═══════════════════════════════════════════════════════════════════════
// DockNav — barra di navigazione a foglio estraibile, condivisa da Turni,
// Cassa e Acquisti (sostituisce il drawer laterale). Riscrittura in React
// del mockup-navigazione.html fornito come specifica di comportamento:
// stessa fisica (molla, isteresi, FLIP), stesso DOM a tre pezzi per non
// mai animare l'altezza — vedi i commenti sulle singole parti sotto.
// ═══════════════════════════════════════════════════════════════════════

export interface DockNavItem {
  /** Identificatore stabile, indipendente dall'ordine — usato come chiave
   *  React e come voce dell'ordine salvato in localStorage. */
  key: string
  href: string
  icon: LucideIcon
  label: string
  /** Conteggio di elementi in sospeso — numero nella griglia, pallino nella barra. */
  badge?: number
}

export interface DockNavAreaLink {
  key: string
  label: string
  href: string
}

interface DockNavProps {
  /** Solo per la chiave di localStorage (`dock-order:{userId}:{area}`). */
  area: string
  /** Voci nell'ordine predefinito — MAI includere "Home", gestita a parte. */
  items: DockNavItem[]
  userId: string
  /** Colore d'accento CSS (qualsiasi valore valido, incluso `hsl(var(--primary))`
   *  per ereditare il tema già scopato per area — vedi globals.css .cassa/.acquisti). */
  tone?: string
  /** Se presente, mostra i pulsanti Home (in alto a destra e nel piede del foglio). */
  homeHref?: string
  /** Selettore compatto delle macroaree nel piede del foglio — solo se >1 voce. */
  areaLinks?: DockNavAreaLink[]
  onLogout: () => void | Promise<void>
}

const NDOCK = 4
const K = 190 // costante elastica della molla, condivisa da ogni transizione
const D_TOCCO = 22       // apertura pulita (tocco o rilascio lento in apertura)
const D_LANCIO = 17      // lanciata oltre 450px/s: rimbalzo a fine corsa
const D_CHIUSURA = 26    // qualsiasi chiusura: nessun rientro
const V_SOGLIA = 450     // px/s — sotto vince la posizione, sopra vince il gesto
const V_MAX = 2500       // limite di velocità in ingresso alla molla
const MARGINE_ISTERESI = 0.7 // × lato minore della cella, vedi slotAt()

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

// ── Ordine persistito per utente+area ────────────────────────────────
function loadOrder(userId: string, area: string, keys: string[]): string[] {
  if (typeof window === 'undefined') return keys
  try {
    const raw = localStorage.getItem(`dock-order:${userId}:${area}`)
    if (!raw) return keys
    const saved = JSON.parse(raw) as unknown
    if (!Array.isArray(saved) || saved.length !== keys.length) return keys
    const keySet = new Set(keys)
    const savedSet = new Set(saved)
    if (savedSet.size !== keySet.size) return keys
    for (const k of saved) if (typeof k !== 'string' || !keySet.has(k)) return keys
    return saved as string[]
  } catch {
    return keys
  }
}
function persistOrder(userId: string, area: string, order: string[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(`dock-order:${userId}:${area}`, JSON.stringify(order)) } catch { /* storage piena/negata: l'ordine resta solo in memoria per questa sessione */ }
}

export function DockNav({ area, items, userId, tone = 'hsl(var(--primary))', homeHref, areaLinks, onLogout }: DockNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const itemByKey = useMemo(() => new Map(items.map(it => [it.key, it])), [items])
  const defaultOrder = useMemo(() => items.map(it => it.key), [items])

  const [order, setOrder] = useState<string[]>(defaultOrder)
  useEffect(() => {
    setOrder(loadOrder(userId, area, defaultOrder))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, area])
  // Se la lista voci cambia (ruolo diverso, nuova voce) dopo il mount,
  // l'ordine salvato non è più coerente con le chiavi disponibili: ricade
  // sull'ordine predefinito invece di mostrare un buco o una voce fantasma.
  useEffect(() => {
    setOrder(prev => (prev.length === defaultOrder.length && prev.every(k => itemByKey.has(k)) ? prev : defaultOrder))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOrder])

  const [edit, setEditState] = useState(false)
  const editRef = useRef(false)
  const setEdit = useCallback((v: boolean) => { editRef.current = v; setEditState(v) }, [])

  // ── Rifs per la fisica del foglio — MAI stato React: scritti ad ogni
  // frame durante il trascinamento, uno stato React ricreerebbe l'intero
  // sottoalbero a 60fps invece di una singola scrittura di transform. ──
  const clipRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const padRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const grabBarRef = useRef<HTMLSpanElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const H = useRef(0) // altezza massima di apertura = altezza di .pad
  const cur = useRef(0) // apertura corrente in px
  const rafId = useRef(0)
  const drag = useRef<{ y: number; h: number; t: number; ly: number; v: number; moved: boolean } | null>(null)
  const pending = useRef<number | null>(null)
  const pendingRaf = useRef(0)

  // Unica scrittura sul DOM per frame: transform/opacity non innescano
  // layout, quindi il costo per frame resta O(1) indipendentemente da
  // quanto è complesso il contenuto del foglio.
  const applica = useCallback((px: number) => {
    const c = Math.max(0, px)
    cur.current = c
    if (panelRef.current) panelRef.current.style.transform = `translateY(${H.current - c}px)`
    const p = H.current ? Math.min(c / H.current, 1) : 0
    if (scrimRef.current) {
      scrimRef.current.style.opacity = (p * 0.5).toFixed(3)
      scrimRef.current.style.pointerEvents = c > 6 ? 'auto' : 'none'
    }
    if (padRef.current) padRef.current.style.opacity = Math.max(0, Math.min(1, p * 1.5 - 0.15)).toFixed(3)
    if (grabBarRef.current) grabBarRef.current.style.width = (40 + 14 * p).toFixed(1) + 'px'
  }, [])

  const misura = useCallback(() => {
    const dh = dockRef.current?.offsetHeight ?? 0
    if (clipRef.current) clipRef.current.style.bottom = dh + 'px'
    H.current = padRef.current?.offsetHeight ?? 0
    if (!drag.current && !rafId.current) applica(cur.current)
  }, [applica])

  // Oscillatore smorzato (Euler semi-implicito), stessa forma del mockup:
  // v += (-k·(x-target) - d·v)·dt ; x += v·dt — dt limitato a 32ms per
  // assorbire eventuali frame perse senza far esplodere l'integrazione.
  const molla = useCallback((target: number, v0: number, damping?: number) => {
    cancelAnimationFrame(rafId.current)
    if (prefersReducedMotion()) {
      applica(target)
      if (!target && editRef.current) setEdit(false)
      return
    }
    let x = cur.current
    let v = v0 || 0
    const d = damping ?? (target > 0 ? D_TOCCO : D_CHIUSURA)
    let t0 = performance.now()
    const step = (t: number) => {
      const dt = Math.min((t - t0) / 1000, 0.032)
      t0 = t
      v += (-K * (x - target) - d * v) * dt
      x += v * dt
      if (Math.abs(x - target) < 0.4 && Math.abs(v) < 14) {
        rafId.current = 0
        applica(target)
        if (!target && editRef.current) setEdit(false)
        return
      }
      applica(x)
      rafId.current = requestAnimationFrame(step)
    }
    rafId.current = requestAnimationFrame(step)
  }, [applica, setEdit])

  const openPanel = useCallback(() => { misura(); molla(H.current, 0, D_TOCCO) }, [misura, molla])
  const closePanel = useCallback(() => { molla(0, 0, D_CHIUSURA) }, [molla])
  const togglePanel = useCallback(() => { (cur.current > H.current / 2 ? closePanel : openPanel)() }, [closePanel, openPanel])

  const toggleEdit = useCallback(() => {
    const next = !editRef.current
    setEdit(next)
    const eraAperto = cur.current > 6
    // La riga di suggerimento in modalità riordino cambia l'altezza di
    // .pad: rimisura DOPO che React ha applicato la classe (il testo è
    // già nel DOM in questo stesso commit grazie a edit come stato,
    // quindi un rAF basta ad aspettare il layout risultante).
    requestAnimationFrame(() => {
      misura()
      if (eraAperto) molla(H.current, 0, D_TOCCO)
      else applica(0)
    })
  }, [misura, molla, applica, setEdit])

  useEffect(() => {
    misura()
    window.addEventListener('resize', misura)
    return () => window.removeEventListener('resize', misura)
  }, [misura])
  // La griglia cambia dimensione quando l'ordine/i dati cambiano (nuovo
  // badge, nuova voce): rimisura per tenere H aggiornata.
  useEffect(() => { misura() }, [order, misura])

  // Chiude il foglio (senza animarlo: siamo già altrove) ad ogni cambio
  // pagina — click su una voce della griglia o della barra.
  const prevPathname = useRef(pathname)
  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname
      cancelAnimationFrame(rafId.current)
      rafId.current = 0
      if (editRef.current) setEdit(false)
      applica(0)
    }
  }, [pathname, applica, setEdit])

  // ── Maniglia: tocco/trascinamento/rilascio ──────────────────────────
  function onGrabPointerDown(e: React.PointerEvent) {
    cancelAnimationFrame(rafId.current)
    rafId.current = 0
    misura()
    drag.current = { y: e.clientY, h: cur.current, t: performance.now(), ly: e.clientY, v: 0, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onGrabPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const t = performance.now()
    const dt = t - d.t
    if (dt > 0) { d.v = (d.ly - e.clientY) / dt * 1000; d.t = t; d.ly = e.clientY }
    if (Math.abs(d.y - e.clientY) > 3) d.moved = true
    let hh = d.h + (d.y - e.clientY)
    if (hh > H.current) hh = H.current + (hh - H.current) * 0.32 // resistenza elastica oltre l'apertura massima
    pending.current = hh
    if (!pendingRaf.current) {
      pendingRaf.current = requestAnimationFrame(() => {
        pendingRaf.current = 0
        if (pending.current !== null) applica(pending.current)
      })
    }
  }
  function fineTrascinamento() {
    const d = drag.current
    if (!d) return
    cancelAnimationFrame(pendingRaf.current)
    pendingRaf.current = 0
    if (pending.current !== null) { applica(pending.current); pending.current = null }
    const v = d.v
    const mosso = d.moved
    drag.current = null
    if (!mosso) { togglePanel(); return }
    if (v > V_SOGLIA) molla(H.current, Math.min(v, V_MAX), D_LANCIO)
    else if (v < -V_SOGLIA) molla(0, v, D_CHIUSURA)
    else molla(cur.current > H.current / 2 ? H.current : 0, v, cur.current > H.current / 2 ? D_TOCCO : D_CHIUSURA)
  }

  // ── Riordino (Task 2) ────────────────────────────────────────────────
  const dragState = useRef<{ key: string; ghost: HTMLElement; dx: number; dy: number } | null>(null)
  const flipRaf = useRef(0)
  // A differenza del mockup (dove mutate() è un insertBefore sincrono,
  // quindi "prima" e "dopo" si misurano nella stessa chiamata), qui
  // l'ordine cambia via setOrder — un aggiornamento React che NON riflette
  // subito sul DOM. Le rect "prima" si catturano al momento dello scambio
  // (vedi onGridPointerMove) e si confrontano con quelle "dopo" in questo
  // useLayoutEffect, che gira sincrono DOPO che React ha già ridisegnato
  // la griglia col nuovo ordine ma PRIMA che il browser dipinga il frame —
  // lo stesso istante logico del mutate() sincrono del mockup.
  const preRects = useRef<Map<string, DOMRect> | null>(null)
  useLayoutEffect(() => {
    const pre = preRects.current
    const grid = gridRef.current
    if (!pre || !grid) return
    preRects.current = null
    const kids = Array.from(grid.children) as HTMLElement[]
    let moved = false
    kids.forEach(el => {
      const k = el.dataset.key
      const preRect = k ? pre.get(k) : undefined
      if (!preRect) return
      const a = el.getBoundingClientRect()
      const dx = preRect.left - a.left
      const dy = preRect.top - a.top
      if (!dx && !dy) return
      moved = true
      el.style.transition = 'none'
      el.style.transform = `translate(${dx}px,${dy}px)`
    })
    if (!moved) return
    void grid.getBoundingClientRect() // forza un unico reflow prima di attivare la transizione
    cancelAnimationFrame(flipRaf.current)
    flipRaf.current = requestAnimationFrame(() => {
      kids.forEach(el => {
        el.style.transition = 'transform .3s cubic-bezier(.32,.72,0,1)'
        el.style.transform = ''
      })
    })
  }, [order])

  // Centro di uno slot dal LAYOUT (offsetLeft/Top), non dal rettangolo
  // visivo: durante un FLIP le icone sono a metà transizione e
  // getBoundingClientRect darebbe posizioni sbagliate — il useLayoutEffect
  // sopra invece usa correttamente getBoundingClientRect (gli serve
  // proprio la posizione visiva, prima/dopo la mutazione DOM).
  function centro(el: HTMLElement): [number, number] {
    const g = gridRef.current!.getBoundingClientRect()
    return [g.left + el.offsetLeft + el.offsetWidth / 2, g.top + el.offsetTop + el.offsetHeight / 2]
  }
  function dist(el: HTMLElement, x: number, y: number): number {
    const [cx, cy] = centro(el)
    return Math.hypot(x - cx, y - cy)
  }
  // Isteresi: lo slot nuovo vince solo se più vicino di quello attuale di
  // almeno MARGINE_ISTERESI × lato minore — senza questa soglia, col dito
  // fermo sul confine fra due celle le distanze restano quasi identiche e
  // il riordino oscilla all'infinito.
  function slotAt(x: number, y: number, curIdx: number): number {
    const kids = Array.from(gridRef.current!.children) as HTMLElement[]
    let best = -1, bd = Infinity
    kids.forEach((el, i) => { const d = dist(el, x, y); if (d < bd) { bd = d; best = i } })
    if (curIdx >= 0 && best !== curIdx && kids[curIdx]) {
      const r = kids[curIdx]
      if (bd > dist(r, x, y) - MARGINE_ISTERESI * Math.min(r.offsetWidth, r.offsetHeight)) return curIdx
    }
    return best
  }

  function onItemPointerDown(e: React.PointerEvent, key: string) {
    if (!editRef.current || dragState.current) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    const ghost = el.cloneNode(true) as HTMLElement
    ghost.className = 'dock-nav-ghost'
    ghost.style.width = r.width + 'px'
    ghost.style.height = r.height + 'px'
    ghost.style.left = r.left + 'px'
    ghost.style.top = r.top + 'px'
    document.body.appendChild(ghost)
    el.classList.add('dock-nav-holder')
    dragState.current = { key, ghost, dx: e.clientX - r.left, dy: e.clientY - r.top }
    gridRef.current?.setPointerCapture(e.pointerId)
  }
  function onGridPointerMove(e: React.PointerEvent) {
    const ds = dragState.current
    if (!ds) return
    ds.ghost.style.left = (e.clientX - ds.dx) + 'px'
    ds.ghost.style.top = (e.clientY - ds.dy) + 'px'
    const grid = gridRef.current
    if (!grid) return
    const kids = Array.from(grid.children) as HTMLElement[]
    const curIdx = kids.findIndex(el => el.dataset.key === ds.key)
    const want = slotAt(e.clientX, e.clientY, curIdx)
    if (want < 0 || want === curIdx) return
    // Cattura le rect "prima" per il FLIP (vedi il useLayoutEffect sopra),
    // poi sposta l'elemento trascinato dalla sua posizione a `want`: uno
    // splice(from,1) + splice(want,0,item) riproduce esattamente la
    // stessa destinazione dell'insertBefore del mockup (verificato in
    // entrambe le direzioni), senza bisogno di distinguere i due casi.
    const map = new Map<string, DOMRect>()
    kids.forEach(el => { if (el.dataset.key) map.set(el.dataset.key, el.getBoundingClientRect()) })
    preRects.current = map
    setOrder(prev => {
      const from = prev.indexOf(ds.key)
      if (from < 0) return prev
      const next = [...prev]
      next.splice(from, 1)
      next.splice(want, 0, ds.key)
      return next
    })
  }
  function endItemDrag() {
    const ds = dragState.current
    if (!ds) return
    dragState.current = null
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(ds.key)}"]`)
    if (el) {
      el.style.transition = 'none'
      el.style.transform = ''
      const t = el.getBoundingClientRect()
      ds.ghost.style.transition = 'left .28s cubic-bezier(.32,.72,0,1),top .28s cubic-bezier(.32,.72,0,1),transform .28s cubic-bezier(.32,.72,0,1)'
      ds.ghost.style.left = t.left + 'px'
      ds.ghost.style.top = t.top + 'px'
      ds.ghost.style.transform = 'scale(1)'
      el.classList.remove('dock-nav-holder')
    }
    setTimeout(() => ds.ghost.remove(), 290)
    persistOrder(userId, area, orderRef.current)
  }
  // persistOrder ha bisogno dell'ordine più recente in un handler nativo
  // (endItemDrag può girare dopo un setState non ancora committato) —
  // un ref speculare allo stato evita di richiudere su un valore stantio.
  const orderRef = useRef(order)
  useEffect(() => { orderRef.current = order }, [order])

  async function handleLogout() {
    await onLogout()
  }

  const dockKeys = order.slice(0, Math.min(NDOCK, order.length))
  const toneStyle = { '--dock-tone': tone } as React.CSSProperties

  return (
    <div style={toneStyle}>
      {homeHref && (
        <Link
          href={homeHref}
          aria-label="Torna alla Home"
          className="fixed right-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-[var(--dock-tone)]"
          style={{ borderColor: undefined }}
        >
          <Home className="h-4 w-4" />
        </Link>
      )}

      <div
        ref={scrimRef}
        className="fixed inset-0 z-30 bg-black/50 opacity-0"
        style={{ pointerEvents: 'none' }}
        onClick={closePanel}
      />

      <div ref={clipRef} className="fixed left-0 right-0 top-0 z-30 overflow-hidden" style={{ pointerEvents: 'none' }}>
        <div
          ref={panelRef}
          className="dock-nav-sheet pointer-events-auto absolute inset-x-0 bottom-0 rounded-t-lg border-t border-border shadow-[0_-18px_50px_rgba(0,0,0,.35)]"
          style={{ willChange: 'transform' }}
        >
          <button
            type="button"
            aria-label="Apri o chiudi il menu"
            className="block w-full touch-none py-2.5 pb-2"
            onPointerDown={onGrabPointerDown}
            onPointerMove={onGrabPointerMove}
            onPointerUp={fineTrascinamento}
            onPointerCancel={fineTrascinamento}
          >
            <span ref={grabBarRef} className="mx-auto block h-1 w-10 rounded-full bg-muted-foreground/40" />
          </button>

          <div ref={padRef} className="px-3.5 pb-1 pt-0.5">
            {areaLinks && areaLinks.length > 1 && (
              <div className="mb-3 flex gap-1.5">
                {areaLinks.map(a => (
                  <Link
                    key={a.key}
                    href={a.href}
                    className={cn(
                      'flex-1 rounded-md border px-1 py-2 text-center text-[11.5px] font-bold transition-colors',
                      a.key === area
                        ? 'border-[var(--dock-tone)] bg-[var(--dock-tone)] text-background'
                        : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {a.label}
                  </Link>
                ))}
              </div>
            )}

            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {edit ? 'Riordina le sezioni' : 'Tutte le sezioni'}
              </h3>
              <button
                type="button"
                onClick={toggleEdit}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition-colors',
                  edit
                    ? 'border-[var(--dock-tone)] bg-[var(--dock-tone)] text-background'
                    : 'border-[color-mix(in_srgb,var(--dock-tone)_40%,transparent)] text-[var(--dock-tone)]'
                )}
              >
                {edit ? 'Fine' : 'Modifica'}
              </button>
            </div>
            {edit && (
              <p className="mb-2 text-[10.5px] leading-tight text-muted-foreground">
                Trascina le icone per riordinarle. Le prime quattro — la riga in alto — sono quelle che restano nella barra in basso.
              </p>
            )}

            <div
              ref={gridRef}
              className="relative mb-2.5 grid grid-cols-4 gap-2"
              onPointerMove={onGridPointerMove}
              onPointerUp={endItemDrag}
              onPointerCancel={endItemDrag}
            >
              {order.map((key, i) => {
                const it = itemByKey.get(key)
                if (!it) return null
                const Icon = it.icon
                return (
                  <button
                    key={key}
                    type="button"
                    data-key={key}
                    onPointerDown={e => onItemPointerDown(e, key)}
                    onClick={() => { if (!editRef.current) router.push(it.href) }}
                    className={cn(
                      'dock-nav-grid-item relative flex touch-none flex-col items-center gap-1.5 rounded-md border border-border bg-card px-1 py-3 transition-colors',
                      pathname === it.href || pathname.startsWith(it.href + '/') ? 'bg-[color-mix(in_srgb,var(--dock-tone)_15%,transparent)] border-[var(--dock-tone)]' : undefined,
                      edit && i < NDOCK ? 'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--dock-tone)_55%,transparent)]' : undefined,
                      edit ? 'cursor-grab' : undefined
                    )}
                  >
                    <Icon className="h-5 w-5 pointer-events-none" style={{ color: tone }} />
                    <span className="pointer-events-none text-center text-[10px] font-semibold leading-tight">{it.label}</span>
                    {!!it.badge && it.badge > 0 && (
                      <span className="pointer-events-none absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#FF8A6B] px-1 text-[9px] font-extrabold text-[#1A0D08]">
                        {it.badge > 99 ? '99+' : it.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="mb-1 flex gap-2 border-t border-border pt-2.5">
              {homeHref && (
                <Link
                  href={homeHref}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-muted/40 py-2.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-[var(--dock-tone)]"
                >
                  <Home className="h-4 w-4" /> Home
                </Link>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-muted/40 py-2.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
              >
                <LogOut className="h-4 w-4" /> Esci
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        ref={dockRef}
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-[color-mix(in_srgb,var(--color-background)_96%,transparent)] px-1.5 pb-[max(env(safe-area-inset-bottom),9px)] pt-1 backdrop-blur-lg"
      >
        {dockKeys.map(key => {
          const it = itemByKey.get(key)
          if (!it) return null
          const Icon = it.icon
          const active = pathname === it.href || pathname.startsWith(it.href + '/')
          return (
            <Link
              key={key}
              href={it.href}
              className={cn('relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md px-0.5 py-1.5 text-muted-foreground transition-colors', active && 'text-[var(--dock-tone)]')}
              style={active ? { color: tone } : undefined}
            >
              <Icon className="h-5 w-5" />
              <span className="max-w-full truncate text-[9.5px] font-semibold">{it.label}</span>
              {!!it.badge && it.badge > 0 && (
                <span className="absolute right-[calc(50%-15px)] top-1 h-1.5 w-1.5 rounded-full border-[1.5px] border-background bg-[#FF8A6B]" />
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
