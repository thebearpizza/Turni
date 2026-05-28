import { createClient } from '@/lib/supabase/server'
import { DipendentiClient } from '@/components/manager/DipendentiClient'

export default async function DipendentiPage({
  searchParams,
}: {
  searchParams: Promise<{ restaurant_id?: string }>
}) {
  const { restaurant_id: restaurantIdParam } = await searchParams

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

  let query = supabase
    .from('profiles')
    .select('*, restaurant:restaurants(id, name)')
    .order('full_name')

  if (profile?.role === 'capo_servizio' && profile.restaurant_id) {
    // Capo servizio is always locked to own restaurant — URL param ignored
    query = query.eq('restaurant_id', profile.restaurant_id)
  } else if (profile?.role === 'manager' && restaurantIdParam) {
    query = query.eq('restaurant_id', restaurantIdParam)
  }

  const { data: dipendenti } = await query

  return (
    <div className="p-6 lg:p-8">
      <DipendentiClient
        initialDipendenti={dipendenti ?? []}
        restaurants={restaurants ?? []}
        currentUserRole={profile?.role ?? 'capo_servizio'}
        currentIsDirettore={profile?.is_direttore ?? false}
        currentRestaurantId={profile?.restaurant_id ?? null}
        currentRestaurantFilter={restaurantIdParam ?? null}
      />
    </div>
  )
}
