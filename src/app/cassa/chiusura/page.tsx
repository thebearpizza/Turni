import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { archivioAperto, soloVisibili } from '@/lib/localiVisibili'
import { ChiusuraCassaClient } from '@/components/cassa/ChiusuraCassaClient'

export default async function ChiusuraCassaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, full_name')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  // Senza questo la hostess "non manager" cadrebbe nella vista cassiere
  // qui sotto — quella cassa non le compete.
  if (profile.role === 'hostess') redirect('/cassa/prenotazioni')

  if (profile.role === 'manager') {
    // Il manager sceglie fra i locali attivi, o ha il solo locale aperto
    // in archivio. Il cassiere (sotto) vede il proprio anche se nascosto.
    const { data: restaurants } = await soloVisibili(supabase.from('restaurants').select('id, name'), await archivioAperto())
      .order('name')

    return (
      <ChiusuraCassaClient
        role="manager"
        restaurants={restaurants ?? []}
        fixedRestaurantId={null}
        userId={user.id}
        nomeUtente={profile.full_name ?? ''}
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
      nomeUtente={profile.full_name ?? ''}
    />
  )
}
