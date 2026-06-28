'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { saveToOfflineQueue } from '@/lib/offlineSync'
import { ClipboardList, Check } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { ODS_TYPE_LABELS } from '@/types'
import type { OdsTask, OdsTaskType } from '@/types'

const TZ = 'Europe/Rome'

const FILTERS: { key: 'tutte' | OdsTaskType; label: string }[] = [
  { key: 'tutte',         label: 'Tutte' },
  { key: 'quotidiana',    label: 'Quotidiane' },
  { key: 'settimanale',   label: 'Settimanali' },
  { key: 'bisettimanale', label: 'Bisettimanali' },
  { key: 'straordinaria', label: 'Straordinarie' },
]

interface Props {
  tasks:            OdsTask[]
  completedTaskIds: string[]
  userId:           string
  userDepartment:   string | null
}

export function OdsClient({ tasks, completedTaskIds, userId, userDepartment }: Props) {
  const [taskList, setTaskList]     = useState<OdsTask[]>(tasks)
  const [completed, setCompleted]   = useState<Set<string>>(new Set(completedTaskIds))
  const [filter, setFilter]         = useState<'tutte' | OdsTaskType>('tutte')
  const [offlineMsg, setOfflineMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!offlineMsg) return
    const t = setTimeout(() => setOfflineMsg(null), 5000)
    return () => clearTimeout(t)
  }, [offlineMsg])

  // ── Refetch al mount — la pagina è renderizzata lato server e può
  // arrivare da un layer di cache (Service Worker / Router Cache di Next)
  // con una lista vecchia, in cui mancano gli ordini di servizio appena
  // creati dal manager. Rileggiamo i task dal client all'avvio così la
  // lista è sempre autorevole. La RLS limita ai task di competenza. ────
  const reloadTasks = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('ods_tasks')
      .select('*, assignee:profiles!assigned_to(id, full_name)')
      .order('created_at', { ascending: false })
    if (data) setTaskList(data as unknown as OdsTask[])
  }, [])

  useEffect(() => { reloadTasks() }, [reloadTasks])

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null)
      .then(() => {})
  }, [])

  const todayName = formatInTimeZone(new Date(), TZ, 'EEEE', { locale: it }).toLowerCase()

  const visible = taskList.filter(t => {
    if (t.type === 'quotidiana' || t.type === 'straordinaria') return true
    return t.recurrence_days.some(d => d.toLowerCase() === todayName)
  })

  const personalTasks   = visible.filter(t => t.assigned_to === userId)
  const departmentTasks = visible.filter(t => t.assigned_to === null)
  const filtered = filter === 'tutte'
    ? departmentTasks
    : departmentTasks.filter(t => t.type === filter)

  async function handleToggle(taskId: string) {
    const frozenAt     = new Date().toISOString()
    const wasCompleted = completed.has(taskId)

    // Optimistic update — UI stays responsive regardless of network
    setCompleted(prev => {
      const next = new Set(prev)
      wasCompleted ? next.delete(taskId) : next.add(taskId)
      return next
    })

    try {
      const supabase = createClient()
      if (wasCompleted) {
        await supabase.from('ods_completions').delete().eq('task_id', taskId).eq('user_id', userId)
      } else {
        await supabase.from('ods_completions').insert({ task_id: taskId, user_id: userId })
      }
    } catch (err) {
      if (err instanceof TypeError) {
        // Network down — save to IndexedDB queue with the frozen timestamp
        await saveToOfflineQueue('ods-toggle', {
          task_id:  taskId,
          user_id:  userId,
          action:   wasCompleted ? 'uncomplete' : 'complete',
          frozenAt,
        }).catch(() => {})
        setOfflineMsg('Sei offline. Salvato sul dispositivo, si aggiornerà automaticamente.')
      } else {
        // Server/auth error — revert optimistic update
        setCompleted(prev => {
          const next = new Set(prev)
          wasCompleted ? next.add(taskId) : next.delete(taskId)
          return next
        })
      }
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col">
      <AnimatePresence>
        {offlineMsg && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="mx-4 mt-3 px-3 py-2 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900"
          >
            {offlineMsg}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-center gap-3 px-4 pt-5 pb-3 border-b border-border">
        <ClipboardList className="w-5 h-5 text-muted-foreground shrink-0" />
        <div>
          <h1 className="font-semibold text-sm leading-tight">Ordine di Servizio</h1>
          <p className="text-muted-foreground text-xs">{userDepartment ?? 'Tutti i reparti'}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6 space-y-6">

        {personalTasks.length > 0 && (
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Istruzioni Personali
            </p>
            <div className="space-y-1.5">
              <AnimatePresence initial={false}>
                {personalTasks.map((t, i) => (
                  <TaskRow key={t.id} index={i} task={t} completed={completed.has(t.id)} onToggle={() => handleToggle(t.id)} />
                ))}
              </AnimatePresence>
            </div>
          </section>
        )}

        <section>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Istruzioni di Reparto
          </p>

          <div className="flex gap-1.5 flex-wrap mb-3">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`text-xs px-2.5 py-1 rounded-sm border transition-colors ${
                  filter === f.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-muted-foreground border-border hover:bg-accent hover:text-foreground'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-10 text-center">
              <ClipboardList className="w-7 h-7 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">Nessuna istruzione</p>
            </motion.div>
          ) : (
            <div className="space-y-1.5">
              <AnimatePresence initial={false}>
                {filtered.map((t, i) => (
                  <TaskRow key={t.id} index={i} task={t} completed={completed.has(t.id)} onToggle={() => handleToggle(t.id)} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function TaskRow({ task, completed, onToggle, index }: {
  task: OdsTask; completed: boolean; onToggle: () => void; index: number
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      whileTap={{ scale: 0.985 }}
      onClick={onToggle}
      className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-sm border text-left transition-colors ${
        completed
          ? 'bg-muted/50 border-border/50'
          : 'bg-card border-border hover:bg-accent/30 active:bg-accent/50'
      }`}
    >
      <motion.div
        animate={completed ? { scale: [1, 1.25, 1] } : { scale: 1 }}
        transition={{ duration: 0.18 }}
        className={`mt-0.5 w-4 h-4 rounded-sm border shrink-0 flex items-center justify-center transition-colors ${
          completed ? 'bg-primary border-primary' : 'border-input bg-background'
        }`}
      >
        <AnimatePresence>
          {completed && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Check className="w-2.5 h-2.5 text-primary-foreground" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${
          completed ? 'line-through text-zinc-400 dark:text-zinc-500' : 'text-foreground'
        }`}>
          {task.title}
        </p>
        {(task.type === 'settimanale' || task.type === 'bisettimanale') &&
          task.recurrence_days.length > 0 && (
          <p className="text-xs text-muted-foreground mt-0.5 capitalize">
            {task.recurrence_days.join(', ')}
          </p>
        )}
      </div>

      {task.type === 'straordinaria' && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800 shrink-0 self-start whitespace-nowrap">
          Straord.
        </span>
      )}
    </motion.button>
  )
}
