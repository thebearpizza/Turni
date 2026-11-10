import { createClient } from '@/lib/supabase/server'
import { OdsManagerClient, type CompletamentoRiga, type PersonaOds } from '@/components/manager/OdsManagerClient'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { OdsTask } from '@/types'

const TZ = 'Europe/Rome'

// Gli ODS ripartono alle 04:00: prima di quell'ora "oggi" è ancora ieri.
function getOdsCutoff(): string {
  const now = new Date()
  const romeHour = parseInt(formatInTimeZone(now, TZ, 'H'), 10)
  const refDate = romeHour < 4 ? new Date(now.getTime() - 86_400_000) : now
  const cutoffDate = formatInTimeZone(refDate, TZ, 'yyyy-MM-dd')
  return fromZonedTime(`${cutoffDate}T04:00:00`, TZ).toISOString()
}

export default async function OdsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, department, restaurant_id, is_direttore')
    .eq('id', user!.id)
    .single()

  const isManager = profile?.role === 'manager'
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  const vista = isManager ? 'manager' : isDirettore ? 'direttore' : 'capo'
  // Direttore e capo servizio: sempre e solo il proprio locale.
  const locale = isManager ? null : profile?.restaurant_id ?? null

  let qTask = supabase.from('ods_tasks').select('*, assignee:profiles!assigned_to(id, full_name)').order('created_at', { ascending: false })
  let qStaff = supabase.from('profiles').select('id, full_name, department, restaurant_id').in('role', ['dipendente', 'capo_servizio']).order('full_name')
  let qRist = supabase.from('restaurants').select('id, name').order('name')
  if (locale) { qTask = qTask.eq('restaurant_id', locale); qStaff = qStaff.eq('restaurant_id', locale); qRist = qRist.eq('id', locale) }

  const [{ data: tasks }, { data: completions }, { data: staff }, { data: restaurants }] = await Promise.all([
    qTask,
    supabase.from('ods_completions').select('task_id, user_id, completed_at, profile:profiles!user_id(id, full_name)').gte('completed_at', getOdsCutoff()),
    qStaff,
    qRist,
  ])

  // Solo i completamenti degli ODS visibili: il capo servizio non riceve
  // quelli degli altri locali.
  const ids = new Set((tasks ?? []).map(t => (t as { id: string }).id))

  return (
    <OdsManagerClient
      vista={vista}
      initialTasks={(tasks ?? []) as unknown as OdsTask[]}
      completions={((completions ?? []) as unknown as CompletamentoRiga[]).filter(c => ids.has(c.task_id))}
      staff={(staff ?? []) as PersonaOds[]}
      restaurants={restaurants ?? []}
      currentUserId={user!.id}
      currentDepartment={profile?.department ?? null}
      currentRestaurantId={locale}
    />
  )
}
