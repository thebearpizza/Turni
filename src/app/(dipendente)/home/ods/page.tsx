import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { OdsClient } from '@/components/dipendente/OdsClient'
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
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('department, restaurant_id')
    .eq('id', user.id)
    .single()

  const cutoff = getOdsCutoff()

  const [{ data: tasks }, { data: completions }] = await Promise.all([
    supabase
      .from('ods_tasks')
      .select('*, assignee:profiles!assigned_to(id, full_name)')
      .order('created_at', { ascending: false }),
    supabase
      .from('ods_completions')
      .select('task_id')
      .eq('user_id', user.id)
      .gte('completed_at', cutoff),
  ])

  return (
    <OdsClient
      tasks={(tasks as unknown as import('@/types').OdsTask[]) ?? []}
      completedTaskIds={(completions ?? []).map(c => c.task_id)}
      userId={user.id}
      userDepartment={profile?.department ?? null}
    />
  )
}
