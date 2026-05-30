'use client'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { FileSpreadsheet, Download } from 'lucide-react'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { getDaysInMonth, differenceInMinutes } from 'date-fns'
import { it } from 'date-fns/locale'
import type { Restaurant, AbsenceType } from '@/types'
import { ABSENCE_CODES } from '@/types'

const TZ = 'Europe/Rome'
const TARGET_HOURS_PER_DAY = 8.5

interface Props {
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
  canViewHours: boolean
}

type EmployeeRec   = { id: string; full_name: string; restaurant_id: string | null }
type AttendanceRec = { id: string; user_id: string; restaurant_id: string | null; check_in: string; check_out: string | null }
type AbsenceRec    = { id: string; user_id: string; restaurant_id: string | null; type: AbsenceType; start_date: string; end_date: string }

type PreviewRow = {
  id: string
  full_name: string
  cells: Record<number, string>
  totalMins?: number
  totalLabel?: string
  diffLabel?: string
  diffMins?: number
}

function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}h ${String(m).padStart(2, '0')}m`
}

// ── Identical colour mapping to ReportClient ─────────────────────────────────
const PRESENZE_CELL_BG: Record<string, string> = {
  P:  'bg-green-100  text-green-900  dark:bg-green-900/30  dark:text-green-300',
  PP: 'bg-green-200  text-green-900  dark:bg-green-800/40  dark:text-green-200',
  F:  'bg-violet-100 text-violet-900 dark:bg-violet-900/30 dark:text-violet-300',
  M:  'bg-blue-100   text-blue-900   dark:bg-blue-900/30   dark:text-blue-300',
  R:  'bg-red-100    text-red-900    dark:bg-red-900/30    dark:text-red-300',
  AI: 'bg-purple-100 text-purple-900 dark:bg-purple-900/30 dark:text-purple-300',
}
const ORE_CELL_BG: Record<string, string> = {
  F:  'bg-violet-100 text-violet-900 dark:bg-violet-900/30 dark:text-violet-300',
  M:  'bg-blue-100   text-blue-900   dark:bg-blue-900/30   dark:text-blue-300',
  R:  'bg-red-100    text-red-900    dark:bg-red-900/30    dark:text-red-300',
  AI: 'bg-purple-100 text-purple-900 dark:bg-purple-900/30 dark:text-purple-300',
}
const ORE_ABSENCE_CODES = new Set(['F', 'M', 'R', 'AI'])

// ── CSS classes (no interactive class — cells are strictly read-only) ─────────
const thCls     = 'px-2 py-1.5 text-center font-semibold bg-zinc-900 text-white dark:bg-zinc-800 whitespace-nowrap'
const tdCls     = 'px-1.5 py-1 text-center text-xs border border-zinc-200 dark:border-zinc-700 whitespace-nowrap tabular-nums'
const tdNameCls = 'px-2 py-1 text-left text-xs font-medium border border-zinc-200 dark:border-zinc-700 whitespace-nowrap sticky left-0 bg-white dark:bg-zinc-950 z-10'

export function ConsultantReportClient({ restaurants, canViewHours }: Props) {
  const [selectedMonth, setSelectedMonth] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM'))
  const [selectedRestaurants, setSelectedRestaurants] = useState<string[]>(
    restaurants.length === 1 ? [restaurants[0].id] : []
  )
  const [loading, setLoading] = useState<'presenze' | 'ore' | null>(null)
  const [previewPresenze, setPreviewPresenze] = useState<PreviewRow[]>([])
  const [previewOre, setPreviewOre]           = useState<PreviewRow[]>([])
  const [previewLoading, setPreviewLoading]   = useState(false)
  const genRef = useRef(0)

  function toggleRestaurant(id: string) {
    setSelectedRestaurants(prev =>
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    )
  }

  const effectiveRestaurants = selectedRestaurants.length > 0
    ? selectedRestaurants
    : restaurants.map(r => r.id)

  // ── Identical preview logic to ReportClient (read-only: no editor refs needed) ─
  const loadPreview = useCallback(async (month: string, restaurantIds: string[]) => {
    const gen = ++genRef.current
    setPreviewLoading(true)

    const [year, monthNum] = month.split('-').map(Number)
    const daysCount  = getDaysInMonth(new Date(year, monthNum - 1))
    const monthStart = `${month}-01`
    const monthEnd   = `${month}-${String(daysCount).padStart(2, '0')}`
    const rangeStart = fromZonedTime(`${monthStart}T00:00:00`, TZ).toISOString()
    const rangeEnd   = fromZonedTime(`${monthEnd}T23:59:59`, TZ).toISOString()

    const supabase = createClient()
    const [
      { data: employees },
      { data: attendances },
      { data: absences },
    ] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, restaurant_id')
        .in('role', ['dipendente', 'capo_servizio'])
        .in('restaurant_id', restaurantIds)
        .order('full_name'),
      supabase.from('attendances')
        .select('id, user_id, restaurant_id, check_in, check_out')
        .in('restaurant_id', restaurantIds)
        .gte('check_in', rangeStart)
        .lte('check_in', rangeEnd),
      supabase.from('absences')
        .select('id, user_id, restaurant_id, type, start_date, end_date')
        .in('restaurant_id', restaurantIds)
        .eq('status', 'approved')
        .lte('start_date', monthEnd)
        .gte('end_date', monthStart),
    ])

    if (gen !== genRef.current) return

    const emps = (employees ?? []) as EmployeeRec[]
    const atts = (attendances ?? []) as AttendanceRec[]
    const abss = (absences ?? []) as AbsenceRec[]

    const presRows: PreviewRow[] = []
    const oreRows:  PreviewRow[] = []

    for (const emp of emps) {
      const presCells: Record<number, string> = {}
      const oreCells:  Record<number, string> = {}
      let totalMins = 0
      let workDays  = 0

      for (let day = 1; day <= daysCount; day++) {
        const dateStr = `${month}-${String(day).padStart(2, '0')}`
        const absence = abss.find(a =>
          a.user_id === emp.id && a.start_date <= dateStr && a.end_date >= dateStr
        )
        if (absence) {
          const code = ABSENCE_CODES[absence.type]
          presCells[day] = code
          oreCells[day]  = code
          continue
        }
        const daySessions = atts.filter(a =>
          a.user_id === emp.id &&
          formatInTimeZone(new Date(a.check_in), TZ, 'yyyy-MM-dd') === dateStr
        )
        if (daySessions.length > 0) {
          const hasOpen = daySessions.some(a => !a.check_out)
          const dayMins = daySessions.reduce((sum, a) => {
            if (!a.check_out) return sum
            return sum + differenceInMinutes(new Date(a.check_out), new Date(a.check_in))
          }, 0)
          presCells[day] = dayMins > 720 ? 'PP' : 'P'
          if (hasOpen && dayMins === 0) {
            oreCells[day] = 'In corso'
          } else {
            totalMins += dayMins
            workDays++
            oreCells[day] = minutesToLabel(dayMins)
          }
        }
      }

      const targetMins = workDays * TARGET_HOURS_PER_DAY * 60
      const diffMins   = totalMins - targetMins
      const absDiff    = Math.abs(diffMins)

      presRows.push({ id: emp.id, full_name: emp.full_name, cells: presCells })
      oreRows.push({
        id:         emp.id,
        full_name:  emp.full_name,
        cells:      oreCells,
        totalMins,
        totalLabel: minutesToLabel(totalMins),
        diffMins,
        diffLabel:  `${diffMins >= 0 ? '+' : '-'}${minutesToLabel(absDiff)}`,
      })
    }

    setPreviewPresenze(presRows)
    setPreviewOre(oreRows)
    setPreviewLoading(false)
  }, [])

  useEffect(() => {
    if (effectiveRestaurants.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPreview(selectedMonth, effectiveRestaurants)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, selectedRestaurants.join(','), loadPreview])

  const { days, monthLabel } = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const n = getDaysInMonth(new Date(y, m - 1))
    const raw = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))
    return {
      days: Array.from({ length: n }, (_, i) => i + 1),
      monthLabel: raw.charAt(0).toUpperCase() + raw.slice(1),
    }
  }, [selectedMonth])

  async function downloadReport(type: 'presenze' | 'ore') {
    if (effectiveRestaurants.length === 0) return
    setLoading(type)
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth, restaurantIds: effectiveRestaurants, type }),
      })
      if (!res.ok) { const e = await res.json(); alert(e.error || 'Errore download'); return }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `report-${type}-${selectedMonth}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } finally { setLoading(null) }
  }

  return (
    <div>
      <div className="space-y-4 max-w-lg mb-6">
        <div className="space-y-1.5">
          <Label>Mese</Label>
          <Input
            type="month"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="w-auto"
          />
        </div>

        {restaurants.length > 1 && (
          <div className="space-y-1.5">
            <Label>Ristoranti</Label>
            <div className="flex flex-wrap gap-2">
              {restaurants.map(r => (
                <button
                  key={r.id}
                  onClick={() => toggleRestaurant(r.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    selectedRestaurants.includes(r.id)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border text-foreground hover:bg-accent'
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={`grid gap-4 ${canViewHours ? 'grid-cols-2' : 'grid-cols-1 max-w-[200px]'}`}>
          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => downloadReport('presenze')}>
            <CardContent className="pt-6 pb-5 text-center">
              <FileSpreadsheet className="w-8 h-8 mx-auto mb-3 text-emerald-500" />
              <p className="font-medium text-sm">Report Presenze</p>
              <p className="text-xs text-muted-foreground mt-1">P · F · M · R · AI</p>
              <Button size="sm" className="mt-4 w-full" disabled={loading === 'presenze'}>
                {loading === 'presenze' ? 'Generazione...' : <><Download className="w-4 h-4 mr-1" />Scarica</>}
              </Button>
            </CardContent>
          </Card>

          {canViewHours && (
            <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => downloadReport('ore')}>
              <CardContent className="pt-6 pb-5 text-center">
                <FileSpreadsheet className="w-8 h-8 mx-auto mb-3 text-blue-500" />
                <p className="font-medium text-sm">Report Ore</p>
                <p className="text-xs text-muted-foreground mt-1">Ore · Totale · Delta</p>
                <Button size="sm" className="mt-4 w-full" disabled={loading === 'ore'}>
                  {loading === 'ore' ? 'Generazione...' : <><Download className="w-4 h-4 mr-1" />Scarica</>}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── Read-Only Preview Tables ───────────────────────────────────────
          SECURITY: cells have NO onClick, NO cursor-pointer, disabled={true} semantics.
          The consultant is a passive viewer — no editing is ever possible. */}
      <div className="space-y-8">

        {/* Preview Presenze */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />
            <h2 className="text-sm font-semibold">Preview Presenze / Turni</h2>
            <span className="text-xs text-muted-foreground">({monthLabel})</span>
            {previewLoading && <span className="text-xs text-muted-foreground animate-pulse">· Aggiornamento...</span>}
          </div>
          <div className="w-full rounded-md border bg-muted/20 overflow-auto max-h-[340px]">
            <table className="border-collapse text-xs" style={{ minWidth: 'max-content' }}>
              <thead>
                <tr>
                  <th className={`${thCls} sticky left-0 z-20 text-left min-w-[160px]`}>Dipendente</th>
                  {days.map(d => <th key={d} className={`${thCls} min-w-[36px]`}>{d}</th>)}
                  <th className={`${thCls} min-w-[80px]`}>Note</th>
                </tr>
              </thead>
              <tbody>
                {previewLoading && previewPresenze.length === 0 ? (
                  <tr><td colSpan={days.length + 2} className="text-center py-6 text-muted-foreground text-xs">Caricamento...</td></tr>
                ) : previewPresenze.length === 0 ? (
                  <tr><td colSpan={days.length + 2} className="text-center py-6 text-muted-foreground text-xs">Nessun dipendente trovato</td></tr>
                ) : previewPresenze.map(row => (
                  <tr key={row.id} className="even:bg-zinc-50 dark:even:bg-zinc-900/20">
                    <td className={tdNameCls}>{row.full_name}</td>
                    {/* SECURITY LOCK: no onClick, no cursor-pointer, disabled semantics */}
                    {days.map(d => {
                      const code = row.cells[d] ?? ''
                      return (
                        <td
                          key={d}
                          aria-disabled="true"
                          className={`${tdCls} font-semibold select-none ${PRESENZE_CELL_BG[code] ?? ''}`}
                        >
                          {code}
                        </td>
                      )
                    })}
                    <td className={tdCls} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!previewLoading && previewPresenze.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1.5">{previewPresenze.length} dipendenti · sola lettura</p>
          )}
        </div>

        {/* Preview Ore — only if canViewHours */}
        {canViewHours && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <FileSpreadsheet className="w-4 h-4 text-blue-500 shrink-0" />
              <h2 className="text-sm font-semibold">Preview Ore Lavorate</h2>
              <span className="text-xs text-muted-foreground">({monthLabel})</span>
              {previewLoading && <span className="text-xs text-muted-foreground animate-pulse">· Aggiornamento...</span>}
            </div>
            <div className="w-full rounded-md border bg-muted/20 overflow-auto max-h-[340px]">
              <table className="border-collapse text-xs" style={{ minWidth: 'max-content' }}>
                <thead>
                  <tr>
                    <th className={`${thCls} sticky left-0 z-20 text-left min-w-[160px]`}>Dipendente</th>
                    {days.map(d => <th key={d} className={`${thCls} min-w-[36px]`}>{d}</th>)}
                    <th className={`${thCls} min-w-[90px]`}>Totale Ore</th>
                    <th className={`${thCls} min-w-[90px]`}>Differenza</th>
                    <th className={`${thCls} min-w-[80px]`}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {previewLoading && previewOre.length === 0 ? (
                    <tr><td colSpan={days.length + 4} className="text-center py-6 text-muted-foreground text-xs">Caricamento...</td></tr>
                  ) : previewOre.length === 0 ? (
                    <tr><td colSpan={days.length + 4} className="text-center py-6 text-muted-foreground text-xs">Nessun dipendente trovato</td></tr>
                  ) : previewOre.map(row => (
                    <tr key={row.id} className="even:bg-zinc-50 dark:even:bg-zinc-900/20">
                      <td className={tdNameCls}>{row.full_name}</td>
                      {/* SECURITY LOCK: no onClick, no cursor-pointer, disabled semantics */}
                      {days.map(d => {
                        const val = row.cells[d] ?? ''
                        const isAbsCode = ORE_ABSENCE_CODES.has(val)
                        return (
                          <td
                            key={d}
                            aria-disabled="true"
                            className={`${tdCls} select-none ${isAbsCode ? `font-semibold ${ORE_CELL_BG[val] ?? ''}` : ''}`}
                          >
                            {val}
                          </td>
                        )
                      })}
                      <td className={`${tdCls} font-medium`}>{row.totalLabel}</td>
                      <td className={`${tdCls} font-semibold ${(row.diffMins ?? 0) >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                        {row.diffLabel}
                      </td>
                      <td className={tdCls} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!previewLoading && previewOre.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1.5">{previewOre.length} dipendenti · sola lettura</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
