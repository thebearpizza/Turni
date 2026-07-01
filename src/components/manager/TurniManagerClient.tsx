'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAccountStatus } from '@/contexts/AccountStatusContext'
import {
  createTurn, updateTurn, deleteTurn, createTurnsBulk,
  upsertStandardShift, deleteStandardShift, populateFromStandard,
  type TurnInput, type BulkTurnInput,
} from '@/app/actions/turni'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TimeInput } from '@/components/ui/time-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Plus, Trash2, ChevronLeft, ChevronRight, CalendarRange, X, Sparkles } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { startOfWeek, addDays, addWeeks, format, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import type { Turn, Department, StandardShift, AiScheduleDraft, AiScheduleDraftTurn } from '@/types'
import { AiScheduleDialog } from './AiScheduleDialog'
import { AiScheduleDraftView } from './AiScheduleDraftView'
import { TurniTimeline } from './TurniTimeline'
import { EXTRAORDINARY_BADGE, STANDARD_BADGE, RIPOSO_BADGE } from '@/lib/turnColors'

const TZ = 'Europe/Rome'

type StaffMember = { id: string; full_name: string; department: string | null; restaurant_id: string | null }
type RestaurantItem = { id: string; name: string }
type MultiDayEntry = {
  date: string
  is_rest_day: boolean
  start_time: string
  end_time: string
  is_extraordinary: boolean
  notes: string
  splitSegments: { start: string; end: string }[]
}

interface Props {
  initialTurns:          Turn[]
  initialStandardShifts: StandardShift[]
  staff:                 StaffMember[]
  restaurants:           RestaurantItem[]
  currentUserId:         string
  currentUserRole:       string
  currentDepartment:     string | null
  currentRestaurantId:   string | null
  currentIsDirettore:    boolean
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Durata di una fascia oraria in minuti; gestisce il turno notturno
// (fine ≤ inizio → si estende al giorno dopo).
function segmentMinutes(start: string, end: string): number {
  const s = timeToMinutes(start)
  let e = timeToMinutes(end)
  if (e <= s) e += 24 * 60
  return e - s
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// Una fascia spezzata è incompleta se ha un solo orario compilato tra i due.
function hasIncompleteSplit(segments: { start: string; end: string }[]): boolean {
  return segments.some(s => (s.start && !s.end) || (!s.start && s.end))
}

// Stile tabella "Turni Fissi" / "Preview Presenze-Ore" — riprende le stesse classi
const thCls = 'px-2 py-1.5 text-center font-semibold bg-zinc-900 text-white dark:bg-zinc-800 whitespace-nowrap'
const tdCls = 'px-1.5 py-1 text-center text-xs border border-zinc-200 dark:border-zinc-700 whitespace-nowrap tabular-nums'
const tdNameStaticCls = 'px-2 py-1 text-left text-xs font-medium border border-zinc-200 dark:border-zinc-700 whitespace-nowrap'
const tdNameCls = 'px-2 py-1 text-left text-xs font-medium border border-zinc-200 dark:border-zinc-700 whitespace-nowrap sticky left-0 bg-white dark:bg-zinc-950 z-10'

const TURN_TYPE_OPTIONS = [
  { value: false, label: 'Turno di Lavoro' },
  { value: true, label: 'Riposo' },
]

// date-fns getDay(): 0=Dom .. 6=Sab
const WEEK_DAY_OPTIONS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mer' },
  { value: 4, label: 'Gio' },
  { value: 5, label: 'Ven' },
  { value: 6, label: 'Sab' },
  { value: 0, label: 'Dom' },
]

export function TurniManagerClient({
  initialTurns, initialStandardShifts, staff, restaurants,
  currentUserRole, currentDepartment, currentRestaurantId,
  currentIsDirettore,
}: Props) {
  const { isPending } = useAccountStatus()
  const isManager = currentUserRole === 'manager'
  const isDirettore = currentUserRole === 'capo_servizio' && currentIsDirettore

  const [turns, setTurns] = useState<Turn[]>(initialTurns)
  const [weekOffset, setWeekOffset] = useState(0)
  const [restFilter, setRestFilter] = useState<string>('tutti')
  // Multi-selezione: array vuoto = tutti i reparti
  const [deptFilter, setDeptFilter] = useState<string[]>([])

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingTurn, setEditingTurn] = useState<Turn | null>(null)

  // Form state
  const [fUserId, setFUserId] = useState('')
  const [fRestaurantId, setFRestaurantId] = useState(currentRestaurantId ?? '')
  const [fDate, setFDate] = useState('')
  const [fEndDate, setFEndDate] = useState('')
  const [fDaysOfWeek, setFDaysOfWeek] = useState<number[]>([])
  const [fStart, setFStart] = useState('')
  const [fEnd, setFEnd] = useState('')
  const [fExtraordinary, setFExtraordinary] = useState(false)
  const [fIsRestDay, setFIsRestDay] = useState(false)
  const [fNotes, setFNotes] = useState('')
  const [bulkMode, setBulkMode] = useState(false)
  // Fasce aggiuntive dello stesso giorno (turno spezzato) — create insieme
  // alla fascia principale con un solo Salva, senza riaprire il form.
  const [fSplitSegments, setFSplitSegments] = useState<{ start: string; end: string }[]>([])
  // Multi-giorno: fDate è il giorno attualmente "in composizione"; le frecce
  // spostano avanti/indietro salvando il giorno corrente in questa coda,
  // finché non si preme Salva che inserisce tutto in blocco.
  const [multiDayMode, setMultiDayMode] = useState(false)
  const [multiDayQueue, setMultiDayQueue] = useState<MultiDayEntry[]>([])

  // Turni Standard (Pattern Master)
  const [standardShifts, setStandardShifts] = useState<StandardShift[]>(initialStandardShifts)
  const [showStandardModal, setShowStandardModal] = useState(false)
  const [sUserId, setSUserId] = useState('')
  const [sDaysOfWeek, setSDaysOfWeek] = useState<number[]>([])
  const [sStart, setSStart] = useState('')
  const [sEnd, setSEnd] = useState('')
  const [sSaving, setSSaving] = useState(false)
  const [sError, setSError] = useState<string | null>(null)

  // AI Schedule
  const [showAiDialog, setShowAiDialog] = useState(false)
  const [aiDraft, setAiDraft] = useState<(AiScheduleDraft & { turns: AiScheduleDraftTurn[] }) | null>(null)


  // ── Realtime — REGOLA D'ORO: aggiornamento istantaneo via supabase_realtime ──
  useEffect(() => {
    const supabase = createClient()
    const filter = !isManager && currentRestaurantId
      ? `restaurant_id=eq.${currentRestaurantId}`
      : undefined

    const channel = supabase
      .channel('rt-turni')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'turns', ...(filter ? { filter } : {}) },
        async (payload) => {
          // Capo Servizio (non direttore): il filtro realtime copre solo il
          // ristorante — il reparto va verificato lato client.
          const inDeptScope = (row: { department: string | null }) =>
            isManager || isDirettore || !currentDepartment || row.department === currentDepartment

          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const rec = payload.new as Turn
            if (!inDeptScope(rec)) {
              setTurns(prev => prev.filter(t => t.id !== rec.id))
              return
            }
            const { data } = await supabase
              .from('turns')
              .select('*, profile:profiles!user_id(id, full_name), restaurant:restaurants(id, name)')
              .eq('id', rec.id)
              .single()
            if (!data) return
            setTurns(prev => {
              const exists = prev.some(t => t.id === data.id)
              return exists
                ? prev.map(t => t.id === data.id ? data as unknown as Turn : t)
                : [...prev, data as unknown as Turn]
            })
          } else if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id: string }).id
            setTurns(prev => prev.filter(t => t.id !== deletedId))
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [isManager, isDirettore, currentDepartment, currentRestaurantId])

  // ── Week navigation ──────────────────────────────────────────────
  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 })
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekStartStr = format(weekStart, 'yyyy-MM-dd')
  const weekEndStr = format(addDays(weekStart, 6), 'yyyy-MM-dd')

  const turnsByRestaurant = (isManager && restFilter !== 'tutti')
    ? turns.filter(t => t.restaurant_id === restFilter)
    : turns

  const weekTurns = turnsByRestaurant.filter(t => t.date >= weekStartStr && t.date <= weekEndStr)

  // ── Griglia stile Excel: dipendenti × giorni della settimana ─────
  const turnsByUserDate: Record<string, Turn[]> = {}
  weekTurns.forEach(t => {
    const key = `${t.user_id}|${t.date}`
    if (!turnsByUserDate[key]) turnsByUserDate[key] = []
    turnsByUserDate[key].push(t)
  })
  Object.values(turnsByUserDate).forEach(list => list.sort((a, b) => a.start_time.localeCompare(b.start_time)))

  const staffByRestaurant = (isManager && restFilter !== 'tutti')
    ? staff.filter(s => s.restaurant_id === restFilter)
    : staff

  // Reparti disponibili nel ristorante selezionato (o in tutti, se nessun
  // filtro ristorante è attivo) — pannello nascosto se c'è un solo reparto.
  const allDepts = Array.from(
    new Set(staffByRestaurant.map(s => s.department).filter((d): d is string => !!d))
  ).sort()

  const gridStaff = deptFilter.length === 0
    ? staffByRestaurant
    : staffByRestaurant.filter(s => s.department && deptFilter.includes(s.department))

  function toggleDeptFilter(dept: string) {
    setDeptFilter(prev => prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept])
  }

  // ── Employee dropdown scoping ────────────────────────────────────
  // Direttore/Capo Servizio: `staff` arriva già filtrato dal server
  // (scopeStaffQuery) per restaurant_id (+ department per i non-direttori).
  // Manager: filtra per il ristorante selezionato nel form.
  const scopedStaff = isManager
    ? (fRestaurantId ? staff.filter(s => s.restaurant_id === fRestaurantId) : staff)
    : staff

  function resetForm() {
    setEditingTurn(null)
    setFUserId('')
    setFRestaurantId(currentRestaurantId ?? '')
    setFDate('')
    setFEndDate('')
    setFDaysOfWeek([])
    setFStart('')
    setFEnd('')
    setFExtraordinary(false)
    setFIsRestDay(false)
    setFNotes('')
    setBulkMode(false)
    setFSplitSegments([])
    setMultiDayMode(false)
    setMultiDayQueue([])
    setError(null)
  }

  function addSplitSegment() {
    setFSplitSegments(prev => [...prev, { start: '', end: '' }])
  }
  function updateSplitSegment(idx: number, patch: Partial<{ start: string; end: string }>) {
    setFSplitSegments(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }
  function removeSplitSegment(idx: number) {
    setFSplitSegments(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Turni Multi-giorno ────────────────────────────────────────────
  // fDate rappresenta il giorno "in composizione"; le frecce salvano il
  // giorno corrente nella coda e caricano il giorno successivo/precedente
  // (già presente in coda, se già compilato).
  function toggleMultiDayMode(v: boolean) {
    setMultiDayMode(v)
    setMultiDayQueue([])
    if (v) {
      setBulkMode(false)
      setFDate(prev => prev || formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'))
      setFIsRestDay(false)
      setFStart('')
      setFEnd('')
      setFExtraordinary(false)
      setFNotes('')
      setFSplitSegments([])
    }
  }

  function loadDayIntoComposer(dateStr: string, queue: MultiDayEntry[]) {
    const existing = queue.find(e => e.date === dateStr)
    setFDate(dateStr)
    if (existing) {
      setFIsRestDay(existing.is_rest_day)
      setFStart(existing.is_rest_day ? '' : existing.start_time.slice(0, 5))
      setFEnd(existing.is_rest_day ? '' : existing.end_time.slice(0, 5))
      setFExtraordinary(existing.is_extraordinary)
      setFNotes(existing.notes)
      setFSplitSegments(existing.splitSegments)
    } else {
      setFIsRestDay(false)
      setFStart('')
      setFEnd('')
      setFExtraordinary(false)
      setFNotes('')
      setFSplitSegments([])
    }
  }

  function goToDay(deltaDays: number) {
    if (!fDate) return
    if (!fIsRestDay && hasIncompleteSplit(fSplitSegments)) {
      setError('Completa tutte le fasce del turno spezzato di questo giorno prima di continuare, oppure rimuovile.')
      return
    }
    setError(null)
    const nextQueue = commitCurrentDayIfValid(multiDayQueue)
    setMultiDayQueue(nextQueue)
    const newDate = format(addDays(parseISO(`${fDate}T00:00:00`), deltaDays), 'yyyy-MM-dd')
    loadDayIntoComposer(newDate, nextQueue)
  }

  // Ritorna la coda aggiornata includendo il giorno attualmente in
  // composizione, se compilato (riposo, oppure orario completo).
  function commitCurrentDayIfValid(queue: MultiDayEntry[]): MultiDayEntry[] {
    if (!fDate || (!fIsRestDay && (!fStart || !fEnd))) return queue
    const entry: MultiDayEntry = {
      date:             fDate,
      is_rest_day:      fIsRestDay,
      start_time:       fIsRestDay ? '00:00' : fStart,
      end_time:         fIsRestDay ? '00:00' : fEnd,
      is_extraordinary: fIsRestDay ? false : fExtraordinary,
      notes:            fNotes.trim(),
      splitSegments:    fIsRestDay ? [] : fSplitSegments.filter(s => s.start && s.end),
    }
    const idx = queue.findIndex(e => e.date === fDate)
    const next = idx >= 0
      ? queue.map((e, i) => i === idx ? entry : e)
      : [...queue, entry]
    return next.sort((a, b) => a.date.localeCompare(b.date))
  }

  function removeMultiDayEntry(dateStr: string) {
    setMultiDayQueue(prev => prev.filter(e => e.date !== dateStr))
  }

  function openCreate() {
    resetForm()
    setShowForm(true)
  }

  // Creazione rapida da cella della griglia: precompila dipendente + data
  function openCreateForCell(userId: string, dateStr: string) {
    resetForm()
    const member = staff.find(s => s.id === userId)
    setFUserId(userId)
    setFDate(dateStr)
    if (isManager && member?.restaurant_id) setFRestaurantId(member.restaurant_id)
    setShowForm(true)
  }

  function openEdit(turn: Turn) {
    setEditingTurn(turn)
    setFUserId(turn.user_id)
    setFRestaurantId(turn.restaurant_id)
    setFDate(turn.date)
    setFStart(turn.start_time.slice(0, 5))
    setFEnd(turn.end_time.slice(0, 5))
    setFExtraordinary(turn.is_extraordinary)
    setFIsRestDay(turn.is_rest_day)
    setFNotes(turn.notes ?? '')
    setBulkMode(false)
    setFSplitSegments([])
    setMultiDayMode(false)
    setMultiDayQueue([])
    setError(null)
    setShowForm(true)
  }

  function toggleFDayOfWeek(day: number) {
    setFDaysOfWeek(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
  }

  async function handleSave() {
    if (!fUserId) return

    if (multiDayMode) {
      if (!fIsRestDay && hasIncompleteSplit(fSplitSegments)) {
        setError('Completa tutte le fasce del turno spezzato di questo giorno prima di salvare, oppure rimuovile.')
        return
      }
      const finalQueue = commitCurrentDayIfValid(multiDayQueue)
      if (finalQueue.length === 0) {
        setError('Compila almeno un giorno prima di salvare.')
        return
      }
      setSaving(true)
      setError(null)
      try {
        const selected = staff.find(s => s.id === fUserId)
        const restaurant_id = selected?.restaurant_id ?? fRestaurantId ?? currentRestaurantId ?? ''
        const department = (selected?.department ?? currentDepartment) as Department | null
        const creates: Promise<Turn>[] = []
        for (const e of finalQueue) {
          const shared = {
            user_id:       fUserId,
            restaurant_id,
            department,
            date:          e.date,
            is_rest_day:   e.is_rest_day,
            notes:         e.notes || null,
          }
          creates.push(createTurn({ ...shared, start_time: e.start_time, end_time: e.end_time, is_extraordinary: e.is_extraordinary }))
          for (const seg of e.splitSegments) {
            creates.push(createTurn({ ...shared, start_time: seg.start, end_time: seg.end, is_extraordinary: e.is_extraordinary }))
          }
        }
        const created = await Promise.all(creates)
        setTurns(prev => [...prev, ...created])
        resetForm()
        setShowForm(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Errore sconosciuto')
      } finally {
        setSaving(false)
      }
      return
    }

    if (!fIsRestDay && (!fStart || !fEnd)) return
    if (bulkMode ? (!fDate || !fEndDate || fDaysOfWeek.length === 0) : !fDate) return

    // Turno spezzato: ogni fascia aggiuntiva deve avere entrambi gli orari.
    const canHaveSplit = !fIsRestDay && !bulkMode && !editingTurn
    if (canHaveSplit && hasIncompleteSplit(fSplitSegments)) {
      setError('Completa tutte le fasce del turno spezzato prima di salvare, oppure rimuovile.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const selected = staff.find(s => s.id === fUserId)
      const baseFields = {
        user_id:          fUserId,
        restaurant_id:    selected?.restaurant_id ?? fRestaurantId ?? currentRestaurantId ?? '',
        department:       (selected?.department ?? currentDepartment) as Department | null,
        start_time:       fIsRestDay ? '00:00' : fStart,
        end_time:         fIsRestDay ? '00:00' : fEnd,
        is_extraordinary: fIsRestDay ? false : fExtraordinary,
        is_rest_day:      fIsRestDay,
        notes:            fNotes.trim() || null,
      }

      if (bulkMode) {
        const payload: BulkTurnInput = {
          ...baseFields,
          start_date:   fDate,
          end_date:     fEndDate,
          days_of_week: fDaysOfWeek,
        }
        const created = await createTurnsBulk(payload)
        setTurns(prev => [...prev, ...created])
      } else {
        const payload: TurnInput = { ...baseFields, date: fDate }
        if (editingTurn) {
          const updated = await updateTurn(editingTurn.id, payload)
          setTurns(prev => prev.map(t => t.id === updated.id ? updated : t))
        } else {
          // Fascia principale + eventuali fasce spezzate, create insieme
          // in un solo Salva (stesso dipendente/data/ristorante/reparto).
          const validSegments = fSplitSegments.filter(s => s.start && s.end)
          const created = await Promise.all([
            createTurn(payload),
            ...validSegments.map(s => createTurn({ ...baseFields, date: fDate, start_time: s.start, end_time: s.end })),
          ])
          setTurns(prev => [...prev, ...created])
        }
      }
      resetForm()
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore sconosciuto')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Eliminare questo turno?')) return
    try {
      await deleteTurn(id)
      setTurns(prev => prev.filter(t => t.id !== id))
    } catch (err) {
      console.error('Errore eliminazione turno:', err)
    }
  }

  // ── Turni Standard (Pattern Master) ──────────────────────────────
  function resetStandardForm() {
    setSUserId('')
    setSDaysOfWeek([])
    setSStart('')
    setSEnd('')
    setSError(null)
  }

  function toggleSDayOfWeek(day: number) {
    setSDaysOfWeek(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
  }

  async function handleAddStandardShift() {
    if (!sUserId || !sStart || !sEnd || sDaysOfWeek.length === 0) return
    setSSaving(true)
    setSError(null)
    try {
      const selected = staff.find(s => s.id === sUserId)
      const created: StandardShift[] = []
      for (const day of sDaysOfWeek) {
        const shift = await upsertStandardShift({
          user_id:       sUserId,
          restaurant_id: selected?.restaurant_id ?? currentRestaurantId ?? '',
          department:    (selected?.department ?? currentDepartment) as Department | null,
          day_of_week:   day,
          start_time:    sStart,
          end_time:      sEnd,
        })
        created.push(shift as unknown as StandardShift)
      }
      setStandardShifts(prev =>
        [...prev, ...created].sort((a, b) => a.day_of_week - b.day_of_week)
      )
      // Genera subito i turni reali per la settimana visualizzata, così il
      // turno fisso compare anche in tabella (il Realtime aggiorna `turns`)
      await populateFromStandard(weekStartStr, weekEndStr)
      resetStandardForm()
    } catch (err) {
      setSError(err instanceof Error ? err.message : 'Errore sconosciuto')
    } finally {
      setSSaving(false)
    }
  }

  async function handleDeleteStandardShift(id: string) {
    if (!confirm('Eliminare questo turno fisso?')) return
    try {
      await deleteStandardShift(id)
      setStandardShifts(prev => prev.filter(s => s.id !== id))
    } catch (err) {
      console.error('Errore eliminazione turno fisso:', err)
    }
  }

  // Turno spezzato disponibile in creazione (singola o multi-giorno), non in bulk/modifica
  const canHaveSplit = !fIsRestDay && !bulkMode && !editingTurn
  const validSplitSegments = fSplitSegments.filter(s => s.start && s.end)
  const totalShiftMinutes = fStart && fEnd
    ? segmentMinutes(fStart, fEnd) + validSplitSegments.reduce((sum, s) => sum + segmentMinutes(s.start, s.end), 0)
    : 0
  const hasIncompleteSplitSegment = canHaveSplit && hasIncompleteSplit(fSplitSegments)

  // Multi-giorno: quanti giorni verrebbero salvati se si premesse Salva ora
  // (coda + giorno corrente, se compilato e non già in coda).
  const multiDayCurrentIsQueued = multiDayMode && fDate && multiDayQueue.some(e => e.date === fDate)
  const multiDayCurrentIsValid = multiDayMode && !!fDate && (fIsRestDay || (!!fStart && !!fEnd))
  const multiDayCount = multiDayMode
    ? multiDayQueue.length + (multiDayCurrentIsValid && !multiDayCurrentIsQueued ? 1 : 0)
    : 0

  return (
    <div>
      {/* Header — i tasti vanno su una riga propria sotto il titolo su
          mobile, senza mai sforare la larghezza dello schermo */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight mb-3">Gestione Turni</h1>
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowStandardModal(true)} disabled={isPending} title={isPending ? 'Disponibile dopo l\'attivazione' : undefined}>
            <CalendarRange className="w-4 h-4" /> Turni Fissi
          </Button>
          <Button
            size="sm" variant="outline"
            onClick={() => setShowAiDialog(true)}
            disabled={isPending || (isManager && restFilter === 'tutti')}
            title={isPending ? 'Disponibile dopo l\'attivazione' : isManager && restFilter === 'tutti' ? 'Seleziona prima un ristorante dal filtro' : undefined}
          >
            <Sparkles className="w-4 h-4" /> Genera con IA
          </Button>
          <Button size="sm" onClick={openCreate} className="col-span-2 sm:col-span-1" disabled={isPending} title={isPending ? 'Disponibile dopo l\'attivazione' : undefined}>
            <Plus className="w-4 h-4" /> Nuovo Turno
          </Button>
        </div>
      </div>

      {/* Restaurant filter — manager only */}
      {isManager && restaurants.length > 0 && (
        <div className="mb-4">
          <Select value={restFilter} onValueChange={v => { setRestFilter(v); setDeptFilter([]) }}>
            <SelectTrigger className="h-8 w-56 text-xs rounded-sm">
              <SelectValue placeholder="Tutti i ristoranti" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tutti">Tutti i ristoranti</SelectItem>
              {restaurants.map(r => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Department filter — multi-selezione, mostrato solo se c'è più di un reparto */}
      {allDepts.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button
            onClick={() => setDeptFilter([])}
            className={`text-xs px-2.5 py-1 rounded-sm border transition-colors ${
              deptFilter.length === 0
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:bg-accent hover:text-foreground'
            }`}
          >
            Tutti i reparti
          </button>
          {allDepts.map(dept => (
            <button
              key={dept}
              onClick={() => toggleDeptFilter(dept)}
              className={`text-xs px-2.5 py-1 rounded-sm border transition-colors capitalize ${
                deptFilter.includes(dept)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:bg-accent hover:text-foreground'
              }`}
            >
              {dept}
            </button>
          ))}
        </div>
      )}

      {/* Week navigation — frecce simmetriche ai lati, data centrata su una riga */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setWeekOffset(w => w - 1)} aria-label="Settimana precedente">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="text-sm font-medium text-foreground text-center whitespace-nowrap tabular-nums">
          {formatInTimeZone(weekStart, TZ, "d MMM", { locale: it })} – {formatInTimeZone(addDays(weekStart, 6), TZ, "d MMM yyyy", { locale: it })}
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setWeekOffset(w => w + 1)} aria-label="Settimana successiva">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
      {weekOffset !== 0 && (
        <div className="text-center -mt-3 mb-5">
          <button onClick={() => setWeekOffset(0)} className="text-xs text-muted-foreground hover:text-foreground underline">
            torna a oggi
          </button>
        </div>
      )}

      {/* Griglia Turni — stile Excel: dipendenti × giorni della settimana.
          Ogni cella mostra i turni (o riposi) del dipendente in quel giorno;
          click su un turno per modificarlo, "+" per aggiungerne uno nuovo. */}
      <div className="w-full rounded-md border bg-card overflow-auto">
        <table className="border-collapse text-xs w-full" style={{ minWidth: 'max-content' }}>
          <thead>
            <tr>
              <th className={`${thCls} sticky left-0 z-20 text-left min-w-[150px]`}>Dipendente</th>
              {weekDays.map(day => (
                <th key={format(day, 'yyyy-MM-dd')} className={`${thCls} min-w-[100px]`}>
                  <div className="capitalize">{formatInTimeZone(day, TZ, 'EEE', { locale: it })}</div>
                  <div className="font-normal opacity-80">{formatInTimeZone(day, TZ, 'd/MM', { locale: it })}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gridStaff.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-6 text-muted-foreground text-xs">
                  Nessun dipendente
                </td>
              </tr>
            ) : gridStaff.map(member => (
              <tr key={member.id} className="even:bg-zinc-50 dark:even:bg-zinc-900/20">
                <td className={tdNameCls}>
                  {member.full_name}
                  {isManager && restFilter === 'tutti' && member.restaurant_id && (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {restaurants.find(r => r.id === member.restaurant_id)?.name ?? ''}
                    </span>
                  )}
                </td>
                {weekDays.map(day => {
                  const dateStr = format(day, 'yyyy-MM-dd')
                  const cellTurns = turnsByUserDate[`${member.id}|${dateStr}`] ?? []
                  return (
                    <td key={dateStr} className={`${tdCls} align-top p-1`}>
                      <div className="flex flex-col gap-1 items-stretch min-w-[80px]">
                        {cellTurns.map(turn => (
                          <div
                            key={turn.id}
                            onClick={() => openEdit(turn)}
                            className={`flex items-center justify-center gap-1 rounded-sm border px-1 py-0.5 text-[10px] font-medium whitespace-nowrap cursor-pointer ${
                              turn.is_rest_day ? RIPOSO_BADGE : turn.is_extraordinary ? EXTRAORDINARY_BADGE : STANDARD_BADGE
                            }`}
                          >
                            <span>
                              {turn.is_rest_day ? 'Riposo' : `${turn.start_time.slice(0, 5)}-${turn.end_time.slice(0, 5)}`}
                            </span>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); handleDelete(turn.id) }}
                              className="opacity-50 hover:opacity-100 hover:text-destructive"
                              aria-label="Elimina turno"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => openCreateForCell(member.id, dateStr)}
                          className="flex items-center justify-center h-5 rounded-sm border border-dashed border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          aria-label="Aggiungi turno"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded-sm border ${STANDARD_BADGE}`} /> Turno standard
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded-sm border ${EXTRAORDINARY_BADGE}`} /> Straordinario
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded-sm border ${RIPOSO_BADGE}`} /> Riposo
        </span>
      </div>

      {/* Timeline giornaliera — stessa lista dipendenti della griglia (rispetta
          i filtri ristorante/reparto), navigazione giorno per giorno */}
      <TurniTimeline staff={gridStaff} turns={turnsByRestaurant} onEditTurn={openEdit} />

      {/* ── Create / edit modal ─────────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTurn ? 'Modifica Turno' : bulkMode ? 'Inserimento Multiplo' : multiDayMode ? 'Turni su Più Giorni' : 'Nuovo Turno'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Restaurant — manager only */}
            {isManager && restaurants.length > 0 && (
              <div className="space-y-2">
                <Label>Ristorante *</Label>
                <Select value={fRestaurantId} onValueChange={v => { setFRestaurantId(v); setFUserId('') }}>
                  <SelectTrigger><SelectValue placeholder="Seleziona ristorante" /></SelectTrigger>
                  <SelectContent>
                    {restaurants.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Employee */}
            <div className="space-y-2">
              <Label>Dipendente *</Label>
              <Select value={fUserId} onValueChange={setFUserId}>
                <SelectTrigger><SelectValue placeholder="Seleziona dipendente" /></SelectTrigger>
                <SelectContent>
                  {scopedStaff.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.full_name}{s.department ? ` · ${s.department}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tipo: Turno di Lavoro o Riposo */}
            <div className="space-y-2">
              <Label>Tipo *</Label>
              <div className="flex flex-wrap gap-2">
                {TURN_TYPE_OPTIONS.map(o => (
                  <button
                    key={String(o.value)}
                    type="button"
                    onClick={() => { setFIsRestDay(o.value); if (o.value) setFSplitSegments([]) }}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      fIsRestDay === o.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-border text-foreground hover:bg-accent'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Inserimento Multiplo toggle — solo in creazione, esclude Multi-giorno */}
            {!editingTurn && !multiDayMode && (
              <div className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5">
                <div>
                  <Label className="text-sm">Inserimento Multiplo</Label>
                  <p className="text-xs text-muted-foreground">Stesso orario ripetuto su un range di date, sui giorni selezionati</p>
                </div>
                <Switch checked={bulkMode} onCheckedChange={v => { setBulkMode(v); if (v) setFSplitSegments([]) }} />
              </div>
            )}

            {/* Multi-giorno toggle — solo in creazione, esclude Inserimento Multiplo */}
            {!editingTurn && !bulkMode && (
              <div className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5">
                <div>
                  <Label className="text-sm">Più Giorni (orari diversi)</Label>
                  <p className="text-xs text-muted-foreground">Compila un turno diverso per ogni giorno, poi salva tutto insieme</p>
                </div>
                <Switch checked={multiDayMode} onCheckedChange={toggleMultiDayMode} />
              </div>
            )}

            {/* Date */}
            {multiDayMode ? (
              <div className="space-y-2">
                <Label>Giorno *</Label>
                <div className="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1.5">
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => goToDay(-1)} aria-label="Giorno precedente">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm font-medium capitalize text-center flex-1">
                    {fDate ? formatInTimeZone(`${fDate}T12:00:00Z`, TZ, 'EEEE d MMMM', { locale: it }) : '—'}
                  </span>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => goToDay(1)} aria-label="Giorno successivo">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Compila il turno di questo giorno, poi usa le frecce per passare al successivo.
                </p>
              </div>
            ) : bulkMode ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Data inizio *</Label>
                    <Input type="date" value={fDate} onChange={e => setFDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Data fine *</Label>
                    <Input type="date" value={fEndDate} onChange={e => setFEndDate(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Giorni della settimana *</Label>
                  <div className="flex flex-wrap gap-2">
                    {WEEK_DAY_OPTIONS.map(d => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => toggleFDayOfWeek(d.value)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          fDaysOfWeek.includes(d.value)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-border text-foreground hover:bg-accent'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label>Data *</Label>
                <Input type="date" value={fDate} onChange={e => setFDate(e.target.value)} />
              </div>
            )}

            {/* Giorni già compilati nel piano multi-giorno */}
            {multiDayMode && multiDayQueue.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">
                  Giorni in programma ({multiDayQueue.length})
                </Label>
                {multiDayQueue.map(e => (
                  <div
                    key={e.date}
                    className={`flex items-center justify-between rounded-sm border px-2.5 py-1.5 text-xs ${
                      e.date === fDate ? 'border-primary bg-primary/5' : 'border-border'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => loadDayIntoComposer(e.date, multiDayQueue)}
                      className="flex-1 text-left"
                    >
                      <span className="font-medium capitalize">
                        {formatInTimeZone(`${e.date}T12:00:00Z`, TZ, 'EEE d MMM', { locale: it })}
                      </span>
                      {' — '}
                      {e.is_rest_day
                        ? 'Riposo'
                        : `${e.start_time.slice(0, 5)}–${e.end_time.slice(0, 5)}${e.splitSegments.length > 0 ? ` + ${e.splitSegments.length} fascia/e` : ''}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMultiDayEntry(e.date)}
                      className="text-muted-foreground hover:text-destructive ml-2"
                      aria-label="Rimuovi giorno"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!fIsRestDay && (
              <>
                {/* Times */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Ora inizio *</Label>
                    <TimeInput value={fStart} onChange={setFStart} />
                  </div>
                  <div className="space-y-2">
                    <Label>Ora fine *</Label>
                    <TimeInput value={fEnd} onChange={setFEnd} />
                  </div>
                </div>

                {/* Durata — somma anche le eventuali fasce spezzate qui sotto */}
                {fStart && fEnd && (
                  <p className="text-xs text-muted-foreground -mt-2">
                    {validSplitSegments.length > 0 ? 'Durata totale (turno spezzato): ' : 'Durata turno: '}
                    <span className="font-medium text-foreground">{formatMinutes(totalShiftMinutes)}</span>
                  </p>
                )}

                {/* Turno spezzato — solo in creazione singola (non bulk, non modifica) */}
                {canHaveSplit && (
                  <div className="space-y-3">
                    {fSplitSegments.map((seg, idx) => (
                      <div key={idx} className="rounded-sm border border-border bg-muted/20 p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold text-muted-foreground">
                            Turno spezzato — fascia aggiuntiva {idx + 2}
                          </Label>
                          <button
                            type="button"
                            onClick={() => removeSplitSegment(idx)}
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="Rimuovi fascia"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label>Ora inizio *</Label>
                            <TimeInput value={seg.start} onChange={v => updateSplitSegment(idx, { start: v })} />
                          </div>
                          <div className="space-y-2">
                            <Label>Ora fine *</Label>
                            <TimeInput value={seg.end} onChange={v => updateSplitSegment(idx, { end: v })} />
                          </div>
                        </div>
                        {seg.start && seg.end && (
                          <p className="text-xs text-muted-foreground">
                            Durata fascia: <span className="font-medium text-foreground">{formatMinutes(segmentMinutes(seg.start, seg.end))}</span>
                          </p>
                        )}
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={addSplitSegment} className="w-full">
                      <Plus className="w-3.5 h-3.5" /> Aggiungi turno spezzato
                    </Button>
                  </div>
                )}

                {/* Extraordinary toggle */}
                <div className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5">
                  <div>
                    <Label className="text-sm">Turno Straordinario</Label>
                    <p className="text-xs text-muted-foreground">Evidenziato in arancione nel calendario</p>
                  </div>
                  <Switch checked={fExtraordinary} onCheckedChange={setFExtraordinary} />
                </div>
              </>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea
                value={fNotes}
                onChange={e => setFNotes(e.target.value)}
                rows={2}
                placeholder="Note opzionali..."
              />
            </div>

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button
              onClick={handleSave}
              disabled={
                saving || !fUserId ||
                (multiDayMode
                  ? (multiDayCount === 0 || hasIncompleteSplitSegment)
                  : (
                      (!fIsRestDay && (!fStart || !fEnd)) ||
                      (bulkMode ? (!fDate || !fEndDate || fDaysOfWeek.length === 0) : !fDate) ||
                      hasIncompleteSplitSegment
                    )
                )
              }
            >
              {saving
                ? 'Salvataggio...'
                : editingTurn
                ? 'Salva modifiche'
                : multiDayMode
                ? `Crea turni (${multiDayCount} giorni)`
                : bulkMode
                ? 'Crea turni'
                : 'Crea turno'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Turni Fissi (Pattern Master) ────────────────────────────── */}
      <Dialog open={showStandardModal} onOpenChange={setShowStandardModal}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Gestisci Turni Fissi</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="w-full rounded-md border bg-muted/20 overflow-auto max-h-[280px]">
              <table className="border-collapse text-xs w-full">
                <thead>
                  <tr>
                    <th className={`${thCls} text-left`}>Dipendente</th>
                    <th className={thCls}>Giorno</th>
                    <th className={thCls}>Orario</th>
                    <th className={thCls}></th>
                  </tr>
                </thead>
                <tbody>
                  {standardShifts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-4 text-muted-foreground text-xs">
                        Nessun turno fisso configurato
                      </td>
                    </tr>
                  ) : standardShifts.map(s => (
                    <tr key={s.id} className="even:bg-zinc-50 dark:even:bg-zinc-900/20">
                      <td className={tdNameStaticCls}>{s.profile?.full_name ?? '—'}</td>
                      <td className={tdCls}>{WEEK_DAY_OPTIONS.find(d => d.value === s.day_of_week)?.label}</td>
                      <td className={tdCls}>{s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}</td>
                      <td className={tdCls}>
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => handleDeleteStandardShift(s.id)}
                          className="text-destructive hover:text-destructive dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300 h-6 w-6"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 border-t border-border pt-4">
              <Label className="text-sm font-semibold">Aggiungi turno fisso</Label>
              <div className="space-y-2">
                <Label>Dipendente *</Label>
                <Select value={sUserId} onValueChange={setSUserId}>
                  <SelectTrigger><SelectValue placeholder="Seleziona dipendente" /></SelectTrigger>
                  <SelectContent>
                    {staff.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.full_name}{s.department ? ` · ${s.department}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  Giorni della settimana *
                  {sDaysOfWeek.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {sDaysOfWeek.length} selezionati
                    </span>
                  )}
                </Label>
                <div className="flex flex-wrap gap-2">
                  {WEEK_DAY_OPTIONS.map(d => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleSDayOfWeek(d.value)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        sDaysOfWeek.includes(d.value)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-border text-foreground hover:bg-accent'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Ora inizio *</Label>
                  <TimeInput value={sStart} onChange={setSStart} />
                </div>
                <div className="space-y-2">
                  <Label>Ora fine *</Label>
                  <TimeInput value={sEnd} onChange={setSEnd} />
                </div>
              </div>
              {sError && <p className="text-xs text-destructive">{sError}</p>}
              <Button
                size="sm"
                onClick={handleAddStandardShift}
                disabled={sSaving || !sUserId || !sStart || !sEnd || sDaysOfWeek.length === 0}
              >
                <Plus className="w-4 h-4" /> {sSaving ? 'Salvataggio...' : 'Aggiungi'}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStandardModal(false)}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AI Schedule ─────────────────────────────────────────────── */}
      <AiScheduleDialog
        open={showAiDialog}
        onClose={() => setShowAiDialog(false)}
        restaurantId={isManager ? (restFilter !== 'tutti' ? restFilter : '') : (currentRestaurantId ?? '')}
        currentDept={currentDepartment as Department | null}
        currentUserRole={currentUserRole}
        currentIsDirettore={currentIsDirettore}
        onDraftCreated={draft => { setAiDraft(draft); setShowAiDialog(false) }}
      />

      {/* Vista bozza AI */}
      {aiDraft && (
        <Dialog open={!!aiDraft} onOpenChange={open => { if (!open) setAiDraft(null) }}>
          <DialogContent className="max-h-[95vh] overflow-y-auto max-w-5xl w-full">
            <AiScheduleDraftView
              draft={aiDraft}
              staff={staff}
              onClose={() => setAiDraft(null)}
              onConfirmed={() => { setAiDraft(null) }}
            />
          </DialogContent>
        </Dialog>
      )}

    </div>
  )
}
