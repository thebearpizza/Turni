'use client'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import {
  createTurn, updateTurn, deleteTurn, createTurnsBulk,
  upsertStandardShift, deleteStandardShift, populateFromStandard,
  type TurnInput, type BulkTurnInput,
} from '@/app/actions/turni'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Pencil, ChevronLeft, ChevronRight, Clock, Wand2, CalendarRange } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { startOfWeek, addDays, addWeeks, format } from 'date-fns'
import { it } from 'date-fns/locale'
import type { Turn, Department, StandardShift } from '@/types'

const TZ = 'Europe/Rome'

type StaffMember = { id: string; full_name: string; department: string | null; restaurant_id: string | null }
type RestaurantItem = { id: string; name: string }

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

const EXTRAORDINARY_BADGE = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800'
const STANDARD_BADGE = 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800'

// Stile tabella "Turni Fissi" — riprende le classi della Preview Presenze/Ore
const thCls = 'px-2 py-1.5 text-center font-semibold bg-zinc-900 text-white dark:bg-zinc-800 whitespace-nowrap'
const tdCls = 'px-1.5 py-1 text-center text-xs border border-zinc-200 dark:border-zinc-700 whitespace-nowrap tabular-nums'
const tdNameStaticCls = 'px-2 py-1 text-left text-xs font-medium border border-zinc-200 dark:border-zinc-700 whitespace-nowrap'

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
  const isManager = currentUserRole === 'manager'
  const isDirettore = currentUserRole === 'capo_servizio' && currentIsDirettore

  const [turns, setTurns] = useState<Turn[]>(initialTurns)
  const [weekOffset, setWeekOffset] = useState(0)
  const [restFilter, setRestFilter] = useState<string>('tutti')

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
  const [fNotes, setFNotes] = useState('')
  const [bulkMode, setBulkMode] = useState(false)

  // Turni Standard (Pattern Master)
  const [standardShifts, setStandardShifts] = useState<StandardShift[]>(initialStandardShifts)
  const [showStandardModal, setShowStandardModal] = useState(false)
  const [sUserId, setSUserId] = useState('')
  const [sDaysOfWeek, setSDaysOfWeek] = useState<number[]>([])
  const [sStart, setSStart] = useState('')
  const [sEnd, setSEnd] = useState('')
  const [sSaving, setSSaving] = useState(false)
  const [sError, setSError] = useState<string | null>(null)

  // Popola da Turni Standard
  const [showPopolaModal, setShowPopolaModal] = useState(false)
  const [popolaStart, setPopolaStart] = useState('')
  const [popolaEnd, setPopolaEnd] = useState('')
  const [popolaSaving, setPopolaSaving] = useState(false)
  const [popolaResult, setPopolaResult] = useState<string | null>(null)

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

  const turnsByDate: Record<string, Turn[]> = {}
  weekTurns.forEach(t => {
    if (!turnsByDate[t.date]) turnsByDate[t.date] = []
    turnsByDate[t.date].push(t)
  })
  Object.values(turnsByDate).forEach(list => list.sort((a, b) => a.start_time.localeCompare(b.start_time)))

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
    setFNotes('')
    setBulkMode(false)
    setError(null)
  }

  function openCreate() {
    resetForm()
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
    setFNotes(turn.notes ?? '')
    setBulkMode(false)
    setError(null)
    setShowForm(true)
  }

  function toggleFDayOfWeek(day: number) {
    setFDaysOfWeek(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
  }

  async function handleSave() {
    if (!fUserId || !fStart || !fEnd) return
    if (bulkMode ? (!fDate || !fEndDate || fDaysOfWeek.length === 0) : !fDate) return
    setSaving(true)
    setError(null)
    try {
      const selected = staff.find(s => s.id === fUserId)
      const baseFields = {
        user_id:          fUserId,
        restaurant_id:    selected?.restaurant_id ?? fRestaurantId ?? currentRestaurantId ?? '',
        department:       (selected?.department ?? currentDepartment) as Department | null,
        start_time:       fStart,
        end_time:         fEnd,
        is_extraordinary: fExtraordinary,
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
          const created = await createTurn(payload)
          setTurns(prev => [...prev, created])
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

  // ── Popola da Turni Standard (Automazione) ───────────────────────
  async function handlePopolaFromStandard() {
    if (!popolaStart || !popolaEnd) return
    setPopolaSaving(true)
    setPopolaResult(null)
    try {
      const { created, skipped } = await populateFromStandard(popolaStart, popolaEnd)
      setPopolaResult(`${created} turni creati, ${skipped} già presenti (saltati).`)
    } catch (err) {
      setPopolaResult(err instanceof Error ? err.message : 'Errore sconosciuto')
    } finally {
      setPopolaSaving(false)
    }
  }

  return (
    <div>
      {/* Header — i tasti vanno su una riga propria sotto il titolo su
          mobile, senza mai sforare la larghezza dello schermo */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight mb-3">Gestione Turni</h1>
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowStandardModal(true)}>
            <CalendarRange className="w-4 h-4" /> Turni Fissi
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setPopolaResult(null); setShowPopolaModal(true) }}>
            <Wand2 className="w-4 h-4" /> Popola Standard
          </Button>
          <Button size="sm" onClick={openCreate} className="col-span-2 sm:col-span-1">
            <Plus className="w-4 h-4" /> Nuovo Turno
          </Button>
        </div>
      </div>

      {/* Restaurant filter — manager only */}
      {isManager && restaurants.length > 0 && (
        <div className="mb-4">
          <Select value={restFilter} onValueChange={setRestFilter}>
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

      {/* Days */}
      <div className="space-y-4">
        {weekDays.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd')
          const dayTurns = turnsByDate[dateStr] ?? []
          return (
            <div key={dateStr}>
              <h2 className="text-sm font-semibold text-foreground capitalize mb-2">
                {formatInTimeZone(day, TZ, 'EEEE d MMMM', { locale: it })}
              </h2>
              {dayTurns.length === 0 ? (
                <div className="text-xs text-muted-foreground border border-dashed border-border rounded-sm px-3 py-2.5">
                  Nessun turno
                </div>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence initial={false} mode="popLayout">
                    {dayTurns.map(turn => (
                      <motion.div
                        key={turn.id}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
                        className="bg-card border border-border rounded-sm px-4 py-3 flex items-center gap-3"
                      >
                        <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <span className="text-sm font-medium text-foreground">
                              {turn.profile?.full_name ?? '—'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {turn.start_time.slice(0, 5)} – {turn.end_time.slice(0, 5)}
                            </span>
                            {turn.is_extraordinary ? (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border font-medium whitespace-nowrap ${EXTRAORDINARY_BADGE}`}>
                                Straordinario
                              </span>
                            ) : (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border font-medium whitespace-nowrap ${STANDARD_BADGE}`}>
                                Standard
                              </span>
                            )}
                            {turn.department && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 h-auto rounded-sm capitalize">
                                {turn.department}
                              </Badge>
                            )}
                            {isManager && turn.restaurant && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 h-auto rounded-sm">
                                {turn.restaurant.name}
                              </Badge>
                            )}
                          </div>
                          {turn.notes && (
                            <p className="text-xs text-muted-foreground mt-0.5">{turn.notes}</p>
                          )}
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(turn)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => handleDelete(turn.id)}
                          className="text-destructive hover:text-destructive dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Create / edit modal ─────────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTurn ? 'Modifica Turno' : bulkMode ? 'Inserimento Multiplo' : 'Nuovo Turno'}</DialogTitle>
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

            {/* Inserimento Multiplo toggle — solo in creazione */}
            {!editingTurn && (
              <div className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5">
                <div>
                  <Label className="text-sm">Inserimento Multiplo</Label>
                  <p className="text-xs text-muted-foreground">Crea più turni in un range di date, sui giorni selezionati</p>
                </div>
                <Switch checked={bulkMode} onCheckedChange={setBulkMode} />
              </div>
            )}

            {/* Date */}
            {bulkMode ? (
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

            {/* Times */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Ora inizio *</Label>
                <Input type="time" value={fStart} onChange={e => setFStart(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Ora fine *</Label>
                <Input type="time" value={fEnd} onChange={e => setFEnd(e.target.value)} />
              </div>
            </div>

            {/* Extraordinary toggle */}
            <div className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5">
              <div>
                <Label className="text-sm">Turno Straordinario</Label>
                <p className="text-xs text-muted-foreground">Evidenziato in arancione nel calendario</p>
              </div>
              <Switch checked={fExtraordinary} onCheckedChange={setFExtraordinary} />
            </div>

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
                saving || !fUserId || !fStart || !fEnd ||
                (bulkMode ? (!fDate || !fEndDate || fDaysOfWeek.length === 0) : !fDate)
              }
            >
              {saving ? 'Salvataggio...' : editingTurn ? 'Salva modifiche' : bulkMode ? 'Crea turni' : 'Crea turno'}
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
                  <Input type="time" value={sStart} onChange={e => setSStart(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Ora fine *</Label>
                  <Input type="time" value={sEnd} onChange={e => setSEnd(e.target.value)} />
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

      {/* ── Popola da Turni Standard ────────────────────────────────── */}
      <Dialog open={showPopolaModal} onOpenChange={setShowPopolaModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Popola da Turni Standard</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Seleziona il periodo da popolare. Verranno generati i turni a partire dai
              Turni Fissi configurati, saltando le date in cui esiste già un turno per il dipendente.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Dal *</Label>
                <Input type="date" value={popolaStart} onChange={e => setPopolaStart(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Al *</Label>
                <Input type="date" value={popolaEnd} onChange={e => setPopolaEnd(e.target.value)} />
              </div>
            </div>
            {popolaResult && (
              <p className="text-sm font-medium text-foreground">{popolaResult}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPopolaModal(false)}>Chiudi</Button>
            <Button onClick={handlePopolaFromStandard} disabled={popolaSaving || !popolaStart || !popolaEnd}>
              {popolaSaving ? 'Generazione...' : 'Genera turni'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
