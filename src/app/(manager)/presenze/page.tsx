import { createClient } from '@/lib/supabase/server'
import { PresenzeClient, type AbsenceItem } from '@/components/manager/PresenzeClient'
import { formatInTimeZone } from 'date-fns-tz'

const TZ = 'Europe/Rome'

export default async function PresenzePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id')
    .eq('id', user!.id)
    .single()

  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('id, name')
    .order('name')

  const nowRome = formatInTimeZone(new Date(), TZ, 'yyyy-MM')
  const [year, month] = nowRome.split('-').map(Number)
  const startDate = new Date(Date.UTC(year, month - 1, 1))
  const endDate   = new Date(Date.UTC(year, month, 0, 23, 59, 59))

  // Date boundaries for absence range (YYYY-MM-DD strings, no timezone shift needed)
  const monthStart = `${nowRome}-01`
  const monthEnd   = `${nowRome}-${String(new Date(Date.UTC(year, month, 0)).getDate()).padStart(2, '0')}`

  let presenzeQuery = supabase
    .from('attendances')
    .select('*, profile:profiles(id, full_name, role), restaurant:restaurants(id, name)')
    .gte('check_in', startDate.toISOString())
    .lte('check_in', endDate.toISOString())
    .order('check_in', { ascending: false })

  // Approved absences that overlap with the current month
  let absencesQuery = supabase
    .from('absences')
    .select('id, user_id, restaurant_id, type, start_date, end_date, profile:profiles!user_id(id, full_name)')
    .eq('status', 'approved')
    .lte('start_date', monthEnd)
    .gte('end_date', monthStart)

  if (profile?.role === 'capo_servizio' && profile.restaurant_id) {
    presenzeQuery  = presenzeQuery.eq('restaurant_id', profile.restaurant_id)
    absencesQuery  = absencesQuery.eq('restaurant_id', profile.restaurant_id)
  }

  const [
    { data: presenze, error: presenzeError },
    { data: dipendenti },
    { data: absences },
  ] = await Promise.all([
    presenzeQuery,
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['dipendente', 'capo_servizio'])
      .order('full_name'),
    absencesQuery,
  ])

  if (presenzeError) console.error('[presenze] query error:', presenzeError.message)

  return (
    <div className="p-6 lg:p-8">
      <PresenzeClient
        initialPresenze={presenze ?? []}
        initialAbsences={(absences ?? []) as unknown as AbsenceItem[]}
        restaurants={restaurants ?? []}
        dipendenti={dipendenti ?? []}
        currentUserRole={profile?.role ?? 'capo_servizio'}
        currentRestaurantId={profile?.restaurant_id ?? null}
      />
    </div>
  )
}
