import { createClient } from '@/lib/supabase/server'
import { AssenzeClient } from '@/components/manager/AssenzeClient'
import { formatInTimeZone } from 'date-fns-tz'

const TZ = 'Europe/Rome'

export default async function AssenzePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore')
    .eq('id', user!.id)
    .single()

  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('id, name')
    .order('name')

  const { data: dipendenti } = await supabase
    .from('profiles')
    .select('id, full_name, restaurant_id')
    .eq('role', 'dipendente')
    .order('full_name')

  const nowRome = formatInTimeZone(new Date(), TZ, 'yyyy-MM')
  const [year, month] = nowRome.split('-').map(Number)
  const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString().split('T')[0]
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().split('T')[0]

  let query = supabase
    .from('absences')
    .select('*, profile:profiles!user_id(id, full_name), restaurant:restaurants(id, name)')
    .lte('start_date', endDate)
    .gte('end_date', startDate)
    .order('start_date', { ascending: false })

  if (profile?.role === 'capo_servizio' && profile.restaurant_id) {
    query = query.eq('restaurant_id', profile.restaurant_id)
  }

  const { data: absences, error: absencesError } = await query
  if (absencesError) console.error('[assenze] query error:', absencesError.message)

  return (
    <div className="p-6 lg:p-8">
      <AssenzeClient
        initialAbsences={absences ?? []}
        restaurants={restaurants ?? []}
        dipendenti={dipendenti ?? []}
        currentUserRole={profile?.role ?? 'capo_servizio'}
        currentRestaurantId={profile?.restaurant_id ?? null}
        isDirectore={profile?.is_direttore ?? false}
      />
    </div>
  )
}
