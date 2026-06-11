import { createClient } from '@/lib/supabase/server'
import { BachecaClient } from '@/components/manager/BachecaClient'

export default async function BachecaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, can_post_bulletin, is_direttore')
    .eq('id', user!.id)
    .single()

  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true

  let dipendentiQuery = supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['capo_servizio', 'dipendente'])
    .order('full_name')

  if (isDirettore && profile?.restaurant_id) {
    dipendentiQuery = dipendentiQuery.eq('restaurant_id', profile.restaurant_id)
  }

  const [{ data: restaurants }, { data: bulletins }, { data: dipendenti }] =
    await Promise.all([
      supabase.from('restaurants').select('id, name').order('name'),
      supabase.from('bulletins')
        .select('*, restaurant:restaurants(id, name), author:profiles!created_by(id, full_name)')
        .order('created_at', { ascending: false })
        .limit(50),
      dipendentiQuery,
    ])

  const canPost = profile?.role === 'manager' ||
    (profile?.role === 'capo_servizio' && profile.can_post_bulletin)

  return (
    <div className="p-6 lg:p-8">
      <BachecaClient
        initialBulletins={bulletins ?? []}
        restaurants={restaurants ?? []}
        dipendenti={dipendenti ?? []}
        currentUserId={user!.id}
        currentUserRole={profile?.role ?? 'capo_servizio'}
        currentRestaurantId={profile?.restaurant_id ?? null}
        canPost={canPost ?? false}
        isDirettore={isDirettore}
      />
    </div>
  )
}
