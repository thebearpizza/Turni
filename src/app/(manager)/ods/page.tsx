import { createClient } from '@/lib/supabase/server'
import { OdsManagerClient } from '@/components/manager/OdsManagerClient'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const TZ = 'Europe/Rome'

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
    .select('role, department, restaurant_id, can_post_bulletin, is_direttore')
    .eq('id', user!.id)
    .single()

  const cutoff = getOdsCutoff()

  const isCapo = profile?.role === 'capo_servizio'
  const restaurantFilter = isCapo ? profile?.restaurant_id : null

  let tasksQuery = supabase
    .from('ods_tasks')
    .select('*, assignee:profiles!assigned_to(id, full_name)')
    .order('created_at', { ascending: false })

  // Direttore / capo_servizio: hard-scope to their restaurant
  if (restaurantFilter) {
    tasksQuery = tasksQuery.eq('restaurant_id', restaurantFilter)
  }

  let completionsQuery = supabase
    .from('ods_completions')
    .select('task_id, user_id, completed_at, profile:profiles!user_id(id, full_name)')
    .gte('completed_at', cutoff)

  // Dipendenti for assigned_to dropdown (scoped to restaurant)
  let staffQuery = supabase
    .from('profiles')
    .select('id, full_name, department')
    .in('role', ['dipendente', 'capo_servizio'])
    .order('full_name')

  if (restaurantFilter) {
    staffQuery = staffQuery.eq('restaurant_id', restaurantFilter)
  }

  const [
    { data: rawTasks },
    { data: rawCompletions },
    { data: staff },
    { data: restaurants },
  ] = await Promise.all([
    tasksQuery,
    completionsQuery,
    staffQuery,
    profile?.role === 'manager'
      ? supabase.from('restaurants').select('id, name').order('name')
      : Promise.resolve({ data: [] }),
  ])

  // Scope completions to visible task IDs — prevents capo_servizio from
  // receiving completion records that belong to other restaurants.
  const taskIdSet = new Set((rawTasks ?? []).map(t => (t as { id: string }).id))
  const completions = restaurantFilter
    ? (rawCompletions ?? []).filter(c => taskIdSet.has((c as { task_id: string }).task_id))
    : rawCompletions

  return (
    <div className="p-6 lg:p-8">
      <OdsManagerClient
        initialTasks={(rawTasks as unknown as import('@/types').OdsTask[]) ?? []}
        completions={(completions ?? []) as unknown as (import('@/types').OdsCompletion & { profile?: { id: string; full_name: string } | null })[]}
        staff={staff ?? []}
        restaurants={restaurants ?? []}
        currentUserId={user!.id}
        currentUserRole={profile?.role ?? 'capo_servizio'}
        currentDepartment={profile?.department ?? null}
        currentRestaurantId={profile?.restaurant_id ?? null}
        currentIsDirettore={profile?.is_direttore ?? false}
      />
    </div>
  )
}
