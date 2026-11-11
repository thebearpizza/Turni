'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import type { Tono } from '@/lib/analisi'
import { TONO_TESTO } from '@/lib/analisi'

// Le due sovrapposizioni del design Manager Analisi:
// - il foglio di dettaglio (pannello a destra su tablet, a tutto schermo
//   su telefono) con navigazione a pila e tasto indietro;
// - il fumetto ancorato all'elemento toccato, per i dettagli brevi.

export interface Figlio { l: string; s?: string; v: string }
export interface Sotto { l: string; s?: string; v: string; dot?: string; figli?: Figlio[] }
export type Riga =
  | { tipo: 'link'; l: string; s?: string; v: string; tono?: Tono; dot?: string; apri: () => void }
  | { tipo: 'stat'; l: string; v: string; tono?: Tono }
  | { tipo: 'espandi'; l: string; v: string; sotto: Sotto[] }
export interface Sezione { h: string; dot?: string; righe: Riga[] }
export interface Scheda {
  titolo: string
  sotto: string
  stats: { l: string; v: string; tono?: Tono }[]
  sezioni: Sezione[]
  azione?: { l: string; fai: () => void }
}

/** Durata dell'animazione di uscita: il genitore svuota il contenuto dopo. */
export const USCITA_MS = 320

function Chevron({ giu, aperto }: { giu?: boolean; aperto?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      className="flex-none text-muted-foreground transition-transform duration-300" style={{ transform: giu ? `rotate(${aperto ? 180 : 0}deg)` : undefined }} aria-hidden>
      <path d={giu ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}

function RigaEspandibile({ r }: { r: Extract<Riga, { tipo: 'espandi' }> }) {
  const [aperta, setAperta] = useState(false)
  const [sub, setSub] = useState<string | null>(null)
  return (
    <div className={cn('flex flex-col rounded-[10px] transition-colors duration-200', aperta && 'bg-[oklch(0.965_0.01_250)] dark:bg-secondary')}>
      <button type="button" onClick={() => setAperta(a => !a)} className="flex min-h-10 items-center gap-2.5 rounded-[10px] px-3 py-1 text-left active:scale-[0.98]">
        <span className="flex-1 text-[14px] text-[oklch(0.35_0.01_250)] dark:text-foreground/80">{r.l}</span>
        <span className="font-mono text-[14px] font-medium">{r.v}</span>
        <Chevron giu aperto={aperta} />
      </button>
      {aperta && (
        <div className="flex flex-col gap-0.5 px-3 pb-2.5">
          {r.sotto.length === 0 && <span className="px-2.5 py-2 text-xs text-muted-foreground">Nessuna voce</span>}
          {r.sotto.map((x, i) => {
            const k = `${x.l}|${i}`, on = sub === k
            return (
              <div key={k} className="anim-swapin flex flex-col rounded-[8px] bg-card" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
                <button type="button" disabled={!x.figli} onClick={() => setSub(on ? null : k)} className="flex min-h-11 items-center gap-2.5 rounded-[8px] px-2.5 text-left disabled:cursor-default">
                  {x.dot && <span className="h-2 w-2 flex-none rounded-[2px]" style={{ background: x.dot }} />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-medium">{x.l}</span>
                    {x.s && <span className="text-[11px] text-muted-foreground">{x.s}</span>}
                  </span>
                  <span className="font-mono text-[13px] font-medium">{x.v}</span>
                  {x.figli && <Chevron giu aperto={on} />}
                </button>
                {on && x.figli && (
                  <div className="flex flex-col px-2.5 pb-2 pl-7">
                    {x.figli.map((f, j) => (
                      <div key={j} className="anim-swapin flex min-h-[38px] items-center gap-2.5 border-t border-border" style={{ animationDelay: `${Math.min(j, 10) * 30}ms` }}>
                        <span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-[12.5px] font-medium">{f.l}</span>{f.s && <span className="text-[11px] text-muted-foreground">{f.s}</span>}</span>
                        <span className="font-mono text-[12.5px] font-medium">{f.v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Foglio di dettaglio a pila: `pila` è la lista delle schede aperte. */
export function FoglioDettaglio({ pila, esce, onIndietro, onChiudi }: { pila: Scheda[]; esce: boolean; onIndietro: () => void; onChiudi: () => void }) {
  const aperto = pila.length > 0 && !esce
  const sc = pila[pila.length - 1]

  useEffect(() => {
    if (!aperto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onChiudi() }
    window.addEventListener('keydown', esc)
    const prima = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = prima }
  }, [aperto, onChiudi])

  if (!sc) return null
  return createPortal(
    <div className={cn('fixed inset-0 z-[80] transition-colors duration-300', esce ? 'bg-transparent' : 'bg-[rgba(15,20,30,.22)]')} onClick={onChiudi}>
      <div
        role="dialog" aria-modal="true" aria-label={sc.titolo}
        onClick={e => e.stopPropagation()}
        className={cn('absolute inset-2 flex flex-col overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_20px_60px_rgba(20,30,50,.18)] sm:inset-auto sm:bottom-6 sm:right-6 sm:top-[84px] sm:w-[520px]', esce ? 'anim-swapout' : 'anim-swapin')}
      >
        <div className="flex flex-none items-center gap-1.5 border-b border-border py-3 pl-3.5 pr-3">
          {pila.length > 1 && (
            <button type="button" onClick={onIndietro} aria-label="Indietro" className="flex h-11 w-11 flex-none items-center justify-center rounded-full active:scale-[0.96]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
            </button>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-px pl-1.5">
            <span className="truncate text-[17px] font-semibold">{sc.titolo}</span>
            <span className="truncate text-[13px] text-muted-foreground">{sc.sotto}</span>
          </div>
          <button type="button" onClick={onChiudi} aria-label="Chiudi" className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-muted-foreground active:scale-[0.96]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div key={pila.length + sc.titolo} className="anim-swapin flex flex-col gap-[18px] px-3.5 pb-5 pt-4">
            {sc.stats.length > 0 && (
              <div className="grid grid-cols-2 gap-2 px-1">
                {sc.stats.map(st => (
                  <div key={st.l} className="flex flex-col gap-[3px] rounded-[10px] bg-background px-3.5 py-3">
                    <span className="text-xs text-muted-foreground">{st.l}</span>
                    <span className={cn('whitespace-nowrap font-mono text-[18px] font-semibold', st.tono && st.tono !== 'neutro' && TONO_TESTO[st.tono])}>{st.v}</span>
                  </div>
                ))}
              </div>
            )}
            {sc.sezioni.map(se => (
              <div key={se.h} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2 px-3 pb-1.5">
                  {se.dot && <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: se.dot }} />}
                  <span className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">{se.h}</span>
                </div>
                {se.righe.length === 0 && <span className="px-3 py-2 text-sm text-muted-foreground">Nessun dato</span>}
                {se.righe.map((r, i) => r.tipo === 'link' ? (
                  <button key={i} type="button" onClick={r.apri} className="flex min-h-[52px] items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-left hover:bg-background active:scale-[0.98]">
                    {r.dot && <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: r.dot }} />}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[14px] font-medium">{r.l}</span>
                      {r.s && <span className="text-xs text-muted-foreground">{r.s}</span>}
                    </span>
                    <span className={cn('whitespace-nowrap font-mono text-[14px] font-medium', r.tono && r.tono !== 'neutro' && TONO_TESTO[r.tono])}>{r.v}</span>
                    <Chevron />
                  </button>
                ) : r.tipo === 'stat' ? (
                  <div key={i} className="flex min-h-10 items-center gap-2.5 px-3">
                    <span className="flex-1 text-[14px] text-[oklch(0.35_0.01_250)] dark:text-foreground/80">{r.l}</span>
                    <span className={cn('whitespace-nowrap font-mono text-[14px] font-medium', r.tono && r.tono !== 'neutro' && TONO_TESTO[r.tono])}>{r.v}</span>
                  </div>
                ) : <RigaEspandibile key={i} r={r} />)}
              </div>
            ))}
            {sc.azione && (
              <button type="button" onClick={sc.azione.fai} className="mx-1 flex h-[52px] items-center justify-center rounded-[12px] bg-primary text-[15px] font-medium text-primary-foreground active:scale-[0.98]">
                {sc.azione.l}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Fumetto ──────────────────────────────────────────────────────────

export interface Pannello { titolo: string; sotto: string; figli: Figlio[] }
export interface RigaFumetto { l: string; v: string; p?: string; dot?: string; tono?: Tono; figli?: Figlio[]; pannello?: Pannello }
export interface Fumetto { id: number; titolo: string; sotto: string; righe: RigaFumetto[]; ancora: DOMRect }

export function FumettoAncorato({ f, esce, onChiudi }: { f: Fumetto | null; esce: boolean; onChiudi: () => void }) {
  // Nessun velo a tutto schermo: la pagina resta scorrevole. Lo scroll
  // della pagina chiude il fumetto (con l'animazione di uscita del
  // genitore), lo scroll DENTRO il fumetto no. Un tocco fuori lo chiude
  // e quel tocco non attiva altro, come faceva il velo del prototipo.
  useEffect(() => {
    if (!f || esce) return
    const dentro = (t: EventTarget | null) => t instanceof Node && !!(t instanceof Element ? t : t.parentElement)?.closest('[data-fumetto]')
    let inghiotti = false
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onChiudi() }
    const chiudi = () => onChiudi()
    const scorre = (e: Event) => { if (!dentro(e.target)) onChiudi() }
    const giu = (e: PointerEvent) => { if (!dentro(e.target)) { inghiotti = true; setTimeout(() => { inghiotti = false }, 600) } }
    const su = (e: PointerEvent) => { if (inghiotti && !dentro(e.target)) onChiudi() }
    const clic = (e: MouseEvent) => { if (inghiotti && !dentro(e.target)) { e.preventDefault(); e.stopPropagation(); inghiotti = false } }
    window.addEventListener('keydown', esc)
    window.addEventListener('resize', chiudi)
    document.addEventListener('scroll', scorre, true)
    document.addEventListener('pointerdown', giu, true)
    document.addEventListener('pointerup', su, true)
    document.addEventListener('click', clic, true)
    return () => {
      window.removeEventListener('keydown', esc); window.removeEventListener('resize', chiudi)
      document.removeEventListener('scroll', scorre, true); document.removeEventListener('pointerdown', giu, true)
      document.removeEventListener('pointerup', su, true); document.removeEventListener('click', clic, true)
    }
  }, [f, esce, onChiudi])
  if (!f) return null
  return createPortal(<CorpoFumetto key={f.id} f={f} esce={esce} />, document.body)
}

// Margini dai bordi dello schermo: in alto lo spazio di sicurezza, in
// basso anche la dock (circa 100 px) che altrimenti coprirebbe le righe.
const MARGINE_ALTO = 12
const MARGINE_BASSO = 104

// Posizione come nel prototipo: centrato sull'elemento (entro i bordi),
// sotto se l'elemento sta nei primi 300 px dello schermo, sopra altrimenti
// (o dal lato con più spazio se quello scelto è troppo stretto). L'altezza
// massima è quella che resta visibile: il resto scorre dentro il fumetto.
// Il pannello laterale (voci di una categoria) va a destra se c'è spazio,
// a sinistra altrimenti; su telefono scivola sotto/sopra il fumetto.
function CorpoFumetto({ f, esce }: { f: Fumetto; esce: boolean }) {
  const [aperta, setAperta] = useState<number | null>(null)
  const [lato, setLato] = useState<number | null>(null)
  const r = f.ancora, vw = window.innerWidth, vh = window.innerHeight
  const tel = vw < 640
  const cx = Math.max(Math.min(172, vw / 2), Math.min(vw - Math.min(172, vw / 2), r.left + r.width / 2))
  const spazioSotto = vh - MARGINE_BASSO - (r.bottom + 8), spazioSopra = r.top - 8 - MARGINE_ALTO
  let sotto = r.top < 300
  if ((sotto ? spazioSotto : spazioSopra) < 220 && (sotto ? spazioSopra : spazioSotto) > (sotto ? spazioSotto : spazioSopra)) sotto = !sotto
  const y = sotto ? r.bottom + 8 : r.top - 8
  const w = Math.min(320, vw - 24)
  const maxH = Math.max(120, Math.min(460, sotto ? spazioSotto : spazioSopra))
  const verticale = (yy: number, alto: number): React.CSSProperties => (sotto
    ? { top: yy, maxHeight: Math.max(120, Math.min(alto, vh - MARGINE_BASSO - yy)) }
    : { bottom: vh - yy, maxHeight: Math.max(120, Math.min(alto, yy - MARGINE_ALTO)) })
  const box: React.CSSProperties = { left: cx - w / 2, width: w, ...verticale(y, 460) }
  const pan = lato !== null ? f.righe[lato]?.pannello : undefined
  const aDestra = cx + 160 + 10 + 300 <= vw - 16
  const wp = Math.min(300, vw - 24)
  const boxPan: React.CSSProperties = tel
    ? { left: Math.max(12, Math.min(vw - 12 - wp, cx - wp / 2)), width: wp, ...verticale(y + (sotto ? 56 : -56), 420) }
    : { left: aDestra ? cx + 170 : cx - 170 - 300, width: 300, ...verticale(y, 420) }
  const anim = esce ? 'anim-swapout' : 'anim-swapin'

  return (
    <>
      <div data-fumetto="" className="fixed z-[82] flex flex-col" style={box} role="dialog" aria-label={f.titolo}>
        <div style={{ maxHeight: maxH }} className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[14px] border border-border bg-card shadow-[0_14px_40px_rgba(20,30,50,.16)]', anim)}>
          <div className="flex flex-col gap-2 px-4 py-3.5">
            <div className="flex flex-col gap-px">
              <span className="text-[15px] font-semibold">{f.titolo}</span>
              <span className="text-xs text-muted-foreground">{f.sotto}</span>
            </div>
            {f.righe.map((x, i) => (x.figli || x.pannello) ? (
              <div key={i} className={cn('-mx-2 flex flex-col rounded-[8px] transition-colors duration-200', (aperta === i || lato === i) && 'bg-[oklch(0.965_0.01_250)] dark:bg-secondary')}>
                <button type="button"
                  onClick={() => { if (x.pannello) setLato(lato === i ? null : i); else setAperta(aperta === i ? null : i) }}
                  className="flex min-h-10 items-center gap-2 rounded-[8px] px-2 text-left active:scale-[0.98]">
                  <span className="h-2 w-2 flex-none rounded-[2px]" style={{ background: x.dot }} />
                  <span className="flex-1 truncate text-[13px] font-medium">{x.l}</span>
                  <span className="whitespace-nowrap font-mono text-[13px] font-medium">{x.v}</span>
                  {x.p !== undefined && <span className="min-w-11 text-right font-mono text-[11px] font-medium text-muted-foreground">{x.p}</span>}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                    className="flex-none text-[oklch(0.6_0.01_250)] transition-transform duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]"
                    style={{ transform: `rotate(${x.pannello ? -90 : aperta === i ? 180 : 0}deg)` }}><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {aperta === i && x.figli && (
                  <div className="flex flex-col px-2 pb-1.5 pl-6">
                    {x.figli.map((k, j) => (
                      <div key={j} className="anim-swapin flex min-h-8 items-center gap-2 border-t border-[oklch(0.93_0.01_250)] dark:border-border" style={{ animationDelay: `${j * 40}ms` }}>
                        <span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-[12.5px] font-medium">{k.l}</span>{k.s && <span className="text-[11px] text-muted-foreground">{k.s}</span>}</span>
                        <span className="whitespace-nowrap font-mono text-[12.5px] font-medium">{k.v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div key={i} className="flex min-h-6 items-center gap-2">
                {x.dot && <span className="h-2 w-2 flex-none rounded-[2px]" style={{ background: x.dot }} />}
                <span className="flex-1 truncate text-[13px] text-[oklch(0.35_0.01_250)] dark:text-[oklch(0.35_0.01_250)] dark:text-foreground/80">{x.l}</span>
                <span className={cn('whitespace-nowrap font-mono text-[13px] font-medium', x.tono && x.tono !== 'neutro' && TONO_TESTO[x.tono])}>{x.v}</span>
                {x.p && <span className="min-w-11 text-right font-mono text-[11px] font-medium text-muted-foreground">{x.p}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
      {pan && (
        <div key={lato} data-fumetto="" className="fixed z-[83] flex flex-col" style={boxPan}>
          <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_14px_40px_rgba(20,30,50,.16)]', anim)}>
            <div className="flex flex-none flex-col gap-px px-4 pb-2 pt-3.5">
              <span className="text-[15px] font-semibold">{pan.titolo}</span>
              <span className="text-xs text-muted-foreground">{pan.sotto}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2.5">
              {pan.figli.map((k, q) => (
                <div key={q} className="anim-swapin flex min-h-10 items-center gap-2 border-t border-[oklch(0.93_0.01_250)] dark:border-border" style={{ animationDelay: `${Math.min(q, 10) * 30}ms` }}>
                  <span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-[13px] font-medium">{k.l}</span>{k.s && <span className="text-[11px] text-muted-foreground">{k.s}</span>}</span>
                  <span className="whitespace-nowrap font-mono text-[13px] font-medium">{k.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
