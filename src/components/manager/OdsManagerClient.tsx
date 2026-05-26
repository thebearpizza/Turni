'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, User, Users, Check } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { DEPARTMENTS, ODS_TYPE_LABELS, ODS_DAYS_IT } from '@/types'
import type { OdsTask, OdsCompletion, OdsTaskType, Department } from '@/types'

const TZ = 'Europe/Rome'

type StaffMember = { id: string; full_name: string; department: string | null }
type RestaurantItem = { id: string; name: string }
type CompletionWithProfile = OdsCompletion & {
  profile?: { id: string; full_name: string } | null
}

interface Props {
  initialTasks:       OdsTask[]
  completions:        CompletionWithProfile[]
  staff:              StaffMember[]
  restaurants:        RestaurantItem[]
  currentUserId:      string
  currentUserRole:    string
  currentDepartment:  string | null
  currentRestaurantId: string | null
}

const TYPE_BADGE_CLASS: Record<OdsTaskType, string> = {
  quotidiana:    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800',
  settimanale:   'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-800',
  bisettimanale: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/30 dark:text-cyan-400 dark:border-cyan-800',
  straordinaria: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800',
}

export function OdsManagerClient({
  initialTasks, completions, staff, restaurants,
  currentUserId, currentUserRole, currentDepartment, currentRestaurantId,
}: Props) {
  const isManager = currentUserRole === 'manager'

  const [tasks, setTasks]       = useState<OdsTask[]>(initialTasks)
  const [deptFilter, setDeptFilter] = useState<string>('tutti')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)

  // Read receipt dialog
  const [viewingTask, setViewingTask] = useState<OdsTask | null>(null)

  // Form state
  const [fTitle, setFTitle]           = useState('')
  const [fDept, setFDept]             = useState<string>(currentDepartment ?? '')
  const [fType, setFType]             = useState<OdsTaskType>('quotidiana')
  const [fDays, setFDays]             = useState<string[]>([])
  const [fAssignedTo, setFAssignedTo] = useState<string>('__none__')
  const [fRestaurantId, setFRestaurantId] = useState<string>(currentRestaurantId ?? '')

  // Build completion map: taskId → list of completors
  const completionMap: Record<string, CompletionWithProfile[]> = {}
  completions.forEach(c => {
    if (!completionMap[c.task_id]) completionMap[c.task_id] = []
    completionMap[c.task_id].push(c)
  })

  // Visible departments for filter
  const allDepts = Array.from(new Set(tasks.map(t => t.department))).sort()

  // Filter tasks
  const filteredTasks = deptFilter === 'tutti'
    ? tasks
    : tasks.filter(t => t.department === deptFilter)

  // Staff scoped to selected restaurant (for the create form)
  const scopedStaff = fRestaurantId
    ? staff.filter(s => !currentDepartment || s.department === fDept || s.department === currentDepartment)
    : staff

  function resetForm() {
    setFTitle('')
    setFDept(currentDepartment ?? '')
    setFType('quotidiana')
    setFDays([])
    setFAssignedTo('__none__')
    setFRestaurantId(currentRestaurantId ?? '')
  }

  function toggleDay(day: string) {
    setFDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
  }

  async function handleCreate() {
    if (!fTitle.trim() || !fDept) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data } = await supabase
      .from('ods_tasks')
      .insert({
        title:           fTitle.trim(),
        department:      fDept,
        restaurant_id:   fRestaurantId || currentRestaurantId,
        creator_id:      user!.id,
        assigned_to:     fAssignedTo === '__none__' ? null : fAssignedTo,
        type:            fType,
        recurrence_days: (fType === 'settimanale' || fType === 'bisettimanale') ? fDays : [],
      })
      .select('*, assignee:profiles!assigned_to(id, full_name)')
      .single()

    if (data) {
      setTasks(prev => [data as unknown as OdsTask, ...prev])
      // Fire-and-forget push notification
      fetch('/api/ods/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: data.id, event: 'created' }),
      }).catch(() => {})
    }

    resetForm()
    setShowForm(false)
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Eliminare questo ordine di servizio?')) return
    const supabase = createClient()
    await supabase.from('ods_tasks').delete().eq('id', id)
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  const canDelete = (task: OdsTask) =>
    isManager ||
    (currentUserRole === 'capo_servizio' &&
      (!currentDepartment || task.department === currentDepartment))

  const todayName = formatInTimeZone(new Date(), TZ, 'EEEE', { locale: it }).toLowerCase()

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Ordini di Servizio</h1>
        <Button size="sm" onClick={() => { resetForm(); setShowForm(true) }}>
          <Plus className="w-4 h-4" /> Nuovo Ordine
        </Button>
      </div>

      {/* Department filter pills */}
      <div className="flex gap-1.5 flex-wrap mb-5">
        {['tutti', ...allDepts].map(dept => (
          <button
            key={dept}
            onClick={() => setDeptFilter(dept)}
            className={`text-xs px-2.5 py-1 rounded-sm border transition-colors capitalize ${
              deptFilter === dept
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:bg-accent hover:text-foreground'
            }`}
          >
            {dept === 'tutti' ? 'Tutti i reparti' : dept}
          </button>
        ))}
      </div>

      {/* Task list */}
      {filteredTasks.length === 0 ? (
        <div className="py-14 text-center text-muted-foreground text-sm border border-border rounded-md">
          Nessun ordine di servizio
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map(task => {
            const taskCompletions = completionMap[task.id] ?? []
            const isVisibleToday =
              task.type === 'quotidiana' || task.type === 'straordinaria' ||
              task.recurrence_days.some(d => d.toLowerCase() === todayName)

            return (
              <div
                key={task.id}
                className={`bg-card border border-border rounded-sm px-4 py-3 flex items-start gap-3 ${
                  !isVisibleToday ? 'opacity-50' : ''
                }`}
              >
                {/* Completion indicator */}
                <div className={`mt-0.5 w-4 h-4 rounded-sm border shrink-0 flex items-center justify-center ${
                  taskCompletions.length > 0
                    ? 'bg-emerald-500 border-emerald-500'
                    : 'border-input bg-background'
                }`}>
                  {taskCompletions.length > 0 && <Check className="w-2.5 h-2.5 text-white" />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-sm font-medium text-foreground leading-snug">
                      {task.title}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border font-medium whitespace-nowrap ${TYPE_BADGE_CLASS[task.type]}`}>
                      {ODS_TYPE_LABELS[task.type]}
                    </span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 h-auto rounded-sm capitalize">
                      {task.department}
                    </Badge>
                  </div>

                  {/* Assignee or days */}
                  {task.assignee ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <User className="w-3 h-3" /> {task.assignee.full_name}
                    </p>
                  ) : (task.type === 'settimanale' || task.type === 'bisettimanale') && task.recurrence_days.length > 0 ? (
                    <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                      {task.recurrence_days.join(', ')}
                    </p>
                  ) : null}

                  {/* Completions count — clickable */}
                  {taskCompletions.length > 0 && (
                    <button
                      onClick={() => setViewingTask(task)}
                      className="text-xs text-muted-foreground/70 hover:text-muted-foreground mt-0.5 flex items-center gap-1"
                    >
                      <Users className="w-3 h-3" />
                      Completato da {taskCompletions.length}{' '}
                      {taskCompletions.length === 1 ? 'persona' : 'persone'}
                    </button>
                  )}
                </div>

                {/* Delete */}
                {canDelete(task) && (
                  <Button
                    variant="ghost" size="icon"
                    onClick={() => handleDelete(task.id)}
                    className="text-destructive hover:text-destructive shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Create modal ───────────────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nuovo Ordine di Servizio</DialogTitle></DialogHeader>
          <div className="space-y-4">

            <div className="space-y-2">
              <Label>Istruzione *</Label>
              <Textarea
                value={fTitle}
                onChange={e => setFTitle(e.target.value)}
                rows={2}
                placeholder="Descrivi il compito da eseguire..."
              />
            </div>

            {/* Reparto */}
            <div className="space-y-2">
              <Label>Reparto *</Label>
              {currentDepartment ? (
                <div className="flex h-10 items-center rounded-sm border border-input bg-muted px-3 text-sm text-muted-foreground">
                  {currentDepartment}
                </div>
              ) : (
                <Select value={fDept} onValueChange={setFDept}>
                  <SelectTrigger><SelectValue placeholder="Seleziona reparto" /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Restaurant — only manager */}
            {isManager && restaurants.length > 0 && (
              <div className="space-y-2">
                <Label>Ristorante *</Label>
                <Select value={fRestaurantId} onValueChange={setFRestaurantId}>
                  <SelectTrigger><SelectValue placeholder="Seleziona ristorante" /></SelectTrigger>
                  <SelectContent>
                    {restaurants.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Type */}
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={fType} onValueChange={v => { setFType(v as OdsTaskType); setFDays([]) }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ODS_TYPE_LABELS) as OdsTaskType[]).map(t => (
                    <SelectItem key={t} value={t}>{ODS_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Day picker for weekly/biweekly */}
            {(fType === 'settimanale' || fType === 'bisettimanale') && (
              <div className="space-y-2">
                <Label>
                  Giorni
                  {fType === 'settimanale' && ' (1 giorno)'}
                  {fType === 'bisettimanale' && ' (2 giorni)'}
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {ODS_DAYS_IT.map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => {
                        if (fType === 'settimanale') {
                          setFDays(fDays[0] === day ? [] : [day])
                        } else {
                          toggleDay(day)
                        }
                      }}
                      className={`text-xs px-2.5 py-1 rounded-sm border capitalize transition-colors ${
                        fDays.includes(day)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-muted-foreground border-border hover:bg-accent'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Assigned to */}
            <div className="space-y-2">
              <Label>Assegna a (opzionale)</Label>
              <Select value={fAssignedTo} onValueChange={setFAssignedTo}>
                <SelectTrigger><SelectValue placeholder="Nessuna assegnazione specifica" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Tutto il reparto</SelectItem>
                  {scopedStaff.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button
              onClick={handleCreate}
              disabled={saving || !fTitle.trim() || !fDept || (isManager && !fRestaurantId)}
            >
              {saving ? 'Salvataggio...' : 'Crea Ordine'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Completions dialog ─────────────────────────────────────── */}
      <Dialog open={!!viewingTask} onOpenChange={() => setViewingTask(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chi ha completato</DialogTitle>
            {viewingTask && (
              <p className="text-sm text-muted-foreground mt-0.5 truncate">{viewingTask.title}</p>
            )}
          </DialogHeader>
          {viewingTask && (
            <div className="divide-y divide-border">
              {(completionMap[viewingTask.id] ?? []).map(c => (
                <div key={c.id} className="flex items-center justify-between py-2.5 gap-4">
                  <span className="text-sm font-medium">{c.profile?.full_name ?? '—'}</span>
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {formatInTimeZone(new Date(c.completed_at), TZ, 'dd-MM-yyyy HH:mm')}
                  </span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingTask(null)}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
