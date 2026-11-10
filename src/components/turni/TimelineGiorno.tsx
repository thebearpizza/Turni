'use client'
import { Fragment, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { MANIGLIA_TURNO, TINTA_TURNO, tipoTurno } from '@/lib/turnColors'
import type { Turn } from '@/types'
import { WD, durata, giornoLungo, hm, numeroGiorno, toM } from './comuni'

// Vista Giorno del tablet (MTTurni, isDay): scelta del giorno, ore 09→02 in
// 17 colonne, una riga per dipendente raggruppata per reparto. Un turno si
// trascina per spostarlo, dai bordi si allunga o accorcia; trascinando su
// uno spazio vuoto se ne disegna uno nuovo (1 h di partenza). Scatti di 15
// minuti. Un tocco senza trascinare apre la modifica.

export interface RigaTimeline { id: string; nome: string; turni: Turn[] }
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

export function TimelineGiorno({ giorni, sel, onSel, oggi, adesso, gruppi, onSposta, onCrea, onTocca }: {
  giorni: string[]; sel: number; onSel: (i: number) => void; oggi: string; adesso: number
  gruppi: GruppoTimeline[]
  onSposta: (t: Turn, a: number, b: number) => Promise<unknown>
  onCrea: (userId: string, a: number, b: number) => Promise<unknown>
  onTocca: (t: Turn) => void
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

  const cols = '190px minmax(0,1fr)'
  const griglia = `repeating-linear-gradient(90deg,var(--linea-ora) 0 1px,transparent 1px calc(100% / ${NORE}))`

  return (
    <div className="anim-swapin flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-border bg-card [--linea-ora:oklch(0.93_0.01_250)] dark:[--linea-ora:oklch(0.27_0.01_250)]">
      <div className="flex flex-none gap-1.5 border-b border-border px-3 py-2.5">
        {giorni.map((g, i) => {
          const on = i === sel
          return (
            <button
              key={g} type="button" onClick={() => onSel(i)}
              className={cn('flex h-12 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[8px] border transition-[background-color,color] duration-200 active:scale-[0.97]',
                on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground')}
            >
              <span className="text-xs font-medium opacity-80">{WD[i]}</span>
              <span className="font-mono text-base font-semibold">{numeroGiorno(g)}</span>
            </button>
          )
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid flex-none border-b border-border bg-[oklch(0.97_0.01_250)] dark:bg-[oklch(0.23_0.01_250)]" style={{ gridTemplateColumns: cols }}>
          <span className="truncate whitespace-nowrap px-4 py-[9px] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground">{giornoLungo(giorno)}</span>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${NORE},minmax(0,1fr))` }}>
            {ore.map((h, i) => <span key={i} className="border-l border-[oklch(0.92_0.01_250)] py-[9px] pl-1 font-mono text-[11px] font-medium text-[oklch(0.5_0.01_250)] dark:border-[oklch(0.28_0.01_250)] dark:text-muted-foreground">{h}</span>)}
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {gruppi.map(g => (
            <Fragment key={g.n}>
              <div className={cn('flex items-center border-b bg-[oklch(0.96_0.01_250)] px-4 py-[7px] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground dark:bg-[oklch(0.22_0.01_250)]', BORDO_FINE)}>{g.n}</div>
              {g.righe.map(r => {
                const barre = r.turni.filter(t => !t.is_rest_day).map(t => {
                  const tr = trascina?.id === t.id ? trascina : null
                  return { t, ...(tr ?? asse(t)), attivo: !!tr }
                })
                const bozza = nuovo?.uid === r.id ? nuovo : null
                return (
                  <div key={r.id} className={cn('grid h-14 border-b', BORDO_FINE)} style={{ gridTemplateColumns: cols }}>
                    <span className="flex items-center truncate whitespace-nowrap px-4 text-sm font-medium">{r.nome}</span>
                    <div data-track="1" onPointerDown={e => premiTraccia(e, r.id)} className="relative touch-none" style={{ backgroundImage: griglia }}>
                      {barre.map(({ t, a, b, attivo }) => {
                        const tipo = tipoTurno(t)
                        return (
                          <div
                            key={t.id} onPointerDown={e => premiBarra(e, t, 'move')}
                            className={cn('absolute bottom-2 top-2 box-border flex cursor-grab touch-none select-none items-center justify-between rounded-[7px] border px-3.5 font-mono text-xs font-medium', TINTA_TURNO[tipo], attivo && 'shadow-[0_6px_18px_rgba(20,30,50,.18)]')}
                            style={{ left: pct(a) + '%', width: pct(b) - pct(a) + '%' }}
                          >
                            <div onPointerDown={e => premiBarra(e, t, 'l')} className="absolute -left-px bottom-0 top-0 flex w-4 cursor-ew-resize items-center justify-center"><span className={cn('h-[18px] w-[3px] rounded-[2px]', MANIGLIA_TURNO[tipo])} /></div>
                            <span>{hm(a)}</span><span>{hm(b)}</span>
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
      <div className="flex-none text-pretty border-t border-border px-4 py-2.5 text-[12.5px] text-muted-foreground">
        Trascina un turno per spostarlo, i bordi per allungarlo o accorciarlo, uno spazio vuoto per crearne uno nuovo. Scatti di 15 minuti.
      </div>
    </div>
  )
}
