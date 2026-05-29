'use client'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { FileSpreadsheet, Download, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { LoadingDots } from '@/components/shared/LoadingDots'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { getDaysInMonth, differenceInMinutes } from 'date-fns'
import { it } from 'date-fns/locale'
import type { Restaurant, AbsenceType } from '@/types'
import { ABSENCE_CODES, ABSENCE_LABELS } from '@/types'

const TZ = 'Europe/Rome'
const TARGET_HOURS_PER_DAY = 8.5

interface Props {
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
  currentUserRole: string
  currentRestaurantId: string | null
  currentUserId: string
  isDirectore: boolean
}

// ── Raw record shapes kept in state for the cell editor ─────────────────
type EmployeeRec   = { id: string; full_name: string; restaurant_id: string | null }
type AttendanceRec = { id: string; user_id: string; restaurant_id: string | null; check_in: string; check_out: string | null }
type AbsenceRec    = { id: string; user_id: string; restaurant_id: string | null; type: AbsenceType; start_date: string; end_date: string; certificate_code: string | null; notes: string | null }

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

// Shift draft used inside the editor
type ShiftDraft = { id?: string; checkIn: string; checkOut: string }

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

const thCls     = 'px-2 py-1.5 text-center font-semibold bg-zinc-900 text-white dark:bg-zinc-800 whitespace-nowrap'
const tdCls     = 'px-1.5 py-1 text-center text-xs border border-zinc-200 dark:border-zinc-700 whitespace-nowrap tabular-nums'
const tdNameCls = 'px-2 py-1 text-left text-xs font-medium border border-zinc-200 dark:border-zinc-700 whitespace-nowrap sticky left-0 bg-white dark:bg-zinc-950 z-10'
// Interactive day cell: keeps the colour bg, signals clickability via an inset ring
const cellInteractive = 'cursor-pointer transition-shadow hover:ring-2 hover:ring-inset hover:ring-primary/50'

// Absence codes that should get coloured cells in the "Ore" table
const ORE_ABSENCE_CODES = new Set(['F', 'M', 'R', 'AI'])

const DIPENDENTE_ABSENCE_TYPES: AbsenceType[] = ['ferie', 'malattia', 'riposo', 'assenza_ingiustificata']

export function ReportClient({ restaurants, currentUserRole, currentRestaurantId, currentUserId, isDirectore }: Props) {
  const router = useRouter()
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

  // Raw records (kept so a cell click can resolve the underlying record IDs)
  const empMapRef = useRef<Map<string, EmployeeRec>>(new Map())
  const attRef    = useRef<AttendanceRec[]>([])
  const absRef    = useRef<AbsenceRec[]>([])

  const isManager = currentUserRole === 'manager'
  // canEdit: manager always yes; capo_servizio only when is_direttore = true
  const canEdit = isManager || (currentUserRole === 'capo_servizio' && isDirectore)

  // ── Cell editor dialog state ──────────────────────────────────────────
  const [editorOpen, setEditorOpen]   = useState(false)
  const [editorEmp, setEditorEmp]     = useState<EmployeeRec | null>(null)
  const [editorDate, setEditorDate]   = useState('')          // YYYY-MM-DD
  const [editorMode, setEditorMode]   = useState<'presenza' | 'assenza'>('presenza')
  const [shifts, setShifts]           = useState<ShiftDraft[]>([])
  const [origShiftIds, setOrigShiftIds] = useState<string[]>([])
  const [absId, setAbsId]             = useState<string | null>(null)
  const [absType, setAbsType]         = useState<AbsenceType>('ferie')
  const [absCert, setAbsCert]         = useState('')
  const [absNotes, setAbsNotes]       = useState('')
  const [absStart, setAbsStart]       = useState('')
  const [absEnd, setAbsEnd]           = useState('')
  const [editorSaving, setEditorSaving] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [confirmDeleteAbs, setConfirmDeleteAbs] = useState(false)

  function toggleRestaurant(id: string) {
    setSelectedRestaurants(prev =>
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    )
  }

  const currentTargets = useCallback((): string[] => (
    isManager
      ? (selectedRestaurants.length > 0 ? selectedRestaurants : restaurants.map(r => r.id))
      : (currentRestaurantId ? [currentRestaurantId] : [])
  ), [isManager, selectedRestaurants, restaurants, currentRestaurantId])

  async function downloadReport(type: 'presenze' | 'ore') {
    const targets = currentTargets()
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
        .select('id, full_name, restaurant_id')
        .in('role', ['dipendente', 'capo_servizio'])
        .in('restaurant_id', restaurantIds)
        .order('full_name'),
      supabase
        .from('attendances')
        .select('id, user_id, restaurant_id, check_in, check_out')
        .in('restaurant_id', restaurantIds)
        .gte('check_in', rangeStart)
        .lte('check_in', rangeEnd),
      supabase
        .from('absences')
        .select('id, user_id, restaurant_id, type, start_date, end_date, certificate_code, notes')
        .in('restaurant_id', restaurantIds)
        .eq('status', 'approved')
        .lte('start_date', monthEnd)
        .gte('end_date', monthStart),
    ])

    // Discard if a newer request has started
    if (gen !== genRef.current) return

    const emps = (employees ?? []) as EmployeeRec[]
    const atts = (attendances ?? []) as AttendanceRec[]
    const abss = (absences ?? []) as AbsenceRec[]

    // Store raw records for the editor
    empMapRef.current = new Map(emps.map(e => [e.id, e]))
    attRef.current = atts
    absRef.current = abss

    if (!emps.length) {
      setPreviewPresenze([])
      setPreviewOre([])
      setPreviewLoading(false)
      return
    }

    const presRows: PreviewRow[] = []
    const oreRows:  PreviewRow[] = []

    for (const emp of emps) {
      const presCells: Record<number, string> = {}
      const oreCells:  Record<number, string> = {}
      let totalMins = 0
      let workDays  = 0

      for (let day = 1; day <= daysCount; day++) {
        const dateStr = `${month}-${String(day).padStart(2, '0')}`

        // Approved absence takes priority over attendance
        const absence = abss.find(a =>
          a.user_id === emp.id &&
          a.start_date <= dateStr &&
          a.end_date   >= dateStr
        )
        if (absence) {
          const code = ABSENCE_CODES[absence.type]
          presCells[day] = code
          oreCells[day]  = code
          continue
        }

        // Sessions for this employee on this Rome-local day
        const daySessions = atts.filter(a => {
          if (a.user_id !== emp.id) return false
          return formatInTimeZone(new Date(a.check_in), TZ, 'yyyy-MM-dd') === dateStr
        })

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

  // Re-fetch preview whenever month or restaurant selection changes.
  // This is a legitimate "synchronize with external system" effect (the DB):
  // loadPreview owns its own loading/data state, so the set-state-in-effect
  // warning is expected here.
  useEffect(() => {
    const targets = currentTargets()
    if (targets.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPreview(selectedMonth, targets)
  // selectedRestaurants.join is a stable primitive derived from the array
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, selectedRestaurants.join(','), isManager, loadPreview])

  // Compute preview column structure from selectedMonth
  const { days, monthLabel } = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const n = getDaysInMonth(new Date(y, m - 1))
    const raw = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))
    return {
      days: Array.from({ length: n }, (_, i) => i + 1),
      monthLabel: raw.charAt(0).toUpperCase() + raw.slice(1),
    }
  }, [selectedMonth])

  // ── Open the editor for a given employee + day ─────────────────────────
  function openCell(employeeId: string, day: number) {
    if (!canEdit) return   // read-only for non-direttore capo_servizio
    const emp = empMapRef.current.get(employeeId)
    if (!emp) return
    const dateStr = `${selectedMonth}-${String(day).padStart(2, '0')}`

    setEditorEmp(emp)
    setEditorDate(dateStr)
    setEditorError(null)
    setConfirmDeleteAbs(false)

    // Existing approved absence covering this day?
    const absence = absRef.current.find(a =>
      a.user_id === employeeId && a.start_date <= dateStr && a.end_date >= dateStr
    )

    if (absence) {
      setEditorMode('assenza')
      setAbsId(absence.id)
      setAbsType(absence.type)
      setAbsCert(absence.certificate_code ?? '')
      setAbsNotes(absence.notes ?? '')
      setAbsStart(absence.start_date)
      setAbsEnd(absence.end_date)
      setShifts([])
      setOrigShiftIds([])
    } else {
      // Existing attendance blocks for this day
      const blocks = attRef.current
        .filter(a => a.user_id === employeeId && formatInTimeZone(new Date(a.check_in), TZ, 'yyyy-MM-dd') === dateStr)
        .sort((a, b) => new Date(a.check_in).getTime() - new Date(b.check_in).getTime())

      setEditorMode('presenza')
      setAbsId(null)
      setAbsType('ferie'); setAbsCert(''); setAbsNotes('')
      setAbsStart(dateStr); setAbsEnd(dateStr)

      if (blocks.length > 0) {
        setShifts(blocks.map(b => ({
          id: b.id,
          checkIn:  formatInTimeZone(new Date(b.check_in), TZ, 'HH:mm'),
          checkOut: b.check_out ? formatInTimeZone(new Date(b.check_out), TZ, 'HH:mm') : '',
        })))
        setOrigShiftIds(blocks.map(b => b.id))
      } else {
        setShifts([{ checkIn: '', checkOut: '' }])
        setOrigShiftIds([])
      }
    }

    setEditorOpen(true)
  }

  function addShiftRow() {
    setShifts(s => [...s, { checkIn: '', checkOut: '' }])
  }
  function updateShift(idx: number, patch: Partial<ShiftDraft>) {
    setShifts(s => s.map((row, i) => i === idx ? { ...row, ...patch } : row))
  }
  function removeShiftRow(idx: number) {
    setShifts(s => s.filter((_, i) => i !== idx))
  }

  async function refreshAfterMutation() {
    await loadPreview(selectedMonth, currentTargets())
    // Revalidate server components so any other open route reflects the change
    router.refresh()
  }

  // ── Save handler (create / edit / delete from a single cell) ───────────
  async function handleEditorSave() {
    if (!editorEmp) return
    setEditorSaving(true)
    setEditorError(null)
    const supabase = createClient()

    try {
      if (editorMode === 'presenza') {
        // 1) Delete blocks the user removed from the list
        const keptIds = new Set(shifts.filter(s => s.id).map(s => s.id as string))
        const toDelete = origShiftIds.filter(id => !keptIds.has(id))
        if (toDelete.length > 0) {
          const { error } = await supabase.from('attendances').delete().in('id', toDelete)
          if (error) throw new Error(error.message)
        }

        // 2) Upsert each shift row that has at least a check-in
        for (const s of shifts) {
          if (!s.checkIn) continue
          if (s.id) {
            const { error } = await supabase
              .from('attendances')
              .update({
                check_in:  fromZonedTime(new Date(`${editorDate}T${s.checkIn}`), TZ).toISOString(),
                check_out: s.checkOut ? fromZonedTime(new Date(`${editorDate}T${s.checkOut}`), TZ).toISOString() : null,
              })
              .eq('id', s.id)
            if (error) throw new Error(error.message)
          } else {
            const res = await fetch('/api/presenze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: editorEmp.id,
                date: editorDate,
                checkIn: s.checkIn,
                checkOut: s.checkOut || undefined,
              }),
            })
            if (!res.ok) {
              const d = await res.json()
              throw new Error(d.error || 'Errore creazione presenza')
            }
          }
        }
      } else {
        // Absence mode
        if (absId) {
          const { error } = await supabase
            .from('absences')
            .update({
              type: absType,
              certificate_code: absType === 'malattia' ? (absCert || null) : null,
              notes: absNotes || null,
            })
            .eq('id', absId)
          if (error) throw new Error(error.message)
        } else {
          const { error } = await supabase.from('absences').insert({
            user_id: editorEmp.id,
            restaurant_id: editorEmp.restaurant_id,
            type: absType,
            start_date: editorDate,
            end_date: editorDate,
            certificate_code: absType === 'malattia' ? (absCert || null) : null,
            notes: absNotes || null,
            status: 'approved',
            created_by: currentUserId,
          })
          if (error) throw new Error(error.message)
        }
      }

      await refreshAfterMutation()
      setEditorOpen(false)
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : 'Errore durante il salvataggio')
    } finally {
      setEditorSaving(false)
    }
  }

  async function handleDeleteAbsence() {
    if (!absId) return
    setEditorSaving(true)
    setEditorError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.from('absences').delete().eq('id', absId)
      if (error) throw new Error(error.message)
      await refreshAfterMutation()
      setEditorOpen(false)
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "Errore durante l'eliminazione")
    } finally {
      setEditorSaving(false)
    }
  }

  const editorDateLabel = editorDate
    ? (() => {
        const [y, m, d] = editorDate.split('-').map(Number)
        const date = new Date(y, m - 1, d, 12, 0, 0)
        const label = formatInTimeZone(date, TZ, 'EEEE d MMMM yyyy', { locale: it })
        return label.charAt(0).toUpperCase() + label.slice(1)
      })()
    : ''

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
          collassino — scroll X interno, nessun leak a livello viewport.
          Ogni cella giorno è cliccabile per creare/modificare presenze/assenze. */}
      <div className="mt-10 space-y-8">

        {/* Riquadro 1 — Preview Presenze/Turni */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />
            <h2 className="text-sm font-semibold">Preview Presenze / Turni</h2>
            <span className="text-xs text-muted-foreground">({monthLabel})</span>
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
                          onClick={canEdit ? () => openCell(row.id, d) : undefined}
                          title={canEdit ? 'Clicca per modificare' : undefined}
                          className={`${tdCls} font-semibold ${canEdit ? cellInteractive : ''} ${PRESENZE_CELL_BG[code] ?? ''}`}
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
              {previewPresenze.length} dipendenti · dati reali{canEdit ? ' · clicca una cella per modificare' : ''}
            </p>
          )}
        </div>

        {/* Riquadro 2 — Preview Ore Lavorate */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet className="w-4 h-4 text-blue-500 shrink-0" />
            <h2 className="text-sm font-semibold">Preview Ore Lavorate</h2>
            <span className="text-xs text-muted-foreground">({monthLabel})</span>
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
                          onClick={canEdit ? () => openCell(row.id, d) : undefined}
                          title={canEdit ? 'Clicca per modificare' : undefined}
                          className={`${tdCls} ${canEdit ? cellInteractive : ''} ${isAbsCode ? `font-semibold ${ORE_CELL_BG[val] ?? ''}` : ''}`}
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
              {previewOre.length} dipendenti · dati reali{canEdit ? ' · clicca una cella per modificare' : ''}
            </p>
          )}
        </div>
      </div>

      {/* ── Cell editor dialog ───────────────────────────────────────────
          Backdrop close disabilitato: il form si chiude solo con Annulla / X
          o dopo un salvataggio riuscito, per non perdere dati inseriti. */}
      <Dialog open={editorOpen} onOpenChange={open => { if (!open) setEditorOpen(false) }}>
        <DialogContent onInteractOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editorEmp?.full_name ?? '—'}</DialogTitle>
            <p className="text-sm text-muted-foreground">{editorDateLabel}</p>
          </DialogHeader>

          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setEditorMode('presenza'); setConfirmDeleteAbs(false) }}
              className={`h-9 rounded-md text-sm font-medium border transition-colors ${
                editorMode === 'presenza'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-accent'
              }`}
            >
              Presenza
            </button>
            <button
              type="button"
              onClick={() => { setEditorMode('assenza'); setConfirmDeleteAbs(false) }}
              className={`h-9 rounded-md text-sm font-medium border transition-colors ${
                editorMode === 'assenza'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-accent'
              }`}
            >
              Assenza
            </button>
          </div>

          {editorMode === 'presenza' ? (
            <div className="space-y-3">
              {shifts.length === 0 && (
                <p className="text-sm text-muted-foreground">Nessun turno. Aggiungine uno.</p>
              )}
              {shifts.map((s, idx) => (
                <div key={idx} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Ingresso</Label>
                    <Input
                      type="time"
                      value={s.checkIn}
                      onChange={e => updateShift(idx, { checkIn: e.target.value })}
                      className="h-9 rounded-sm"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Uscita</Label>
                    <Input
                      type="time"
                      value={s.checkOut}
                      onChange={e => updateShift(idx, { checkOut: e.target.value })}
                      className="h-9 rounded-sm"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => removeShiftRow(idx)}
                    className="h-9 w-9 shrink-0 text-destructive dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                    title="Rimuovi turno"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addShiftRow} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Aggiungi turno
              </Button>
            </div>
          ) : confirmDeleteAbs ? (
            <div className="space-y-4">
              <div className="flex gap-3 items-start rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">Eliminare questa assenza?</p>
                  <p className="text-muted-foreground mt-1">L&apos;azione è irreversibile.</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDeleteAbs(false)} disabled={editorSaving} className="h-10 rounded-sm">
                  Annulla
                </Button>
                <Button variant="destructive" onClick={handleDeleteAbsence} disabled={editorSaving} className="h-10 rounded-sm">
                  {editorSaving ? 'Eliminazione...' : 'Elimina definitivamente'}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Causale</Label>
                <Select value={absType} onValueChange={v => setAbsType(v as AbsenceType)}>
                  <SelectTrigger className="h-10 rounded-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIPENDENTE_ABSENCE_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{ABSENCE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {absType === 'malattia' && (
                <div className="space-y-2">
                  <Label>Codice certificato</Label>
                  <Input value={absCert} onChange={e => setAbsCert(e.target.value)} placeholder="Codice INPS" className="h-10 rounded-sm" />
                </div>
              )}
              <div className="space-y-2">
                <Label>Note <span className="text-muted-foreground font-normal">(opzionale)</span></Label>
                <Input value={absNotes} onChange={e => setAbsNotes(e.target.value)} placeholder="Aggiungi una nota..." className="h-10 rounded-sm" />
              </div>
              {absId && (absStart !== editorDate || absEnd !== editorDate) && (
                <p className="text-xs text-muted-foreground">
                  Assenza dal {absStart} al {absEnd} — le modifiche si applicano all&apos;intero periodo.
                </p>
              )}
            </div>
          )}

          {editorError && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{editorError}</p>
          )}

          {!confirmDeleteAbs && (
            <DialogFooter className="sm:justify-between gap-2">
              {editorMode === 'assenza' && absId ? (
                <Button
                  variant="destructive"
                  onClick={() => setConfirmDeleteAbs(true)}
                  disabled={editorSaving}
                  className="h-10 rounded-sm"
                >
                  <Trash2 className="w-4 h-4" /> Elimina
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={editorSaving} className="h-10 rounded-sm">
                  Annulla
                </Button>
                <Button onClick={handleEditorSave} disabled={editorSaving} className="h-10 rounded-sm">
                  {editorSaving ? <>Salvataggio<LoadingDots /></> : 'Salva'}
                </Button>
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
