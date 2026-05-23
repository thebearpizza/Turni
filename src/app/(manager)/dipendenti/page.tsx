import { createClient } from '@/lib/supabase/server'
import { DipendentiClient } from '@/components/manager/DipendentiClient'

export default async function DipendentiPage() {
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

  // Manager vede tutti, capo_servizio vede solo il suo ristorante
  let query = supabase
    .from('profiles')
    .select('*, restaurant:restaurants(id, name)')
    .order('full_name')

  if (profile?.role === 'capo_servizio' && profile.restaurant_id) {
    query = query.eq('restaurant_id', profile.restaurant_id)
  }

  const { data: dipendenti } = await query

  return (
    <div className="p-6 lg:p-8">
      <DipendentiClient
        initialDipendenti={dipendenti ?? []}
        restaurants={restaurants ?? []}
        currentUserRole={profile?.role ?? 'capo_servizio'}
      />
    </div>
  )
}
