'use client'
import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { FileSpreadsheet, Download } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { getDaysInMonth } from 'date-fns'
import type { Restaurant } from '@/types'

const TZ = 'Europe/Rome'

interface Props {
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
  currentUserRole: string
  currentRestaurantId: string | null
}

// Deterministic sample data for the preview tables
const SAMPLE_NAMES = ['Mario Rossi', 'Laura Bianchi', 'Carlo Verdi', 'Sofia Esposito', 'Luca Moretti']

function samplePresenzeCode(empIdx: number, day: number): string {
  const codes = ['P', 'P', 'P', 'P', 'P', 'P', 'F', 'M', 'R', '']
  return codes[(empIdx * 7 + day * 3) % codes.length]
}

function sampleOreValue(empIdx: number, day: number): string {
  const vals = ['8h 30m', '9h 00m', '8h 00m', '7h 45m', '', '', 'F', 'M', 'R', '']
  return vals[(empIdx * 11 + day * 5) % vals.length]
}

// Cell background colours matching the Excel export
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
}

const thCls = 'px-2 py-1.5 text-center font-semibold bg-zinc-900 text-white dark:bg-zinc-800 whitespace-nowrap'
const tdCls = 'px-1.5 py-1 text-center text-xs border border-zinc-200 dark:border-zinc-700 whitespace-nowrap tabular-nums'
const tdNameCls = 'px-2 py-1 text-left text-xs font-medium border border-zinc-200 dark:border-zinc-700 whitespace-nowrap sticky left-0 bg-white dark:bg-zinc-950 z-10'

export function ReportClient({ restaurants, currentUserRole, currentRestaurantId }: Props) {
  const [selectedMonth, setSelectedMonth] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM'))
  const [selectedRestaurants, setSelectedRestaurants] = useState<string[]>(
    currentRestaurantId ? [currentRestaurantId] : []
  )
  const [loading, setLoading] = useState<'presenze' | 'ore' | null>(null)

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

  // Compute preview structure from selectedMonth
  const { days, totalDays } = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const n = getDaysInMonth(new Date(y, m - 1))
    return { days: Array.from({ length: n }, (_, i) => i + 1), totalDays: n }
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
          La tabella usa whitespace-nowrap + minWidth: max-content per non
          collassare i giorni, garantendo scroll X interno senza viewport leak. */}
      <div className="mt-10 space-y-8">

        {/* Riquadro 1 — Preview Presenze/Turni */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />
            <h2 className="text-sm font-semibold">Preview Presenze / Turni</h2>
            <span className="text-xs text-muted-foreground">({selectedMonth})</span>
          </div>
          {/* overflow-auto confina lo scroll; max-h-[340px] limita altezza;
              il contenuto non tracima mai nel layout principale */}
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
                {SAMPLE_NAMES.map((name, empIdx) => (
                  <tr key={name} className="even:bg-zinc-50 dark:even:bg-zinc-900/20">
                    <td className={tdNameCls}>{name}</td>
                    {days.map(d => {
                      const code = samplePresenzeCode(empIdx, d)
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
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Dati di esempio · Il file Excel conterrà i dati reali del mese selezionato
          </p>
        </div>

        {/* Riquadro 2 — Preview Ore Lavorate */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet className="w-4 h-4 text-blue-500 shrink-0" />
            <h2 className="text-sm font-semibold">Preview Ore Lavorate</h2>
            <span className="text-xs text-muted-foreground">({selectedMonth})</span>
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
                {SAMPLE_NAMES.map((name, empIdx) => {
                  // Compute a plausible sample total
                  let workDays = 0
                  let totalMins = 0
                  const cells = days.map(d => {
                    const val = sampleOreValue(empIdx, d)
                    if (val && !['F', 'M', 'R', 'AI'].includes(val)) {
                      const [hPart, mPart] = val.replace('m', '').split('h ')
                      const mins = (parseInt(hPart) * 60) + (parseInt(mPart) || 0)
                      totalMins += mins
                      workDays++
                    }
                    return val
                  })
                  const targetMins  = workDays * 8.5 * 60
                  const diffMins    = totalMins - targetMins
                  const diffSign    = diffMins >= 0 ? '+' : '-'
                  const absDiff     = Math.abs(diffMins)
                  const diffLabel   = `${diffSign}${Math.floor(absDiff / 60)}h ${String(Math.round(absDiff % 60)).padStart(2, '0')}m`
                  const totalLabel  = `${Math.floor(totalMins / 60)}h ${String(Math.round(totalMins % 60)).padStart(2, '0')}m`

                  return (
                    <tr key={name} className="even:bg-zinc-50 dark:even:bg-zinc-900/20">
                      <td className={tdNameCls}>{name}</td>
                      {cells.map((val, i) => (
                        <td
                          key={i}
                          className={`${tdCls} ${ORE_CELL_BG[val] ?? ''}`}
                        >
                          {['F', 'M', 'R', 'AI'].includes(val) ? val : (val || '')}
                        </td>
                      ))}
                      <td className={`${tdCls} font-medium`}>{totalLabel}</td>
                      <td className={`${tdCls} font-semibold ${diffMins >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                        {diffLabel}
                      </td>
                      <td className={tdCls} />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Dati di esempio · Il file Excel conterrà i dati reali del mese selezionato
          </p>
        </div>
      </div>
    </div>
  )
}
