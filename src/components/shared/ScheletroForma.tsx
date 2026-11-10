'use client'
import { useEffect, useRef, useState } from 'react'

// Skeleton del design (Skeleton.dc.html): invece di un segnaposto generico
// misura ciò che c'è sotto e lo ridisegna con la stessa forma: righe di
// testo come barre con l'onda, pulsanti e icone come blocchi, card e
// riquadri con il loro sfondo e bordo. Si appoggia a un antenato con
// [data-sk-root]; gli elementi con [data-sk-keep] restano visibili.

const ONDA = 'linear-gradient(90deg,var(--sk-a) 0%,var(--sk-b) 50%,var(--sk-a) 100%)'

interface Pezzo { x: number; y: number; w: number; h: number; r: string; bgc: string; bgi: string; bs: string; bc: string; bw: string; mask: boolean; onda: boolean }
interface Rett { x: number; y: number; w: number; h: number }
interface Colore { a: number; L: number; C: number }

function col(s: string | null | undefined): Colore {
  if (!s || s === 'transparent') return { a: 0, L: 1, C: 0 }
  const f = (v: string) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v))
  let m = s.match(/^rgba?\(([^)]+)\)/)
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(f), mx = Math.max(p[0], p[1], p[2]), mn = Math.min(p[0], p[1], p[2])
    return { a: p.length > 3 ? p[3] : 1, L: (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255, C: ((mx - mn) / 255) * 0.4 }
  }
  m = s.match(/^ok(lch|lab)\(([^)]+)\)/)
  if (m) {
    const p = m[2].split(/[\s/]+/).filter(Boolean)
    return { a: p.length > 3 ? f(p[3]) : 1, L: f(p[0]), C: m[1] === 'lch' ? parseFloat(p[1]) || 0 : Math.hypot(parseFloat(p[1]) || 0, parseFloat(p[2]) || 0) }
  }
  m = s.match(/^color\(srgb ([^)]+)\)/)
  if (m) {
    const p = m[1].split(/[\s/]+/).filter(Boolean).map(f)
    return { a: p.length > 3 ? p[3] : 1, L: 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2], C: (Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2])) * 0.4 }
  }
  return { a: 1, L: 1, C: 0 }
}

function sfondoEffettivo(el: Element | null): string {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    const s = getComputedStyle(e).backgroundColor
    if (col(s).a > 0.5) return s
  }
  return 'var(--background)'
}

function misura(me: HTMLElement): { pezzi: Pezzo[]; sfondo: string } | null {
  const root = me.parentElement?.closest<HTMLElement>('[data-sk-root]')
  if (!root) return null
  const O = me.getBoundingClientRect(), W = me.offsetWidth, H = me.offsetHeight
  if (!W || !H) return null
  const z = O.width / W || 1
  const rel = (r: DOMRect | DOMRectReadOnly): Rett => ({ x: (r.left - O.left) / z, y: (r.top - O.top) / z, w: r.width / z, h: r.height / z })
  const clip = (r: Rett, c: Rett): Rett | null => {
    const x = Math.max(r.x, c.x), y = Math.max(r.y, c.y), x2 = Math.min(r.x + r.w, c.x + c.w), y2 = Math.min(r.y + r.h, c.y + c.h)
    return x2 - x >= 0.5 && y2 - y >= 0.5 ? { x, y, w: x2 - x, h: y2 - y } : null
  }
  const pezzo = (t: 'b' | 't' | 'f' | 'm', r: Rett, o: Partial<Pezzo> = {}): Pezzo => {
    const onda = t === 'b' || t === 't'
    return { x: r.x, y: r.y, w: r.w, h: r.h, r: o.r || '0px', bgc: onda ? 'transparent' : (o.bgc || 'transparent'), bgi: onda ? ONDA : (o.bgi || 'none'), bs: onda ? '200% 100%' : (o.bs || 'auto'), bc: o.bc || 'transparent', bw: o.bw || '0px', mask: t === 'm', onda }
  }
  const mine = (k: Element) => !!k.parentElement && k.parentElement.closest('[data-sk-root]') === root
  const tiene = (el: Element) => [...el.querySelectorAll('[data-sk-keep]')].some(mine)
  const parziale = tiene(root)
  const tutto: Rett = { x: 0, y: 0, w: W, h: H }
  const maschere: Pezzo[] = [], out: Pezzo[] = []

  const annidato = (el: Element) => {
    for (const d of el.querySelectorAll('*')) {
      if (d.namespaceURI === 'http://www.w3.org/2000/svg') continue
      const c = getComputedStyle(d)
      if (c.display === 'none') continue
      const box = col(c.backgroundColor).a > 0.05 || (parseFloat(c.borderTopWidth) > 0 && c.borderTopStyle !== 'none' && parseFloat(c.borderBottomWidth) > 0)
      if (box && d.getBoundingClientRect().height / z > 24) return true
    }
    return false
  }
  const testo = (n: Text, el: Element, c: Rett) => {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || col(cs.color).a < 0.05) return
    const fs = parseFloat(cs.fontSize) || 14, h = Math.max(6, Math.min(18, Math.round(fs * 0.72))), rd = h >= 12 ? '5px' : '3px'
    const rg = document.createRange()
    rg.selectNodeContents(n)
    for (const q of rg.getClientRects()) {
      const r = rel(q)
      if (r.w < 2) continue
      const b = clip({ x: r.x, y: r.y + (r.h - h) / 2, w: r.w, h }, c)
      if (b) out.push(pezzo('t', b, { r: rd }))
    }
  }
  const figli = (el: Element, c: Rett) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { if (/\S/.test(n.nodeValue ?? '')) testo(n as Text, el, c) }
      else if (n.nodeType === 1) cammina(n as Element, c)
    }
  }
  const cammina = (el: Element, c: Rett) => {
    if (el === me || el.hasAttribute('data-sk-layer') || el.hasAttribute('data-sk-skip') || (el.hasAttribute('data-sk-keep') && mine(el))) return
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return
    const tag = el.tagName.toLowerCase(), r = rel(el.getBoundingClientRect())
    if (r.w < 0.5 || r.h < 0.5) { figli(el, c); return }
    const v = clip(r, c)
    if (!v) return
    if (/^(svg|img|canvas|video|input|textarea|select)$/.test(tag)) {
      if (r.w > 10 || r.h > 10) out.push(pezzo('b', v, { r: tag === 'svg' ? (Math.min(r.w, r.h) <= 30 ? '6px' : '10px') : cs.borderRadius }))
      return
    }
    const bg = col(cs.backgroundColor), bi = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : ''
    if (/url\(/.test(bi)) { out.push(pezzo('b', v, { r: cs.borderRadius })); return }
    const lati = (['Top', 'Right', 'Bottom', 'Left'] as const).map(sd => {
      const w = parseFloat(cs.getPropertyValue(`border-${sd.toLowerCase()}-width`)) || 0, st = cs.getPropertyValue(`border-${sd.toLowerCase()}-style`)
      return w > 0 && st !== 'none' && st !== 'hidden' && col(cs.getPropertyValue(`border-${sd.toLowerCase()}-color`)).a > 0.05 ? { w, st } : null
    })
    if (bg.a < 0.05 && !bi && lati.some(x => x && (x.st === 'dashed' || x.st === 'dotted'))) return
    const conSfondo = bg.a > 0.05 || !!bi, bordoPieno = lati.every(Boolean)
    if (conSfondo || lati.some(Boolean)) {
      if (bg.a > 0.5 && bg.L < 0.55) { out.push(pezzo('b', v, { r: cs.borderRadius })); return }
      const piccolo = r.h <= 64, nest = piccolo ? annidato(el) : true, contenuto = piccolo && (/\S/.test(el.textContent ?? '') || !!el.querySelector('svg,img'))
      if (piccolo && !nest && contenuto && (bordoPieno || (conSfondo && r.w <= W * 0.6))) { out.push(pezzo('b', v, { r: cs.borderRadius })); return }
      if (piccolo && !nest && !contenuto && bg.a > 0.3 && bg.C > 0.03) { out.push(pezzo('b', v, { r: cs.borderRadius })); return }
      if (r.w > 12 || r.h > 12) {
        out.push(pezzo('f', v, {
          r: cs.borderRadius, bgc: cs.backgroundColor, bgi: bi || 'none', bs: bi ? cs.backgroundSize : 'auto',
          bc: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].join(' '),
          bw: lati.map(x => `${x ? x.w : 0}px`).join(' '),
        }))
      }
    }
    figli(el, cs.overflowX !== 'visible' || cs.overflowY !== 'visible' ? v : c)
  }
  const procedi = (el: Element, cima: boolean) => {
    for (const c of el.children) {
      if (c === me || c.contains(me) || c.hasAttribute('data-sk-layer') || (c.hasAttribute('data-sk-keep') && mine(c))) continue
      const cs = getComputedStyle(c)
      if (cs.display === 'none' || (cima && (cs.position === 'absolute' || cs.position === 'fixed'))) continue
      if (parziale && tiene(c)) { procedi(c, false); continue }
      if (parziale) { const r = clip(rel(c.getBoundingClientRect()), tutto); if (r) maschere.push(pezzo('m', r, { bgc: sfondoEffettivo(c.parentElement) })) }
      cammina(c, tutto)
    }
  }
  procedi(root, true)
  const pezzi = !parziale && !out.some(p => p.onda) ? riserva(W, H, pezzo) : out
  return { pezzi: maschere.concat(pezzi), sfondo: parziale ? 'transparent' : sfondoEffettivo(root) }
}

// Quando sotto non c'è ancora niente da misurare (primo caricamento):
// pillole, una card con intestazione e righe con un pulsante.
function riserva(W: number, H: number, pezzo: (t: 'b' | 't' | 'f', r: Rett, o?: Partial<Pezzo>) => Pezzo): Pezzo[] {
  const p = W < 600 ? 16 : 32, cw = W - 2 * p, out: Pezzo[] = []
  const it = (t: 'b' | 't' | 'f', x: number, y: number, w: number, h: number, o?: Partial<Pezzo>) => out.push(pezzo(t, { x, y, w, h }, o))
  let x = p
  for (const w of [92, 108, 96, 86]) { if (x + w <= W - p) it('b', x, 0, w, 40, { r: '999px' }); x += w + 6 }
  const y = 52, ch = Math.max(120, H - y - (W < 600 ? 104 : 120))
  it('f', p, y, cw, ch, { r: '12px', bgc: 'var(--card)', bc: 'var(--border)', bw: '1px' })
  it('f', p + 1, y + 1, cw - 2, 40, { r: '11px 11px 0 0', bgc: 'var(--sk-hd)' })
  it('t', p + 14, y + 16, Math.min(160, cw * 0.3), 9, { r: '3px' })
  for (let ry = y + 41; ry + 56 <= y + ch; ry += 56) {
    it('f', p + 1, ry, cw - 2, 1, { bgc: 'var(--sk-div)' })
    it('t', p + 14, ry + 15, cw * 0.32, 10, { r: '3px' })
    it('t', p + 14, ry + 32, cw * 0.2, 8, { r: '3px' })
    it('b', p + cw - 14 - 72, ry + 14, 72, 28, { r: '8px' })
  }
  return out
}

/** Strato a scheletro: va messo dentro un contenitore [data-sk-root] relative. */
export function ScheletroForma({ esce, className }: { esce: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [stato, setStato] = useState<{ pezzi: Pezzo[]; sfondo: string }>({ pezzi: [], sfondo: 'transparent' })
  const fermo = useRef(esce)
  useEffect(() => { fermo.current = esce }, [esce])

  useEffect(() => {
    const me = ref.current
    if (!me) return
    let raf = 0
    const aggiorna = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const m = misura(me); if (m) setStato(m) }) }
    // Come nel prototipo: una misura subito (niente fotogramma vuoto) e
    // una al fotogramma dopo, a layout assestato. La prima è in un
    // microtask per non chiamare setState in modo sincrono nell'effect.
    queueMicrotask(() => { const m = misura(me); if (m) setStato(m) })
    aggiorna()
    const root = me.parentElement?.closest('[data-sk-root]')
    const mo = root ? new MutationObserver(ms => { if (fermo.current || ms.every(m => me.contains(m.target))) return; aggiorna() }) : null
    if (root && mo) mo.observe(root, { childList: true, subtree: true, attributes: true, characterData: true })
    const tm = [90, 220, 450].map(d => setTimeout(() => { if (!fermo.current) aggiorna() }, d))
    return () => { cancelAnimationFrame(raf); mo?.disconnect(); tm.forEach(clearTimeout) }
  }, [])

  return (
    <div
      ref={ref}
      data-sk-layer=""
      aria-hidden
      className={className ?? 'absolute inset-0 z-[45] overflow-hidden'}
      style={{ backgroundColor: stato.sfondo, pointerEvents: esce || stato.sfondo === 'transparent' ? 'none' : 'auto', animation: esce ? 'sk-out 320ms cubic-bezier(0.4,0,1,1) both' : 'none' }}
    >
      {stato.pezzi.map((p, i) => (
        <div key={i} className="absolute box-border border-solid" style={{
          left: p.x, top: p.y, width: p.w, height: p.h, borderRadius: p.r, backgroundColor: p.bgc, backgroundImage: p.bgi,
          backgroundSize: p.bs, borderColor: p.bc, borderWidth: p.bw, pointerEvents: p.mask ? 'auto' : 'none',
          animation: p.onda ? 'sk-sh 1.6s ease-in-out infinite' : 'none',
        }} />
      ))}
    </div>
  )
}
