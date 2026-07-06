'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { addDays, format, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import { createTurn, updateTurn, type TurnInput } from '@/app/actions/turni'
import { EXTRAORDINARY_BADGE, STANDARD_BADGE, RIPOSO_BADGE } from '@/lib/turnColors'
import type { Turn, Department } from '@/types'

const TZ = 'Europe/Rome'
const HOUR_WIDTH = 72 // px per ora — spazio sufficiente per etichetta e fascia leggibile
const NAME_COL_WIDTH = 140
const DEFAULT_START_HOUR = 8
const DEFAULT_END_HOUR = 24
const SNAP_MIN = 15            // arrotondamento del trascinamento, in minuti
const MIN_SHIFT_MIN = 15       // durata minima consentita di un turno
const MIN_DRAG_CREATE_MIN = 30 // sotto questa soglia un drag "a vuoto" non crea nulla
const CLICK_THRESHOLD_PX = 5   // sotto questa soglia un trascinamento dal centro è un click (apre la modifica)

type StaffMember = { id: string; full_name: string; department: string | null; restaurant_id: string | null }

interface Props {
  staff: StaffMember[]
  turns: Turn[]
  onEditTurn: (turn: Turn) => void
}

type DragState =
  | {
      mode: 'resize'
      turn: Turn
      edge: 'start' | 'end'
      trackEl: HTMLElement
      origStart: number
      origEnd: number
      previewStart: number
      previewEnd: number
    }
  | {
      mode: 'move'
      turn: Turn
      trackEl: HTMLElement
      origStart: number
      origEnd: number
      startClientX: number
      moved: boolean // false finché il puntatore non supera la soglia di click
      previewStart: number
      previewEnd: number
    }
  | {
      mode: 'create'
      member: StaffMember
      date: string
      trackEl: HTMLElement
      anchorMin: number
      previewStart: number
      previewEnd: number
    }

function timeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

function minutesToHHMM(totalMin: number): string {
  const m = ((Math.round(totalMin) % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

function snap(v: number): number {
  return Math.round(v / SNAP_MIN) * SNAP_MIN
}

// Intervallo [inizio,fine] in minuti dalla mezzanotte del giorno selezionato;
// gestisce il turno notturno estendendo la fine oltre le 24:00.
function turnRange(t: Turn): { start: number; end: number } {
  const start = timeToMinutes(t.start_time)
  let end = timeToMinutes(t.end_time)
  if (end <= start) end += 24 * 60
  return { start, end }
}

export function TurniTimeline({ staff, turns, onEditTurn }: Props) {
  const [date, setDate] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'))
  const [nowTick, setNowTick] = useState(() => Date.now())

  // `drag` esiste SOLO tra pointerdown e pointerup (i listener globali sono
  // agganciati mentre è non-null). `frozenPreview` è uno scatto congelato
  // usato solo per continuare a mostrare la fascia nella posizione rilasciata
  // mentre la chiamata al server è in corso, senza restare agganciato ai
  // movimenti del puntatore (altrimenti un mousemove dopo il rilascio
  // continuerebbe a spostare l'anteprima).
  const [drag, setDrag] = useState<DragState | null>(null)
  const [frozenPreview, setFrozenPreview] = useState<DragState | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null) // id turno, oppure 'new'
  const [dragError, setDragError] = useState<string | null>(null)
  const dragRef = useRef<DragState | null>(null)

  // La linea "adesso" avanza ogni minuto, senza bisogno di refresh manuale.
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!dragError) return
    const t = setTimeout(() => setDragError(null), 4000)
    return () => clearTimeout(t)
  }, [dragError])

  function shiftDay(delta: number) {
    setDate(prev => format(addDays(parseISO(`${prev}T00:00:00`), delta), 'yyyy-MM-dd'))
  }

  const dayTurns = turns.filter(t => t.date === date)
  const workTurns = dayTurns.filter(t => !t.is_rest_day)

  // Asse orario: parte da min(8:00, primo turno) e arriva a max(24:00, ultimo turno)
  const rawStart = Math.min(DEFAULT_START_HOUR * 60, ...workTurns.map(t => turnRange(t).start))
  const rawEnd = Math.max(DEFAULT_END_HOUR * 60, ...workTurns.map(t => turnRange(t).end))
  const axisStartHour = Math.floor(rawStart / 60)
  const axisEndHour = Math.ceil(rawEnd / 60)
  const axisStartMin = axisStartHour * 60
  const axisEndMin = axisEndHour * 60
  const totalHours = axisEndHour - axisStartHour
  const pxPerMin = HOUR_WIDTH / 60
  const totalWidth = totalHours * HOUR_WIDTH

  const hourMarks = Array.from({ length: totalHours }, (_, i) => axisStartHour + i)

  const todayStr = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const isToday = date === todayStr
  const nowMinRaw = isToday
    ? parseInt(formatInTimeZone(nowTick, TZ, 'H'), 10) * 60 + parseInt(formatInTimeZone(nowTick, TZ, 'm'), 10)
    : null
  const nowInRange = nowMinRaw !== null && nowMinRaw >= axisStartMin && nowMinRaw <= axisStartMin + totalHours * 60
  const nowLeftPx = nowInRange ? (nowMinRaw! - axisStartMin) * pxPerMin : 0

  const turnsByStaff: Record<string, Turn[]> = {}
  workTurns.forEach(t => {
    if (!turnsByStaff[t.user_id]) turnsByStaff[t.user_id] = []
    turnsByStaff[t.user_id].push(t)
  })
  const restDayStaffIds = new Set(dayTurns.filter(t => t.is_rest_day).map(t => t.user_id))

  // Mentre si trascina attivamente uso `drag`; dopo il rilascio, finché la
  // chiamata al server non è conclusa, uso lo scatto congelato `frozenPreview`.
  const activePreview = drag ?? frozenPreview

  // ── Drag: ridimensiona una fascia esistente oppure disegna un turno nuovo ──
  function minuteFromClientX(clientX: number, trackEl: HTMLElement): number {
    const rect = trackEl.getBoundingClientRect()
    return axisStartMin + (clientX - rect.left) / pxPerMin
  }

  function updateDrag(updater: (prev: DragState) => DragState) {
    setDrag(prev => {
      if (!prev) return prev
      const next = updater(prev)
      dragRef.current = next
      return next
    })
  }

  function startResize(e: React.PointerEvent, turn: Turn, edge: 'start' | 'end') {
    e.stopPropagation()
    e.preventDefault()
    const trackEl = (e.currentTarget as HTMLElement).closest('[data-track]') as HTMLElement | null
    if (!trackEl) return
    const { start, end } = turnRange(turn)
    const initial: DragState = { mode: 'resize', turn, edge, trackEl, origStart: start, origEnd: end, previewStart: start, previewEnd: end }
    dragRef.current = initial
    setDrag(initial)
  }

  function startMove(e: React.PointerEvent, turn: Turn) {
    e.stopPropagation()
    e.preventDefault()
    const trackEl = (e.currentTarget as HTMLElement).closest('[data-track]') as HTMLElement | null
    if (!trackEl) return
    const { start, end } = turnRange(turn)
    const initial: DragState = {
      mode: 'move', turn, trackEl, origStart: start, origEnd: end,
      startClientX: e.clientX, moved: false, previewStart: start, previewEnd: end,
    }
    dragRef.current = initial
    setDrag(initial)
  }

  function startCreate(e: React.PointerEvent<HTMLDivElement>, member: StaffMember) {
    if (e.target !== e.currentTarget) return // click su una fascia/etichetta esistente, non sull'area vuota
    if (e.button !== 0) return
    e.preventDefault()
    const trackEl = e.currentTarget
    const anchorMin = clamp(snap(minuteFromClientX(e.clientX, trackEl)), axisStartMin, axisEndMin)
    const initial: DragState = { mode: 'create', member, date, trackEl, anchorMin, previewStart: anchorMin, previewEnd: anchorMin }
    dragRef.current = initial
    setDrag(initial)
  }

  // Mentre un trascinamento è attivo, disabilita la selezione testo su tutta
  // la pagina (anche con prefisso WebKit per Safari/iOS): la selezione parte
  // nell'istante del pointerdown, quindi la timeline stessa è già select-none
  // in modo permanente — questo copre il resto della pagina se il puntatore
  // esce dal riquadro durante il gesto.
  useEffect(() => {
    if (!drag) return
    const body = document.body as HTMLElement & { style: CSSStyleDeclaration & { webkitUserSelect?: string } }
    const prevUserSelect = body.style.userSelect
    const prevWebkit = body.style.webkitUserSelect
    body.style.userSelect = 'none'
    body.style.webkitUserSelect = 'none'
    const sel = window.getSelection?.()
    sel?.removeAllRanges?.()
    return () => {
      body.style.userSelect = prevUserSelect
      body.style.webkitUserSelect = prevWebkit
    }
  }, [drag !== null])

  useEffect(() => {
    if (!drag) return

    function onMove(e: PointerEvent) {
      updateDrag(prev => {
        const min = minuteFromClientX(e.clientX, prev.trackEl)
        if (prev.mode === 'resize') {
          if (prev.edge === 'start') {
            return { ...prev, previewStart: clamp(snap(min), prev.origEnd - 24 * 60, prev.origEnd - MIN_SHIFT_MIN) }
          }
          return { ...prev, previewEnd: clamp(snap(min), prev.origStart + MIN_SHIFT_MIN, prev.origStart + 24 * 60) }
        }
        if (prev.mode === 'move') {
          const dxPx = Math.abs(e.clientX - prev.startClientX)
          const duration = prev.origEnd - prev.origStart
          const deltaMin = snap((e.clientX - prev.startClientX) / pxPerMin)
          const newStart = clamp(prev.origStart + deltaMin, 0, 2 * 1440 - duration)
          return {
            ...prev,
            previewStart: newStart,
            previewEnd: newStart + duration,
            moved: prev.moved || dxPx > CLICK_THRESHOLD_PX,
          }
        }
        const anchor = prev.anchorMin
        const cur = clamp(snap(min), axisStartMin, axisEndMin)
        return { ...prev, previewStart: Math.min(anchor, cur), previewEnd: Math.max(anchor, cur) }
      })
    }

    async function onUp() {
      const finalDrag = dragRef.current
      setDrag(null)
      dragRef.current = null
      if (!finalDrag) return

      if (finalDrag.mode === 'resize') {
        const orig = turnRange(finalDrag.turn)
        if (finalDrag.previewStart === orig.start && finalDrag.previewEnd === orig.end) return
      } else if (finalDrag.mode === 'move') {
        if (!finalDrag.moved) {
          // Nessuno spostamento reale: era un click, apri la modifica.
          onEditTurn(finalDrag.turn)
          return
        }
        if (finalDrag.previewStart === finalDrag.origStart) return
      } else if (finalDrag.previewEnd - finalDrag.previewStart < MIN_DRAG_CREATE_MIN) {
        return
      }

      // Congela la fascia nella posizione rilasciata finché il server non risponde
      setFrozenPreview(finalDrag)
      setSavingKey(finalDrag.mode === 'create' ? 'new' : finalDrag.turn.id)

      try {
        if (finalDrag.mode === 'resize' || finalDrag.mode === 'move') {
          const { turn, previewStart, previewEnd } = finalDrag
          await updateTurn(turn.id, {
            user_id: turn.user_id,
            restaurant_id: turn.restaurant_id,
            department: turn.department,
            date: turn.date,
            start_time: minutesToHHMM(previewStart),
            end_time: minutesToHHMM(previewEnd),
            is_extraordinary: turn.is_extraordinary,
            is_rest_day: false,
            notes: turn.notes,
          } satisfies TurnInput)
        } else {
          const { member, date: dayDate, previewStart, previewEnd } = finalDrag
          await createTurn({
            user_id: member.id,
            restaurant_id: member.restaurant_id ?? '',
            department: member.department as Department | null,
            date: dayDate,
            start_time: minutesToHHMM(previewStart),
            end_time: minutesToHHMM(previewEnd),
            is_extraordinary: false,
            is_rest_day: false,
            notes: null,
          } satisfies TurnInput)
        }
      } catch (err) {
        setDragError(err instanceof Error ? err.message : 'Errore durante il salvataggio del turno')
      } finally {
        setSavingKey(null)
        setFrozenPreview(null)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null])

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Timeline Giornaliera</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shiftDay(-1)} aria-label="Giorno precedente">
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <span className="text-xs font-medium text-foreground capitalize whitespace-nowrap tabular-nums min-w-[100px] text-center">
            {formatInTimeZone(`${date}T12:00:00Z`, TZ, 'EEE d MMM', { locale: it })}
          </span>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shiftDay(1)} aria-label="Giorno successivo">
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
          {/* Sempre presente (anche su oggi) per non far "saltare" il layout
              quando appare/scompare cambiando data. */}
          <button
            onClick={() => setDate(todayStr)}
            disabled={isToday}
            className="text-[11px] underline ml-1 text-muted-foreground hover:text-foreground disabled:no-underline disabled:opacity-40 disabled:cursor-default"
          >
            oggi
          </button>
        </div>
      </div>

      {dragError && (
        <p className="text-xs text-destructive mb-2">{dragError}</p>
      )}

      {/* Scroll confinato al proprio contenitore, stesso pattern del Report Ore */}
      {/* select-none permanente (+ varianti WebKit/iOS): la selezione parte al
          pointerdown, prima che lo stato di drag esista — disattivarla solo
          durante il drag arriva sempre troppo tardi. Qui non c'è testo che
          abbia senso copiare, quindi la disattiviamo del tutto. */}
      <div
        className="w-full rounded-md border bg-card overflow-auto max-h-[420px] select-none [-webkit-user-select:none] [-webkit-touch-callout:none]"
        onDragStart={e => e.preventDefault()}
      >
        <div style={{ minWidth: totalWidth + NAME_COL_WIDTH }}>
          {/* Header ore — sticky in alto mentre si scorre verticalmente */}
          <div className="flex border-b border-border sticky top-0 bg-card z-20">
            <div className="shrink-0 sticky left-0 bg-card z-10 border-r border-border" style={{ width: NAME_COL_WIDTH }} />
            <div className="flex" style={{ width: totalWidth }}>
              {hourMarks.map(h => (
                <div
                  key={h}
                  style={{ width: HOUR_WIDTH }}
                  className="shrink-0 text-[10px] text-muted-foreground px-1 py-1.5 border-r border-border/50"
                >
                  {String(h % 24).padStart(2, '0')}:00
                </div>
              ))}
            </div>
          </div>

          {/* Righe dipendenti */}
          {staff.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">Nessun dipendente</div>
          ) : staff.map(member => {
            const memberTurns = (turnsByStaff[member.id] ?? []).sort((a, b) => a.start_time.localeCompare(b.start_time))
            const isRest = restDayStaffIds.has(member.id)
            const createPreview = activePreview?.mode === 'create' && activePreview.member.id === member.id ? activePreview : null

            return (
              <div key={member.id} className="flex border-b border-border last:border-b-0 even:bg-zinc-50 dark:even:bg-zinc-900/20">
                <div
                  className="shrink-0 sticky left-0 bg-inherit z-10 border-r border-border px-2 py-2 text-xs font-medium text-foreground flex items-center truncate"
                  style={{ width: NAME_COL_WIDTH }}
                >
                  {member.full_name}
                </div>
                <div
                  data-track
                  onPointerDown={e => startCreate(e, member)}
                  style={{ width: totalWidth, minHeight: 44, touchAction: drag ? 'none' : 'pan-x' }}
                  className="relative cursor-crosshair"
                >
                  {/* Griglia ore verticale, solo decorativa */}
                  <div className="absolute inset-0 flex pointer-events-none">
                    {hourMarks.map(h => (
                      <div key={h} style={{ width: HOUR_WIDTH }} className="shrink-0 border-r border-border/30" />
                    ))}
                  </div>

                  {isRest && memberTurns.length === 0 && (
                    <div className="absolute inset-y-0 left-1.5 flex items-center pointer-events-none">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border font-medium ${RIPOSO_BADGE}`}>Riposo</span>
                    </div>
                  )}

                  {memberTurns.map(t => {
                    const isPreviewing = (activePreview?.mode === 'resize' || activePreview?.mode === 'move')
                      && activePreview.turn.id === t.id
                    const { start, end } = isPreviewing
                      ? { start: activePreview.previewStart, end: activePreview.previewEnd }
                      : turnRange(t)
                    const left = (start - axisStartMin) * pxPerMin
                    const width = Math.max((end - start) * pxPerMin, 26)
                    const isSaving = savingKey === t.id
                    return (
                      <div
                        key={t.id}
                        style={{ left, width, top: 6, height: 32 }}
                        className={`absolute rounded-sm border flex items-center text-[10px] font-medium select-none transition-opacity ${
                          isSaving ? 'opacity-60' : ''
                        } ${t.is_extraordinary ? EXTRAORDINARY_BADGE : STANDARD_BADGE}`}
                        title={`${member.full_name} · ${minutesToHHMM(start)}–${minutesToHHMM(end)}`}
                      >
                        {/* Maniglia sinistra — trascina per anticipare/posticipare l'inizio */}
                        <div
                          onPointerDown={e => startResize(e, t, 'start')}
                          className="absolute left-0 inset-y-0 w-2 cursor-ew-resize"
                          style={{ touchAction: 'none' }}
                        />
                        {/* Corpo centrale — un click apre la modifica, un trascinamento
                            sposta l'intero turno avanti/indietro */}
                        <div
                          onPointerDown={e => startMove(e, t)}
                          style={{ touchAction: 'none' }}
                          className="flex-1 h-full truncate text-left px-2 flex items-center cursor-grab active:cursor-grabbing hover:opacity-80"
                        >
                          {minutesToHHMM(start)}–{minutesToHHMM(end)}
                        </div>
                        {/* Maniglia destra — trascina per allungare/accorciare l'uscita */}
                        <div
                          onPointerDown={e => startResize(e, t, 'end')}
                          className="absolute right-0 inset-y-0 w-2 cursor-ew-resize"
                          style={{ touchAction: 'none' }}
                        />
                      </div>
                    )
                  })}

                  {createPreview && (
                    <div
                      style={{
                        left: (createPreview.previewStart - axisStartMin) * pxPerMin,
                        width: Math.max((createPreview.previewEnd - createPreview.previewStart) * pxPerMin, 4),
                        top: 6,
                        height: 32,
                      }}
                      className={`absolute rounded-sm border-2 border-dashed pointer-events-none flex items-center justify-center text-[10px] font-medium ${STANDARD_BADGE}`}
                    >
                      {createPreview.previewEnd - createPreview.previewStart >= MIN_DRAG_CREATE_MIN &&
                        `${minutesToHHMM(createPreview.previewStart)}–${minutesToHHMM(createPreview.previewEnd)}`}
                    </div>
                  )}

                  {nowInRange && (
                    <div className="absolute inset-y-0 w-px bg-red-500 z-10 pointer-events-none" style={{ left: nowLeftPx }} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded-sm border ${STANDARD_BADGE}`} /> Turno standard
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded-sm border ${EXTRAORDINARY_BADGE}`} /> Straordinario
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded-sm border ${RIPOSO_BADGE}`} /> Riposo
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-red-500" /> Adesso
        </span>
        <span className="text-muted-foreground/70">
          Trascina i bordi per allungare/accorciare · trascina dal centro per spostare · trascina un&apos;area vuota per crearne uno nuovo
        </span>
      </div>
    </div>
  )
}
