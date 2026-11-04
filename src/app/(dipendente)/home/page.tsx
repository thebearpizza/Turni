import { createClient } from '@/lib/supabase/server'
import { EmployeeHomeClient } from '@/components/dipendente/EmployeeHomeClient'
import { autoCloseStaleShifts } from '@/lib/autoCloseStaleShifts'
import { formatInTimeZone } from 'date-fns-tz'
import type { Turn } from '@/types'

export default async function EmployeeHomePage({ searchParams }: { searchParams: Promise<{ bacheca?: string }> }) {
  const { bacheca } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, restaurant:restaurants(id, name, latitude, longitude)')
    .eq('id', user!.id)
    .single()

  // Close a shift the employee forgot to timbrare l'uscita on (open >16h) before
  // reading the open shift, so the UI doesn't show an endless running counter.
  await autoCloseStaleShifts(supabase, user!.id)

  // Open shift = any record with check_out IS NULL, regardless of when it started.
  // Date-filtering here caused cross-midnight shifts to disappear from the UI.
  const { data: openAttendance } = await supabase
    .from('attendances')
    .select('*')
    .eq('user_id', user!.id)
    .is('check_out', null)
    .order('check_in', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Turno di oggi e prossimi turni per la scheda sotto il pulsante.
  const oggi = formatInTimeZone(new Date(), 'Europe/Rome', 'yyyy-MM-dd')
  const { data: turni } = await supabase
    .from('turns')
    .select('*')
    .eq('user_id', user!.id)
    .gte('date', oggi)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(30)

  return (
    <EmployeeHomeClient
      profile={profile}
      openAttendance={openAttendance}
      userId={user!.id}
      turni={(turni ?? []) as Turn[]}
      apriBacheca={bacheca === '1'}
    />
  )
}
