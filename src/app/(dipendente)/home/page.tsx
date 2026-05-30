import { createClient } from '@/lib/supabase/server'
import { EmployeeHomeClient } from '@/components/dipendente/EmployeeHomeClient'

export default async function EmployeeHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, restaurant:restaurants(id, name, latitude, longitude)')
    .eq('id', user!.id)
    .single()

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

  return (
    <EmployeeHomeClient
      profile={profile}
      openAttendance={openAttendance}
      userId={user!.id}
    />
  )
}
