import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RestaurantsClient } from '@/components/manager/RestaurantsClient'

export default async function RistorantiPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user!.id)
    .single()

  if (profile?.role !== 'manager') redirect('/dashboard')

  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('*')
    .order('name')

  return (
    <div className="px-4 pt-1 pb-4 lg:px-8">
      <RestaurantsClient initialRestaurants={restaurants ?? []} />
    </div>
  )
}
