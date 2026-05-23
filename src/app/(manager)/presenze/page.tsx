import { createClient } from '@/lib/supabase/server'
import { PresenzeClient } from '@/components/manager/PresenzeClient'
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

  // Presenze del mese corrente
  const nowRome = formatInTimeZone(new Date(), TZ, 'yyyy-MM')
  const [year, month] = nowRome.split('-').map(Number)
  const startDate = new Date(Date.UTC(year, month - 1, 1))
  const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59))

  let query = supabase
    .from('attendances')
    .select('*, profile:profiles(id, full_name, role), restaurant:restaurants(id, name)')
    .gte('check_in', startDate.toISOString())
    .lte('check_in', endDate.toISOString())
    .order('check_in', { ascending: false })

  if (profile?.role === 'capo_servizio' && profile.restaurant_id) {
    query = query.eq('restaurant_id', profile.restaurant_id)
  }

  const { data: presenze } = await query

  return (
    <div className="p-6 lg:p-8">
      <PresenzeClient
        initialPresenze={presenze ?? []}
        restaurants={restaurants ?? []}
        currentUserRole={profile?.role ?? 'capo_servizio'}
        currentRestaurantId={profile?.restaurant_id ?? null}
      />
    </div>
  )
}
