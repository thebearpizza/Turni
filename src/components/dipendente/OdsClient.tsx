'use client'
import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { createClient } from '@/lib/supabase/client'
import { saveToOfflineQueue } from '@/lib/offlineSync'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import type { OdsTask } from '@/types'

const TZ = 'Europe/Rome'

interface Props {
  tasks:            OdsTask[]
  completedTaskIds: string[]
  userId:           string
  userDepartment:   string | null
}

export function OdsClient({ tasks, completedTaskIds, userId, userDepartment }: Props) {
  const [taskList, setTaskList]     = useState<OdsTask[]>(tasks)
  const [completed, setCompleted]   = useState<Set<string>>(new Set(completedTaskIds))
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

  async function handleToggle(taskId: string) {
    const frozenAt     = new Date().toISOString()
    const wasCompleted = completed.has(taskId)

    // Optimistic update — UI stays responsive regardless of network
    setCompleted(prev => {
      const next = new Set(prev)
      wasCompleted ? next.delete(taskId) : next.add(taskId)
      return next
    })

    // supabase-js non lancia mai eccezioni sugli errori di rete o di RLS:
    // il client PostgREST le trasforma sempre in un { error } risolto (vedi
    // node_modules/@supabase/postgrest-js). Un try/catch qui non
    // scatterebbe mai — bisogna leggere il valore restituito.
    const supabase = createClient()
    const { error } = wasCompleted
      ? await supabase.from('ods_completions').delete().eq('task_id', taskId).eq('user_id', userId)
      : await supabase.from('ods_completions').insert({ task_id: taskId, user_id: userId })

    if (error) {
      // status 0 = la richiesta non ha nemmeno raggiunto il server: è
      // l'unico modo affidabile per riconoscere un vero errore di rete
      // (offline) da un errore applicativo/RLS con questo client.
      if (!navigator.onLine || (error as { status?: number }).status === 0) {
        await saveToOfflineQueue('ods-toggle', {
          task_id:  taskId,
          user_id:  userId,
          action:   wasCompleted ? 'uncomplete' : 'complete',
          frozenAt,
        }).catch(() => {})
        setOfflineMsg('Sei offline. Salvato sul dispositivo, si aggiornerà automaticamente.')
      } else {
        // Errore applicativo (es. RLS): annulla l'aggiornamento ottimistico.
        setCompleted(prev => {
          const next = new Set(prev)
          wasCompleted ? next.add(taskId) : next.delete(taskId)
          return next
        })
      }
    }
  }

  useEffect(() => {
    if (offlineMsg) toast({ title: offlineMsg })
  }, [offlineMsg])

  // Filtri del design: Tutti, Per me, e il reparto.
  const [vista, setVista] = useState<'tutti' | 'me' | 'reparto'>('tutti')
  const tutte = [...personalTasks, ...departmentTasks]
  const mostrate = vista === 'me' ? personalTasks : vista === 'reparto' ? departmentTasks : tutte

  // In attesa dell'animazione (striscia di cancellazione), poi la voce
  // scende in fondo alla lista: le fatte stanno sotto.
  const [inCorso, setInCorso] = useState<Set<string>>(new Set())
  const [mossa, setMossa] = useState<string | null>(null)
  function tocca(id: string) {
    if (completed.has(id)) { setMossa(id); handleToggle(id); return }
    if (inCorso.has(id)) return
    setInCorso(prev => new Set(prev).add(id))
    setTimeout(() => {
      setInCorso(prev => { const n = new Set(prev); n.delete(id); return n })
      setMossa(id)
      handleToggle(id)
    }, 900)
  }
  const ordinate = [...mostrate].sort((a, b) => Number(completed.has(a.id)) - Number(completed.has(b.id)))
  const fatte = tutte.filter(t => completed.has(t.id)).length

  const sotto = (t: OdsTask) => {
    const chi = t.assigned_to === userId ? 'Per te' : (t.department ?? userDepartment ?? 'Tutti')
    const quando = t.type === 'straordinaria' ? null
      : t.type === 'quotidiana' ? 'quotidiano'
      : t.recurrence_days.join(', ')
    return t.type === 'straordinaria' ? 'Straordinario' : `${chi} · ${quando}`
  }

  return (
    <div className="flex flex-col pb-6">
      <div className="flex flex-col gap-3 px-5 pb-3.5 pt-2">
        <div className="flex items-baseline justify-between">
          <h1 className="text-[28px] font-semibold tracking-[-0.8px]">Ordini di servizio</h1>
          <span className="font-mono text-sm font-medium text-muted-foreground">{fatte}/{tutte.length}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-border">
          <div className="h-1 bg-turni transition-[width] duration-500" style={{ width: tutte.length ? `${(fatte / tutte.length) * 100}%` : '0%' }} />
        </div>
        <div className="flex gap-1.5">
          {([['tutti', 'Tutti'], ['me', 'Per me'], ['reparto', userDepartment ?? 'Reparto']] as const).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setVista(k)}
              className={cn('flex h-9 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors active:scale-[0.97]',
                vista === k ? 'bg-primary text-primary-foreground' : 'border border-line-strong')}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-4 flex flex-col gap-1.5">
        {ordinate.length === 0 ? (
          <div className="anim-inrise rounded-[8px] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted-foreground">Nessun ordine di servizio per oggi</div>
        ) : ordinate.map((t, i) => {
          const v = completed.has(t.id) || inCorso.has(t.id)
          return (
            <button
              key={t.id + (completed.has(t.id) ? 'd' : 'u')}
              type="button"
              onClick={() => tocca(t.id)}
              className={cn('flex min-h-[60px] items-center gap-3 rounded-[8px] border px-3.5 py-2 text-left transition-[background-color,border-color] duration-300 active:scale-[0.99]',
                mossa === t.id ? 'anim-swapin' : 'anim-inrise',
                v ? 'border-transparent bg-transparent' : 'border-border bg-card')}
              style={{ animationDelay: mossa === t.id ? undefined : `${i * 70}ms` }}
            >
              <span className={cn('flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[12px] border-[1.5px] text-white transition-[background-color,border-color] duration-[250ms]',
                v ? 'border-turni bg-turni' : 'border-line-strong bg-transparent')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: v ? 0 : 1, transition: 'stroke-dashoffset 300ms cubic-bezier(0.22,1,0.36,1) 120ms' }} />
                </svg>
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn('relative self-start text-[15px] font-medium transition-colors delay-200 duration-300', v ? 'text-muted-foreground' : 'text-foreground')}>
                  {t.title}
                  <span className="absolute left-0 top-[52%] h-[1.5px] rounded-full bg-current transition-[width] delay-150 duration-[420ms] ease-[cubic-bezier(0.65,0,0.35,1)]" style={{ width: v ? '100%' : '0%' }} />
                </span>
                <span className="text-xs text-muted-foreground">{sotto(t)}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
