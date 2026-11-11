'use client'
import { Fragment, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { MANIGLIA_TURNO, TINTA_TURNO, tipoTurno } from '@/lib/turnColors'
import type { Turn } from '@/types'
import { WD, durata, giornoLungo, hm, nomeBreve, numeroGiorno, toM } from './comuni'

// Vista Giorno del tablet (MTTurni, isDay): scelta del giorno, ore 09→02 in
// 17 colonne, una riga per dipendente raggruppata per reparto. Un turno si
// trascina per spostarlo, dai bordi si allunga o accorcia; trascinando su
// uno spazio vuoto se ne disegna uno nuovo (1 h di partenza). Scatti di 15
// minuti. Un tocco senza trascinare apre la modifica.
//
// Sul telefono è la vista con cui si apre Turni: nomi brevi in 84 px, ore
// segnate una sì e una no, orario compatto nelle barre. Le righe non si
// disegnano col dito (la traccia deve lasciar scorrere l'elenco in
// verticale): un tocco sullo spazio vuoto apre "Nuovo turno" per quella
// persona, e il riposo del giorno è una fascia che si tocca per modificarlo.

export interface RigaTimeline {
  id: string; nome: string; turni: Turn[]
  /** Assenza approvata del giorno (etichetta: Ferie, Malattia...), o null. */
  assenza?: string | null
}
export interface GruppoTimeline { n: string; righe: RigaTimeline[] }

const SNAP = 15
const BORDO_FINE = 'border-[oklch(0.93_0.01_250)] dark:border-[oklch(0.27_0.01_250)]'

/** Inizio e fine in minuti sull'asse del giorno lavorativo (dopo le 24 si prosegue). */
function asse(t: Turn) {
  let a = toM(t.start_time)
  // Un inizio prima delle 5 è dopo mezzanotte: stesso giorno lavorativo.
  if (a < 300) a += 1440
  return { a, b: a + durata(t.start_time, t.end_time) }
}
// "18–23:30": minuti solo se servono, per le barre strette del telefono.
const fm = (m: number) => { const s = hm(m); return s.endsWith(':00') ? s.slice(0, 2) : s }

export function TimelineGiorno({ tel = false, giorni, sel, onSel, oggi, adesso, gruppi, onSposta, onCrea, onTocca, onVuota }: {
  tel?: boolean
  giorni: string[]; sel: number; onSel: (i: number) => void; oggi: string; adesso: number
  gruppi: GruppoTimeline[]
  onSposta: (t: Turn, a: number, b: number) => Promise<unknown>
  onCrea: (userId: string, a: number, b: number) => Promise<unknown>
  onTocca: (t: Turn) => void
  /** Telefono: tocco sullo spazio vuoto della riga di un dipendente. */
  onVuota?: (userId: string) => void
}) {
  const [trascina, setTrascina] = useState<{ id: string; a: number; b: number } | null>(null)
  const [nuovo, setNuovo] = useState<{ uid: string; a: number; b: number } | null>(null)
  const stacca = useRef<(() => void) | null>(null)
  useEffect(() => () => stacca.current?.(), [])

  // Finestra del design 09→02; si allarga solo se un turno del giorno esce.
  const tutti = gruppi.flatMap(g => g.righe.flatMap(r => r.turni.filter(t => !t.is_rest_day).map(asse)))
  const H0 = Math.min(540, ...tutti.map(x => Math.floor(x.a / 60) * 60))
  const FINE = Math.max(26 * 60, ...tutti.map(x => Math.ceil(x.b / 60) * 60))
  const SPAN = FINE - H0, NORE = SPAN / 60
  const pct = (m: number) => ((m - H0) / SPAN) * 100
  const ore = Array.from({ length: NORE }, (_, i) => String((H0 / 60 + i) % 24).padStart(2, '0'))
  const giorno = giorni[sel]
  let ora = adesso
  if (ora < H0) ora += 1440
  const conOra = giorno === oggi && ora >= H0 && ora <= FINE

  function ascolta(mv: (e: PointerEvent) => void, up: () => void) {
    const fine = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', fine); window.removeEventListener('pointercancel', fine); stacca.current = null; up() }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', fine)
    window.addEventListener('pointercancel', fine)
    stacca.current = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', fine); window.removeEventListener('pointercancel', fine) }
  }

  function premiBarra(e: React.PointerEvent, t: Turn, modo: 'move' | 'l' | 'r') {
    e.stopPropagation(); e.preventDefault()
    const track = (e.currentTarget as HTMLElement).closest('[data-track]')
    if (!track) return
    const W = track.getBoundingClientRect().width, x0 = e.clientX
    const { a: a0, b: b0 } = asse(t)
    let mosso = false, cur = { a: a0, b: b0 }
    ascolta(ev => {
      if (Math.abs(ev.clientX - x0) > 4) mosso = true
      if (!mosso) return
      const dm = Math.round(((ev.clientX - x0) / W) * SPAN / SNAP) * SNAP
      let a = a0, b = b0
      if (modo === 'move') { const len = b0 - a0; a = Math.min(Math.max(H0, a0 + dm), FINE - len); b = a + len }
      else if (modo === 'l') a = Math.max(H0, Math.min(b - 30, a0 + dm))
      else b = Math.min(FINE, Math.max(a + 30, b0 + dm))
      cur = { a, b }
      setTrascina({ id: t.id, a, b })
    }, () => {
      if (!mosso) { setTrascina(null); onTocca(t); return }
      if (cur.a === a0 && cur.b === b0) { setTrascina(null); return }
      onSposta(t, cur.a, cur.b).finally(() => setTrascina(null))
    })
  }

  function premiTraccia(e: React.PointerEvent, uid: string) {
    if (e.button !== 0) return
    e.preventDefault()
    const R = (e.currentTarget as HTMLElement).getBoundingClientRect(), x0 = e.clientX
    const m0 = Math.min(FINE - 60, H0 + Math.round(((x0 - R.left) / R.width) * SPAN / SNAP) * SNAP)
    let cur = { a: m0, b: m0 + 60 }
    setNuovo({ uid, ...cur })
    ascolta(ev => {
      const b = Math.max(m0 + 30, Math.min(FINE, m0 + 60 + Math.round(((ev.clientX - x0) / R.width) * SPAN / SNAP) * SNAP))
      cur = { a: m0, b }
      setNuovo({ uid, ...cur })
    }, () => { onCrea(uid, cur.a, cur.b).finally(() => setNuovo(null)) })
  }

  const cols = tel ? '84px minmax(0,1fr)' : '190px minmax(0,1fr)'
  const griglia = `repeating-linear-gradient(90deg,var(--linea-ora) 0 1px,transparent 1px calc(100% / ${NORE}))`

  return (
    <div className="anim-swapin flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-border bg-card [--linea-ora:oklch(0.93_0.01_250)] dark:[--linea-ora:oklch(0.27_0.01_250)]">
      <div className={cn('flex flex-none border-b border-border py-2.5', tel ? 'gap-1 px-2' : 'gap-1.5 px-3')}>
        {giorni.map((g, i) => {
          const on = i === sel
          return (
            <button
              key={g} type="button" onClick={() => onSel(i)}
              className={cn('relative flex h-12 min-w-0 flex-1 items-center justify-center rounded-[8px] border transition-[background-color,color] duration-200 active:scale-[0.97]',
                tel ? 'flex-col' : 'gap-1.5', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground')}
            >
              <span className="text-xs font-medium opacity-80">{WD[i]}</span>
              <span className={cn('font-mono text-base font-semibold', tel && 'leading-5')}>{numeroGiorno(g)}</span>
              {tel && g === oggi && <span className={cn('absolute bottom-[3px] h-1 w-1 rounded-full', on ? 'bg-primary-foreground' : 'bg-[oklch(0.58_0.12_180)]')} />}
            </button>
          )
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid flex-none border-b border-border bg-[oklch(0.97_0.01_250)] dark:bg-[oklch(0.23_0.01_250)]" style={{ gridTemplateColumns: cols }}>
          <span className={cn('truncate whitespace-nowrap py-[9px] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground', tel ? 'px-2.5' : 'px-4')}>{tel ? `${WD[sel]} ${numeroGiorno(giorno)}` : giornoLungo(giorno)}</span>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${NORE},minmax(0,1fr))` }}>
            {ore.map((h, i) => <span key={i} className={cn('whitespace-nowrap border-l border-[oklch(0.92_0.01_250)] py-[9px] font-mono text-[11px] font-medium text-[oklch(0.5_0.01_250)] dark:border-[oklch(0.28_0.01_250)] dark:text-muted-foreground', tel ? 'pl-0.5' : 'pl-1')}>{tel && i % 2 ? '' : h}</span>)}
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {gruppi.map(g => (
            <Fragment key={g.n}>
              <div className={cn('flex items-center border-b bg-[oklch(0.96_0.01_250)] py-[7px] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground dark:bg-[oklch(0.22_0.01_250)]', tel ? 'px-2.5' : 'px-4', BORDO_FINE)}>{g.n}</div>
              {g.righe.map(r => {
                const barre = r.turni.filter(t => !t.is_rest_day).map(t => {
                  const tr = trascina?.id === t.id ? trascina : null
                  return { t, ...(tr ?? asse(t)), attivo: !!tr }
                })
                const bozza = nuovo?.uid === r.id ? nuovo : null
                const riposo = tel ? r.turni.find(t => t.is_rest_day) : undefined
                return (
                  <div key={r.id} className={cn('grid h-14 border-b', BORDO_FINE)} style={{ gridTemplateColumns: cols }}>
                    <span className={cn('flex min-w-0 items-center font-medium', tel ? 'pl-2.5 pr-1.5 text-[13px]' : 'px-4 text-sm')}><span className="truncate whitespace-nowrap">{tel ? nomeBreve(r.nome) : r.nome}</span></span>
                    <div
                      data-track="1"
                      onPointerDown={tel ? undefined : e => premiTraccia(e, r.id)}
                      // Il tocco su una barra arriva qui come click: conta solo lo spazio
                      // vuoto, e non nei giorni di ferie o malattia (come nella settimana).
                      onClick={tel && onVuota ? e => { if (e.target === e.currentTarget && !r.assenza) onVuota(r.id) } : undefined}
                      className={cn('relative', !tel && 'touch-none')} style={{ backgroundImage: griglia }}
                    >
                      {/* Ferie e malattie approvate in rosso, come nella griglia della settimana. */}
                      {r.assenza && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-2 top-2 flex items-center overflow-hidden whitespace-nowrap rounded-[7px] bg-neg-tint px-2.5 text-xs font-medium text-neg">{r.assenza}</div>
                      )}
                      {riposo && (
                        <button type="button" onClick={() => onTocca(riposo)} className={cn('absolute inset-x-0 bottom-2 top-2 flex items-center overflow-hidden whitespace-nowrap rounded-[7px] border px-2.5 text-xs font-medium active:scale-[0.99]', TINTA_TURNO.riposo)}>Riposo</button>
                      )}
                      {barre.map(({ t, a, b, attivo }) => {
                        const tipo = tipoTurno(t)
                        return (
                          <div
                            key={t.id} onPointerDown={e => premiBarra(e, t, 'move')}
                            className={cn('absolute bottom-2 top-2 box-border flex cursor-grab touch-none select-none items-center overflow-hidden whitespace-nowrap rounded-[7px] border font-mono font-medium',
                              tel ? 'justify-center px-2 text-[11px]' : 'justify-between px-3.5 text-xs', TINTA_TURNO[tipo], attivo && 'shadow-[0_6px_18px_rgba(20,30,50,.18)]')}
                            style={{ left: pct(a) + '%', width: pct(b) - pct(a) + '%' }}
                          >
                            <div onPointerDown={e => premiBarra(e, t, 'l')} className="absolute -left-px bottom-0 top-0 flex w-4 cursor-ew-resize items-center justify-center"><span className={cn('h-[18px] w-[3px] rounded-[2px]', MANIGLIA_TURNO[tipo])} /></div>
                            {tel ? <span>{fm(a)}–{fm(b)}</span> : <><span>{hm(a)}</span><span>{hm(b)}</span></>}
                            <div onPointerDown={e => premiBarra(e, t, 'r')} className="absolute -right-px bottom-0 top-0 flex w-4 cursor-ew-resize items-center justify-center"><span className={cn('h-[18px] w-[3px] rounded-[2px]', MANIGLIA_TURNO[tipo])} /></div>
                          </div>
                        )
                      })}
                      {bozza && (
                        <div
                          className={cn('pointer-events-none absolute bottom-2 top-2 box-border flex items-center justify-between rounded-[7px] border px-3.5 font-mono text-xs font-medium shadow-[0_6px_18px_rgba(20,30,50,.18)]', TINTA_TURNO.standard)}
                          style={{ left: pct(bozza.a) + '%', width: pct(bozza.b) - pct(bozza.a) + '%' }}
                        >
                          <span>{hm(bozza.a)}</span><span>{hm(bozza.b)}</span>
                        </div>
                      )}
                      {conOra && <div className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-[oklch(0.6_0.16_25)]" style={{ left: pct(ora) + '%' }} />}
                    </div>
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
      {/* Sul telefono la nota toglierebbe due righe all'elenco: i gesti sono
          gli stessi del tablet e il tocco sul vuoto apre il modulo. */}
      {!tel && (
      <div className={cn('flex-none text-pretty border-t border-border text-muted-foreground', 'px-4 py-2.5 text-[12.5px]')}>
        Trascina un turno per spostarlo, i bordi per allungarlo o accorciarlo, uno spazio vuoto per crearne uno nuovo. Scatti di 15 minuti.
      </div>
      )}
    </div>
  )
}
