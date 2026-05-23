import { createClient } from '@/lib/supabase/server'
import { EmployeeHomeClient } from '@/components/dipendente/EmployeeHomeClient'

export default async function EmployeeHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, restaurant:restaurants(id, name)')
    .eq('id', user!.id)
    .single()

  // Controlla se c'è un turno aperto oggi
  const today = new Date().toISOString().split('T')[0]
  const { data: openAttendance } = await supabase
    .from('attendances')
    .select('*')
    .eq('user_id', user!.id)
    .is('check_out', null)
    .gte('check_in', today + 'T00:00:00Z')
    .maybeSingle()

  return (
    <EmployeeHomeClient
      profile={profile}
      openAttendance={openAttendance}
      userId={user!.id}
    />
  )
}
