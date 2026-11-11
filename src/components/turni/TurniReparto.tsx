'use client'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Turn } from '@/types'
import { ModificaTurno, type SalvaModifica } from './ModificaTurno'
import { USCITA, WD, WDL, durata, etichettaSettimanaBreve, giornoLungo, hm, nomeBreve, numeroGiorno, toM } from './comuni'

// Turni del reparto del capo servizio sul telefono (Capo Servizio.dc.html,
// "Turni sala"): striscia dei giorni, timeline del giorno con le barre
// trascinabili (centro per spostare, bordi per inizio e fine, scatti di 15
// minuti), malattie e ferie in rosso, "+ Aggiungi turno" e la scheda di
// modifica al posto della timeline. Niente "Pubblica": i turni sono subito
// visibili ai dipendenti.

export interface AssenzaReparto { user_id: string; type: string; start_date: string; end_date: string }

const SNAP = 15
const ETICHETTA_ASSENZA: Record<string, string> = { malattia: 'Malattia', ferie: 'Ferie', riposo: 'Riposo', assenza_ingiustificata: 'Assente' }

function asse(t: Turn) {
  let a = toM(t.start_time)
  if (a < 300) a += 1440
  return { a, b: a + durata(t.start_time, t.end_time) }
}
// "18–23:30": minuti solo se servono, come nel prototipo.
const fm = (m: number) => { const s = hm(m); return s.endsWith(':00') ? s.slice(0, 2) : s }

export function TurniReparto({ reparto, lunedi, giorni, oggi, staff, turni, assenze, onSettimana, onSposta, onSalva, onElimina, onAggiungi }: {
  reparto: string
  lunedi: string
  giorni: string[]
  oggi: string
  staff: { id: string; full_name: string }[]
  turni: Turn[]
  assenze: AssenzaReparto[]
  onSettimana: (delta: number | null) => void
  onSposta: (t: Turn, a: number, b: number) => Promise<unknown>
  onSalva: (t: Turn, v: SalvaModifica) => Promise<boolean>
  onElimina: (t: Turn) => Promise<boolean>
  onAggiungi: (giorno: number) => void
}) {
  const iOggi = giorni.indexOf(oggi)
  const [sel, setSel] = useState(iOggi >= 0 ? iOggi : 0)
  const [edit, setEdit] = useState<Turn | null>(null)
  const [tOut, setTOut] = useState(false)
  const [menu, setMenu] = useState(false)
  const [trascina, setTrascina] = useState<{ id: string; a: number; b: number } | null>(null)
  const [occupato, setOccupato] = useState(false)
  const stacca = useRef<(() => void) | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { stacca.current?.(); if (timer.current) clearTimeout(timer.current) }, [])

  // Al cambio di settimana si riparte da oggi (se c'è) o dal lunedì.
  const [lunPrec, setLunPrec] = useState(lunedi)
  if (lunPrec !== lunedi) { setLunPrec(lunedi); setSel(iOggi >= 0 ? iOggi : 0); setEdit(null) }

  function scambia(v: Turn | null) {
    if (tOut) return
    setTOut(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { setEdit(v); setTOut(false) }, USCITA)
  }

  const giorno = giorni[sel]
  const delGiorno = turni.filter(t => t.date === giorno && !t.is_rest_day)
  const assenti = new Map(assenze.filter(a => a.start_date <= giorno && a.end_date >= giorno).map(a => [a.user_id, a.type]))
  const conAssenza = (g: string) => assenze.some(a => a.start_date <= g && a.end_date >= g)

  const righe = staff
    .map(s => ({ s, tt: delGiorno.filter(t => t.user_id === s.id).sort((x, y) => asse(x).a - asse(y).a), ass: assenti.get(s.id) }))
    .filter(r => r.tt.length || r.ass)
    .sort((x, y) => (x.tt[0] ? asse(x.tt[0]).a : 9999) - (y.tt[0] ? asse(y.tt[0]).a : 9999) || x.s.full_name.localeCompare(y.s.full_name, 'it'))

  // Finestra del prototipo 11→01, allargata solo se un turno esce.
  const tutti = delGiorno.map(asse)
  const H0 = Math.min(660, ...tutti.map(x => Math.floor(x.a / 60) * 60))
  const FINE = Math.max(25 * 60, ...tutti.map(x => Math.ceil(x.b / 60) * 60))
  const SPAN = FINE - H0
  const pos = (a: number, b: number) => ({ left: ((a - H0) / SPAN) * 100 + '%', width: ((b - a) / SPAN) * 100 + '%' })
  const inServizio = righe.filter(r => r.tt.length && !r.ass).length

  function premi(e: React.PointerEvent, t: Turn) {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    const track = el.parentElement!.getBoundingClientRect(), seg = el.getBoundingClientRect()
    const x0 = e.clientX, rx = x0 - seg.left
    const modo = rx < 14 ? 'l' : seg.right - x0 < 14 ? 'r' : 'm'
    const { a: a0, b: b0 } = asse(t)
    let mosso = false, cur = { a: a0, b: b0 }
    const mv = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > 4) mosso = true
      if (!mosso) return
      const dm = Math.round(((ev.clientX - x0) / track.width) * SPAN / SNAP) * SNAP
      let a = a0, b = b0
      if (modo === 'm') { const len = b0 - a0; a = Math.min(Math.max(H0, a0 + dm), FINE - len); b = a + len }
      if (modo === 'l') a = Math.min(Math.max(H0, a0 + dm), b0 - 60)
      if (modo === 'r') b = Math.max(Math.min(FINE, b0 + dm), a0 + 60)
      cur = { a, b }
      setTrascina({ id: t.id, a, b })
    }
    const up = () => {
      stacca.current?.()
      if (!mosso) { setTrascina(null); scambia(t); return }
      if (cur.a === a0 && cur.b === b0) { setTrascina(null); return }
      onSposta(t, cur.a, cur.b).finally(() => setTrascina(null))
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    stacca.current = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); stacca.current = null }
  }

  const tAnim = tOut ? 'anim-swapout' : 'anim-swapin'

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none flex-col gap-3 px-1 pt-3">
        <div className="relative flex items-baseline justify-between">
          <span className="text-[28px] font-semibold tracking-[-0.8px]">Turni {reparto.toLowerCase()}</span>
          {/* L'etichetta resta piccola, l'area toccabile no: 40 px di lato,
              con margini negativi perché l'intestazione non cambi altezza. */}
          <button type="button" onClick={() => setMenu(m => !m)} aria-haspopup="menu" aria-expanded={menu} className="-mx-2.5 -my-2.5 flex min-h-10 min-w-10 items-center justify-end px-2.5 text-[13px] font-medium underline decoration-line-strong underline-offset-4 active:opacity-60">{etichettaSettimanaBreve(lunedi)}</button>
          {menu && (
            <div className="anim-swapin absolute right-0 top-[calc(100%+6px)] z-30 flex w-[220px] flex-col overflow-hidden rounded-[12px] border border-border bg-card p-1 shadow-[0_10px_30px_rgba(20,30,50,.15)]">
              {([[-1, 'Settimana precedente'], [null, 'Questa settimana'], [1, 'Settimana successiva']] as const).map(([d, l]) => (
                <button key={l} type="button" onClick={() => { setMenu(false); onSettimana(d) }} className="flex h-11 items-center rounded-[8px] px-3 text-left text-[15px] font-medium active:bg-[oklch(0.95_0.01_250)] dark:active:bg-[oklch(0.25_0.01_250)]">{l}</button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {giorni.map((g, i) => {
            const on = i === sel
            return (
              <button
                key={g} type="button" onClick={() => { setSel(i); if (edit) scambia(null) }}
                className={cn('flex h-14 flex-col items-center justify-center gap-0.5 rounded-[12px] active:scale-[0.97]', on ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground')}
              >
                <span className="font-mono text-[11px] font-medium uppercase">{WD[i]}</span>
                <span className="font-mono text-[17px] font-semibold">{numeroGiorno(g)}</span>
                <span className="h-1 w-1 rounded-sm" style={{ background: conAssenza(g) ? 'oklch(0.52 0.08 75)' : 'transparent' }} />
              </button>
            )
          })}
        </div>
      </div>

      {!edit ? (
        <div className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pt-3.5', tAnim)}>
          <div className="flex justify-between px-1 font-mono text-[11px] font-medium uppercase tracking-[1px] text-muted-foreground">
            <span>{WDL[sel]} · {inServizio} {inServizio === 1 ? 'persona' : 'persone'}</span>
            <span>{String((H0 / 60) % 24).padStart(2, '0')} — {String((FINE / 60) % 24).padStart(2, '0')}</span>
          </div>
          {righe.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">Nessun turno in questo giorno.</div>
          )}
          {righe.map((r, i) => (
            <div key={r.s.id} className="grid min-h-11 grid-cols-[84px_1fr] items-center gap-2.5" style={{ animation: 'inrise 600ms cubic-bezier(0.16,1,0.3,1) both', animationDelay: i * 70 + 'ms' }}>
              <span className="truncate text-sm font-medium">{nomeBreve(r.s.full_name)}</span>
              <div className="relative h-10 rounded-[4px] bg-[oklch(0.94_0.01_250)] dark:bg-[oklch(0.25_0.01_250)]">
                {r.ass ? (
                  // Assente: la barra rossa occupa l'orario del turno (o tutto il giorno).
                  (r.tt.length ? r.tt : [null]).map((t, j) => {
                    const x = t ? asse(t) : { a: H0, b: FINE }
                    return (
                      <div key={j} onClick={() => t && scambia(t)} className="absolute bottom-0 top-0 box-border flex cursor-pointer items-center overflow-hidden whitespace-nowrap rounded-[4px] bg-neg-tint px-[9px] font-mono text-[11px] font-medium text-neg" style={pos(x.a, x.b)}>
                        {ETICHETTA_ASSENZA[r.ass!] ?? 'Assente'}
                      </div>
                    )
                  })
                ) : r.tt.map(t => {
                  const tr = trascina?.id === t.id ? trascina : null
                  const { a, b } = tr ?? asse(t)
                  return (
                    <div
                      key={t.id} onPointerDown={e => premi(e, t)}
                      className={cn('absolute bottom-0 top-0 box-border flex touch-none select-none items-center overflow-hidden whitespace-nowrap rounded-[4px] px-[9px] font-mono text-[11px] font-medium',
                        t.is_extraordinary ? 'bg-[oklch(0.94_0.05_75)] text-[oklch(0.42_0.08_75)] dark:bg-[oklch(0.32_0.05_75)] dark:text-[oklch(0.86_0.08_75)]' : 'bg-[oklch(0.94_0.04_240)] text-[oklch(0.38_0.1_240)] dark:bg-[oklch(0.3_0.05_240)] dark:text-[oklch(0.85_0.08_240)]',
                        tr ? 'cursor-grabbing shadow-[0_0_0_2px_oklch(0.58_0.12_240),0_4px_12px_rgba(20,30,50,.12)]' : 'cursor-grab')}
                      style={pos(a, b)}
                    >
                      {fm(a)}–{fm(b)}
                      <span className="absolute bottom-3 left-[3px] top-3 w-0.5 rounded-[1px] bg-current opacity-40" />
                      <span className="absolute bottom-3 right-[3px] top-3 w-0.5 rounded-[1px] bg-current opacity-40" />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          <button type="button" onClick={() => onAggiungi(sel)} className="mt-2 flex h-12 flex-none items-center justify-center rounded-[12px] border border-dashed border-line-strong text-[15px] font-medium text-muted-foreground active:scale-[0.98]">+ Aggiungi turno</button>
          <span className="pb-3 text-center text-xs text-muted-foreground">Trascina un turno per spostarlo, i bordi per cambiare inizio e fine. Tocca per modificarlo.</span>
        </div>
      ) : (
        <div className="relative z-[5] mt-2.5 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
          <ModificaTurno
            key={edit.id}
            variante="capo" raggio="8px" padB="14px" anim={tAnim}
            nome={staff.find(s => s.id === edit.user_id)?.full_name ?? edit.profile?.full_name ?? ''}
            giorno={`${giornoLungo(edit.date)} · ${reparto}`}
            inizio={edit.is_rest_day ? '' : hm(toM(edit.start_time))} fine={edit.is_rest_day ? '' : hm(toM(edit.end_time))}
            tipo={edit.is_extraordinary ? 'straordinario' : 'standard'} nota={edit.notes ?? ''}
            occupato={occupato}
            onClose={() => scambia(null)}
            onSave={async v => { setOccupato(true); const ok = await onSalva(edit, v); setOccupato(false); if (ok) scambia(null) }}
            onDelete={async () => { setOccupato(true); const ok = await onElimina(edit); setOccupato(false); if (ok) scambia(null) }}
          />
        </div>
      )}
    </div>
  )
}
