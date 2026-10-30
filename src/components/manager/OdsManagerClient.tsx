'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createOdsTask } from '@/app/actions/ods'
import { useAccountStatus } from '@/contexts/AccountStatusContext'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { RestaurantFilter } from '@/components/manager/RestaurantFilter'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { DEPARTMENTS, ODS_TYPE_LABELS, ODS_DAYS_IT } from '@/types'
import { LoadingDots } from '@/components/shared/LoadingDots'
import type { OdsTask, OdsCompletion, OdsTaskType } from '@/types'

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
  currentIsDirettore?: boolean
}

export function OdsManagerClient({
  initialTasks, completions, staff, restaurants,
  currentUserId, currentUserRole, currentDepartment, currentRestaurantId,
  currentIsDirettore = false,
}: Props) {
  const { isPending } = useAccountStatus()
  const isManager = currentUserRole === 'manager'
  // Direttore (capo_servizio): operates across all departments of its restaurant.
  const isDirettore = currentUserRole === 'capo_servizio' && currentIsDirettore
  // Whether the department field is locked to the caller's own department.
  const deptLocked = !!currentDepartment && !isDirettore

  const [tasks, setTasks]             = useState<OdsTask[]>(initialTasks)
  const [deptFilter, setDeptFilter]   = useState<string>('tutti')
  const [restFilter, setRestFilter]   = useState<string>('tutti')

  // Mark ODS notifications as read when this page is mounted — scoped to
  // this user and to ODS links only, altrimenti azzera anche notifiche di
  // altre sezioni (es. richieste di assenza) senza che siano state viste.
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', currentUserId)
      .is('read_at', null)
      .like('link', '%/ods%')
      .then(() => {})
  }, [currentUserId])
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

  // Manager restaurant filter — applied before department filter
  const tasksByRestaurant = (isManager && restFilter !== 'tutti')
    ? tasks.filter(t => t.restaurant_id === restFilter)
    : tasks

  // Visible departments derive from the already-restaurant-filtered list
  const allDepts = Array.from(new Set(tasksByRestaurant.map(t => t.department))).sort()

  const filteredTasks = deptFilter === 'tutti'
    ? tasksByRestaurant
    : tasksByRestaurant.filter(t => t.department === deptFilter)

  // Staff scoped to the selected department (for the create form).
  // A direttore can assign to anyone in the currently-selected department.
  // NB: lo staff arriva dalla page senza restaurant_id, quindi qui non si
  // può ancora escludere il personale di altri locali — solo il reparto.
  const scopedStaff = isDirettore || !currentDepartment
    ? (fDept ? staff.filter(s => s.department === fDept) : staff)
    : staff.filter(s => s.department === fDept || s.department === currentDepartment)

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
    try {
      const task = await createOdsTask({
        title:           fTitle.trim(),
        department:      fDept,
        restaurant_id:   (fRestaurantId || currentRestaurantId) ?? '',
        type:            fType,
        recurrence_days: (fType === 'settimanale' || fType === 'bisettimanale') ? fDays : [],
        assigned_to:     fAssignedTo === '__none__' ? null : fAssignedTo,
      })
      setTasks(prev => [task, ...prev])
      resetForm()
      setShowForm(false)
    } catch (err) {
      console.error('Errore creazione ODS:', err)
      toast({
        title: 'Creazione non riuscita',
        description: err instanceof Error ? err.message : 'Riprova più tardi',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Eliminare questo ordine di servizio?')) return
    const supabase = createClient()
    const { error } = await supabase.from('ods_tasks').delete().eq('id', id)
    if (error) {
      toast({ title: 'Eliminazione non riuscita', description: error.message, variant: 'destructive' })
      return
    }
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  const canDelete = (task: OdsTask) =>
    isManager ||
    (currentUserRole === 'capo_servizio' &&
      (isDirettore || !currentDepartment || task.department === currentDepartment))

  const todayName = formatInTimeZone(new Date(), TZ, 'EEEE', { locale: it }).toLowerCase()

  return (
    <div className="flex flex-col gap-3">
      {/* Titolo grande con avanzamento di oggi (capo servizio e direttore
          hanno l'intestazione del locale; il manager ha "ODS" nel guscio). */}
      {(() => {
        const diOggi = filteredTasks.filter(t => t.type === 'quotidiana' || t.type === 'straordinaria' || t.recurrence_days.some(d => d.toLowerCase() === todayName))
        const fatti = diOggi.filter(t => (completionMap[t.id] ?? []).length > 0).length
        return (
          <div className="flex flex-col gap-3 px-1">
            <div className="flex items-baseline justify-between">
              <h1 className="text-[28px] font-semibold tracking-[-0.8px]">
                {isManager ? 'Ordini di servizio' : `ODS${deptLocked && currentDepartment ? ` ${currentDepartment.toLowerCase()}` : ''}`}
              </h1>
              <span className="font-mono text-sm font-medium text-muted-foreground">{fatti}/{diOggi.length}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-border">
              <div className="h-1 bg-turni transition-[width] duration-500" style={{ width: diOggi.length ? `${(fatti / diOggi.length) * 100}%` : '0%' }} />
            </div>
          </div>
        )
      })()}

      {isManager && restaurants.length > 0 && (
        <RestaurantFilter
          restaurants={restaurants}
          value={restFilter}
          onChange={v => { setRestFilter(v); setDeptFilter('tutti') }}
        />
      )}

      {allDepts.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {['tutti', ...allDepts].map(dept => (
            <button
              key={dept}
              onClick={() => setDeptFilter(dept)}
              className={`flex h-9 items-center rounded-full px-3.5 text-[13px] font-medium capitalize transition-colors active:scale-[0.97] ${
                deptFilter === dept ? 'bg-primary text-primary-foreground' : 'border border-line-strong'
              }`}
            >
              {dept === 'tutti' ? 'Tutti' : dept}
            </button>
          ))}
        </div>
      )}

      {filteredTasks.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted-foreground">Nessun ordine di servizio</div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredTasks.map((task, i) => {
            const taskCompletions = completionMap[task.id] ?? []
            const isVisibleToday =
              task.type === 'quotidiana' || task.type === 'straordinaria' ||
              task.recurrence_days.some(d => d.toLowerCase() === todayName)
            const fatto = taskCompletions.length > 0
            const ultimo = taskCompletions[taskCompletions.length - 1]
            const chi = fatto
              ? `${ultimo?.profile?.full_name ?? 'Qualcuno'}${ultimo ? ` · ${formatInTimeZone(new Date(ultimo.completed_at), TZ, 'HH:mm')}` : ''}${taskCompletions.length > 1 ? ` e altri ${taskCompletions.length - 1}` : ''}`
              : task.assignee
                ? task.assignee.full_name
                : task.type === 'straordinaria' ? 'Straordinario · da assegnare'
                : `Tutto il reparto ${task.department.toLowerCase()} · ${task.type === 'quotidiana' ? 'quotidiano' : task.recurrence_days.join(', ')}`
            return (
              <div
                key={task.id}
                className={`anim-inrise flex flex-col gap-2 rounded-[12px] border border-border bg-card px-3.5 py-3 ${!isVisibleToday ? 'opacity-50' : ''}`}
                style={{ animationDelay: `${Math.min(i, 10) * 70}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[15px] font-medium leading-snug">{task.title}</span>
                  <span className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.04em] ${
                    fatto ? 'bg-ok-tint text-ok' : !isVisibleToday ? 'bg-secondary text-muted-foreground' : 'bg-secondary text-muted-foreground'
                  }`}>
                    {fatto ? 'Fatto' : isVisibleToday ? 'Da fare' : 'Non oggi'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fatto && setViewingTask(task)}
                    className="min-w-0 flex-1 truncate text-left text-[13px] text-muted-foreground"
                  >
                    {chi}
                  </button>
                  {(isManager || isDirettore) && (
                    <span className="flex-none text-[11px] font-medium uppercase tracking-[.04em] text-muted-foreground">{task.department}</span>
                  )}
                  {canDelete(task) && (
                    <button type="button" onClick={() => handleDelete(task.id)} className="flex-none text-xs font-semibold text-neg active:scale-[0.97]">Elimina</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="sticky bottom-0 -mx-1 bg-gradient-to-t from-background via-background to-transparent px-1 pb-1 pt-3">
        <Button
          size="lg"
          className="w-full"
          onClick={() => { resetForm(); setShowForm(true) }}
          disabled={isPending}
          title={isPending ? 'Disponibile dopo l\'attivazione' : undefined}
        >
          + Nuovo ordine di servizio
        </Button>
      </div>

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
              {deptLocked ? (
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
              {saving ? <>Salvataggio<LoadingDots /></> : 'Crea Ordine'}
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
