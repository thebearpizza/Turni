import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ChiusuraCassaClient } from '@/components/cassa/ChiusuraCassaClient'

export default async function ChiusuraCassaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.role === 'capo_servizio' && profile.is_direttore) redirect('/cassa/fatture')
  // Senza questo la hostess "non manager, non direttore" cadrebbe nella
  // vista cassiere qui sotto — quella cassa non le compete.
  if (profile.role === 'hostess') redirect('/cassa/prenotazioni')

  if (profile.role === 'manager') {
    const { data: restaurants } = await supabase
      .from('restaurants')
      .select('id, name')
      .order('name')

    return (
      <ChiusuraCassaClient
        role="manager"
        restaurants={restaurants ?? []}
        fixedRestaurantId={null}
        userId={user.id}
      />
    )
  }

  const { data: restaurant } = profile.restaurant_id
    ? await supabase
        .from('restaurants')
        .select('id, name')
        .eq('id', profile.restaurant_id)
        .single()
    : { data: null }

  return (
    <ChiusuraCassaClient
      role="cassiere"
      restaurants={restaurant ? [restaurant] : []}
      fixedRestaurantId={profile.restaurant_id}
      userId={user.id}
    />
  )
}
