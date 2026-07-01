'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { addDays, format, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import { EXTRAORDINARY_BADGE, STANDARD_BADGE, RIPOSO_BADGE } from '@/lib/turnColors'
import type { Turn } from '@/types'

const TZ = 'Europe/Rome'
const HOUR_WIDTH = 72 // px per ora — spazio sufficiente per etichetta e fascia leggibile
const NAME_COL_WIDTH = 140
const DEFAULT_START_HOUR = 8
const DEFAULT_END_HOUR = 24

type StaffMember = { id: string; full_name: string; department: string | null; restaurant_id: string | null }

interface Props {
  staff: StaffMember[]
  turns: Turn[]
  onEditTurn: (turn: Turn) => void
}

function timeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return h * 60 + m
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

  // La linea "adesso" avanza ogni minuto, senza bisogno di refresh manuale.
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])

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
          {!isToday && (
            <button
              onClick={() => setDate(todayStr)}
              className="text-[11px] text-muted-foreground hover:text-foreground underline ml-1"
            >
              oggi
            </button>
          )}
        </div>
      </div>

      {/* Scroll confinato al proprio contenitore, stesso pattern del Report Ore */}
      <div className="w-full rounded-md border bg-card overflow-auto max-h-[420px]">
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
            return (
              <div key={member.id} className="flex border-b border-border last:border-b-0 even:bg-zinc-50 dark:even:bg-zinc-900/20">
                <div
                  className="shrink-0 sticky left-0 bg-inherit z-10 border-r border-border px-2 py-2 text-xs font-medium text-foreground flex items-center truncate"
                  style={{ width: NAME_COL_WIDTH }}
                >
                  {member.full_name}
                </div>
                <div className="relative" style={{ width: totalWidth, minHeight: 44 }}>
                  {/* Griglia ore verticale, solo decorativa */}
                  <div className="absolute inset-0 flex pointer-events-none">
                    {hourMarks.map(h => (
                      <div key={h} style={{ width: HOUR_WIDTH }} className="shrink-0 border-r border-border/30" />
                    ))}
                  </div>

                  {isRest && memberTurns.length === 0 && (
                    <div className="absolute inset-y-0 left-1.5 flex items-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border font-medium ${RIPOSO_BADGE}`}>Riposo</span>
                    </div>
                  )}

                  {memberTurns.map(t => {
                    const { start, end } = turnRange(t)
                    const left = (start - axisStartMin) * pxPerMin
                    const width = Math.max((end - start) * pxPerMin, 26)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onEditTurn(t)}
                        style={{ left, width, top: 6, height: 32 }}
                        className={`absolute rounded-sm border px-1.5 flex items-center text-[10px] font-medium truncate text-left transition-opacity hover:opacity-80 ${
                          t.is_extraordinary ? EXTRAORDINARY_BADGE : STANDARD_BADGE
                        }`}
                        title={`${member.full_name} · ${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)}`}
                      >
                        {t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}
                      </button>
                    )
                  })}

                  {nowInRange && (
                    <div className="absolute inset-y-0 w-px bg-red-500 z-10" style={{ left: nowLeftPx }} />
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
      </div>
    </div>
  )
}
