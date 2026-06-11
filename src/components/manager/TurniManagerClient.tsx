'use client'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { createTurn, updateTurn, deleteTurn, type TurnInput } from '@/app/actions/turni'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Pencil, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { startOfWeek, addDays, addWeeks, format } from 'date-fns'
import { it } from 'date-fns/locale'
import type { Turn, Department } from '@/types'

const TZ = 'Europe/Rome'

type StaffMember = { id: string; full_name: string; department: string | null; restaurant_id: string | null }
type RestaurantItem = { id: string; name: string }

interface Props {
  initialTurns:        Turn[]
  staff:               StaffMember[]
  restaurants:         RestaurantItem[]
  currentUserId:       string
  currentUserRole:     string
  currentDepartment:   string | null
  currentRestaurantId: string | null
  currentIsDirettore:  boolean
}

const EXTRAORDINARY_BADGE = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800'
const STANDARD_BADGE = 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800'

export function TurniManagerClient({
  initialTurns, staff, restaurants,
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
  const [fStart, setFStart] = useState('')
  const [fEnd, setFEnd] = useState('')
  const [fExtraordinary, setFExtraordinary] = useState(false)
  const [fNotes, setFNotes] = useState('')

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
    setFStart('')
    setFEnd('')
    setFExtraordinary(false)
    setFNotes('')
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
    setError(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!fUserId || !fDate || !fStart || !fEnd) return
    setSaving(true)
    setError(null)
    try {
      const selected = staff.find(s => s.id === fUserId)
      const payload: TurnInput = {
        user_id:          fUserId,
        restaurant_id:    selected?.restaurant_id ?? fRestaurantId ?? currentRestaurantId ?? '',
        department:       (selected?.department ?? currentDepartment) as Department | null,
        date:             fDate,
        start_time:       fStart,
        end_time:         fEnd,
        is_extraordinary: fExtraordinary,
        notes:            fNotes.trim() || null,
      }

      if (editingTurn) {
        const updated = await updateTurn(editingTurn.id, payload)
        setTurns(prev => prev.map(t => t.id === updated.id ? updated : t))
      } else {
        const created = await createTurn(payload)
        setTurns(prev => [...prev, created])
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

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Gestione Turni</h1>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4" /> Nuovo Turno
        </Button>
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

      {/* Week navigation */}
      <div className="flex items-center justify-between mb-5">
        <Button variant="outline" size="sm" onClick={() => setWeekOffset(w => w - 1)}>
          <ChevronLeft className="w-4 h-4" /> Settimana prec.
        </Button>
        <div className="text-sm font-medium text-foreground">
          {formatInTimeZone(weekStart, TZ, "d MMM", { locale: it })} – {formatInTimeZone(addDays(weekStart, 6), TZ, "d MMM yyyy", { locale: it })}
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} className="ml-2 text-xs text-muted-foreground hover:text-foreground underline">
              oggi
            </button>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setWeekOffset(w => w + 1)}>
          Settimana succ. <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

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
            <DialogTitle>{editingTurn ? 'Modifica Turno' : 'Nuovo Turno'}</DialogTitle>
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

            {/* Date */}
            <div className="space-y-2">
              <Label>Data *</Label>
              <Input type="date" value={fDate} onChange={e => setFDate(e.target.value)} />
            </div>

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
            <Button onClick={handleSave} disabled={saving || !fUserId || !fDate || !fStart || !fEnd}>
              {saving ? 'Salvataggio...' : editingTurn ? 'Salva modifiche' : 'Crea turno'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
