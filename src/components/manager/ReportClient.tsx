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
import type { Restaurant, AbsenceType } from '@/types'
import { ABSENCE_CODES } from '@/types'

const TZ = 'Europe/Rome'
const TARGET_HOURS_PER_DAY = 8.5

interface Props {
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
  currentUserRole: string
  currentRestaurantId: string | null
}

// ── Preview row types ───────────────────────────────────────────────────
type PreviewRow = {
  id: string
  full_name: string
  cells: Record<number, string>   // day (1..31) → cell code / value
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

// ── Cell styles — identical to Excel colour mapping ─────────────────────
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

const thCls    = 'px-2 py-1.5 text-center font-semibold bg-zinc-900 text-white dark:bg-zinc-800 whitespace-nowrap'
const tdCls    = 'px-1.5 py-1 text-center text-xs border border-zinc-200 dark:border-zinc-700 whitespace-nowrap tabular-nums'
const tdNameCls = 'px-2 py-1 text-left text-xs font-medium border border-zinc-200 dark:border-zinc-700 whitespace-nowrap sticky left-0 bg-white dark:bg-zinc-950 z-10'

// Absence codes that should get coloured cells in the "Ore" table
const ORE_ABSENCE_CODES = new Set(['F', 'M', 'R', 'AI'])

export function ReportClient({ restaurants, currentUserRole, currentRestaurantId }: Props) {
  const [selectedMonth, setSelectedMonth] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM'))
  const [selectedRestaurants, setSelectedRestaurants] = useState<string[]>(
    currentRestaurantId ? [currentRestaurantId] : []
  )
  const [loading, setLoading] = useState<'presenze' | 'ore' | null>(null)

  // Preview state
  const [previewPresenze, setPreviewPresenze] = useState<PreviewRow[]>([])
  const [previewOre, setPreviewOre]           = useState<PreviewRow[]>([])
  const [previewLoading, setPreviewLoading]   = useState(false)
  // Generation counter: prevents stale responses from overwriting newer ones
  const genRef = useRef(0)

  const isManager = currentUserRole === 'manager'

  function toggleRestaurant(id: string) {
    setSelectedRestaurants(prev =>
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    )
  }

  async function downloadReport(type: 'presenze' | 'ore') {
    const targets = isManager
      ? (selectedRestaurants.length > 0 ? selectedRestaurants : restaurants.map(r => r.id))
      : (currentRestaurantId ? [currentRestaurantId] : [])

    if (targets.length === 0) return

    setLoading(type)
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth, restaurantIds: targets, type }),
      })

      if (!res.ok) {
        const err = await res.json()
        alert(err.error || 'Errore nel download del report')
        return
      }

      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `report-${type}-${selectedMonth}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setLoading(null)
    }
  }

  // ── Preview data fetch ─────────────────────────────────────────────────
  // Mirrors the logic in /api/report/route.ts, executed client-side so the
  // preview stays in sync with whatever the Excel would contain.
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
      supabase
        .from('profiles')
        .select('id, full_name')
        .in('role', ['dipendente', 'capo_servizio'])
        .in('restaurant_id', restaurantIds)
        .order('full_name'),
      supabase
        .from('attendances')
        .select('user_id, check_in, check_out')
        .in('restaurant_id', restaurantIds)
        .gte('check_in', rangeStart)
        .lte('check_in', rangeEnd),
      supabase
        .from('absences')
        .select('user_id, type, start_date, end_date')
        .in('restaurant_id', restaurantIds)
        .eq('status', 'approved')
        .lte('start_date', monthEnd)
        .gte('end_date', monthStart),
    ])

    // Discard if a newer request has started
    if (gen !== genRef.current) return

    if (!employees?.length) {
      setPreviewPresenze([])
      setPreviewOre([])
      setPreviewLoading(false)
      return
    }

    const presRows: PreviewRow[] = []
    const oreRows:  PreviewRow[] = []

    for (const emp of employees) {
      const presCells: Record<number, string> = {}
      const oreCells:  Record<number, string> = {}
      let totalMins = 0
      let workDays  = 0

      for (let day = 1; day <= daysCount; day++) {
        const dateStr = `${month}-${String(day).padStart(2, '0')}`

        // Approved absence takes priority over attendance
        const absence = absences?.find(a =>
          a.user_id === emp.id &&
          a.start_date <= dateStr &&
          a.end_date   >= dateStr
        )
        if (absence) {
          const code = ABSENCE_CODES[absence.type as AbsenceType]
          presCells[day] = code
          oreCells[day]  = code
          continue
        }

        // Sessions for this employee on this Rome-local day
        const daySessions = attendances?.filter(a => {
          if (a.user_id !== emp.id) return false
          return formatInTimeZone(new Date(a.check_in), TZ, 'yyyy-MM-dd') === dateStr
        }) ?? []

        if (daySessions.length > 0) {
          const hasOpen  = daySessions.some(a => !a.check_out)
          const dayMins  = daySessions.reduce((sum, a) => {
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

  // Re-fetch preview whenever month or restaurant selection changes
  useEffect(() => {
    const targets = isManager
      ? (selectedRestaurants.length > 0 ? selectedRestaurants : restaurants.map(r => r.id))
      : (currentRestaurantId ? [currentRestaurantId] : [])
    if (targets.length === 0) return
    loadPreview(selectedMonth, targets)
  // selectedRestaurants.join is a stable primitive derived from the array
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, selectedRestaurants.join(','), isManager, loadPreview])

  // Compute preview column structure from selectedMonth
  const { days } = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const n = getDaysInMonth(new Date(y, m - 1))
    return { days: Array.from({ length: n }, (_, i) => i + 1) }
  }, [selectedMonth])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Report Excel</h1>
        <p className="text-muted-foreground text-sm mt-1">Esporta presenze e ore lavorate</p>
      </div>

      <div className="space-y-6 max-w-lg">
        <div className="space-y-2">
          <Label>Mese</Label>
          <Input
            type="month"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="w-auto"
          />
        </div>

        {isManager && restaurants.length > 0 && (
          <div className="space-y-2">
            <Label>Ristoranti (seleziona uno o più, lascia vuoto per tutti)</Label>
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
            {selectedRestaurants.length > 0 && (
              <p className="text-xs text-muted-foreground">{selectedRestaurants.length} ristoranti selezionati</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => downloadReport('presenze')}>
            <CardContent className="pt-6 pb-5 text-center">
              <FileSpreadsheet className="w-8 h-8 mx-auto mb-3 text-emerald-500" />
              <p className="font-medium text-sm">Report Presenze</p>
              <p className="text-xs text-muted-foreground mt-1">P · F · M · R · AI</p>
              <Button size="sm" className="mt-4 w-full" disabled={loading === 'presenze'}>
                {loading === 'presenze' ? 'Generazione...' : <><Download className="w-4 h-4" /> Scarica</>}
              </Button>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => downloadReport('ore')}>
            <CardContent className="pt-6 pb-5 text-center">
              <FileSpreadsheet className="w-8 h-8 mx-auto mb-3 text-blue-500" />
              <p className="font-medium text-sm">Report Ore</p>
              <p className="text-xs text-muted-foreground mt-1">Ore · Totale · Delta</p>
              <Button size="sm" className="mt-4 w-full" disabled={loading === 'ore'}>
                {loading === 'ore' ? 'Generazione...' : <><Download className="w-4 h-4" /> Scarica</>}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Preview riquadri ─────────────────────────────────────────────
          Scroll confinato al container (overflow-auto + max-h).
          La tabella usa minWidth: max-content per evitare che i giorni
          collassino — scroll X interno, nessun leak a livello viewport. */}
      <div className="mt-10 space-y-8">

        {/* Riquadro 1 — Preview Presenze/Turni */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />
            <h2 className="text-sm font-semibold">Preview Presenze / Turni</h2>
            <span className="text-xs text-muted-foreground">({selectedMonth})</span>
            {previewLoading && (
              <span className="text-xs text-muted-foreground animate-pulse">· Aggiornamento...</span>
            )}
          </div>
          <div className="w-full rounded-md border bg-muted/20 overflow-auto max-h-[340px]">
            <table
              className="border-collapse text-xs"
              style={{ minWidth: 'max-content' }}
            >
              <thead>
                <tr>
                  <th className={`${thCls} sticky left-0 z-20 text-left min-w-[160px]`}>Dipendente</th>
                  {days.map(d => (
                    <th key={d} className={`${thCls} min-w-[36px]`}>{d}</th>
                  ))}
                  <th className={`${thCls} min-w-[80px]`}>Note</th>
                </tr>
              </thead>
              <tbody>
                {previewLoading && previewPresenze.length === 0 ? (
                  <tr>
                    <td colSpan={days.length + 2} className="text-center py-6 text-muted-foreground text-xs">
                      Caricamento...
                    </td>
                  </tr>
                ) : previewPresenze.length === 0 ? (
                  <tr>
                    <td colSpan={days.length + 2} className="text-center py-6 text-muted-foreground text-xs">
                      Nessun dipendente trovato per i filtri selezionati
                    </td>
                  </tr>
                ) : previewPresenze.map(row => (
                  <tr key={row.id} className="even:bg-zinc-50 dark:even:bg-zinc-900/20">
                    <td className={tdNameCls}>{row.full_name}</td>
                    {days.map(d => {
                      const code = row.cells[d] ?? ''
                      return (
                        <td
                          key={d}
                          className={`${tdCls} font-semibold ${PRESENZE_CELL_BG[code] ?? ''}`}
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
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {previewPresenze.length} dipendenti · dati reali dal database
            </p>
          )}
        </div>

        {/* Riquadro 2 — Preview Ore Lavorate */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet className="w-4 h-4 text-blue-500 shrink-0" />
            <h2 className="text-sm font-semibold">Preview Ore Lavorate</h2>
            <span className="text-xs text-muted-foreground">({selectedMonth})</span>
            {previewLoading && (
              <span className="text-xs text-muted-foreground animate-pulse">· Aggiornamento...</span>
            )}
          </div>
          <div className="w-full rounded-md border bg-muted/20 overflow-auto max-h-[340px]">
            <table
              className="border-collapse text-xs"
              style={{ minWidth: 'max-content' }}
            >
              <thead>
                <tr>
                  <th className={`${thCls} sticky left-0 z-20 text-left min-w-[160px]`}>Dipendente</th>
                  {days.map(d => (
                    <th key={d} className={`${thCls} min-w-[36px]`}>{d}</th>
                  ))}
                  <th className={`${thCls} min-w-[90px]`}>Totale Ore</th>
                  <th className={`${thCls} min-w-[90px]`}>Differenza</th>
                  <th className={`${thCls} min-w-[80px]`}>Note</th>
                </tr>
              </thead>
              <tbody>
                {previewLoading && previewOre.length === 0 ? (
                  <tr>
                    <td colSpan={days.length + 4} className="text-center py-6 text-muted-foreground text-xs">
                      Caricamento...
                    </td>
                  </tr>
                ) : previewOre.length === 0 ? (
                  <tr>
                    <td colSpan={days.length + 4} className="text-center py-6 text-muted-foreground text-xs">
                      Nessun dipendente trovato per i filtri selezionati
                    </td>
                  </tr>
                ) : previewOre.map(row => (
                  <tr key={row.id} className="even:bg-zinc-50 dark:even:bg-zinc-900/20">
                    <td className={tdNameCls}>{row.full_name}</td>
                    {days.map(d => {
                      const val = row.cells[d] ?? ''
                      const isAbsCode = ORE_ABSENCE_CODES.has(val)
                      return (
                        <td
                          key={d}
                          className={`${tdCls} ${isAbsCode ? `font-semibold ${ORE_CELL_BG[val] ?? ''}` : ''}`}
                        >
                          {val}
                        </td>
                      )
                    })}
                    <td className={`${tdCls} font-medium`}>{row.totalLabel}</td>
                    <td className={`${tdCls} font-semibold ${
                      (row.diffMins ?? 0) >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-700 dark:text-red-400'
                    }`}>
                      {row.diffLabel}
                    </td>
                    <td className={tdCls} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!previewLoading && previewOre.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {previewOre.length} dipendenti · dati reali dal database
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
