import { createClient } from '@/lib/supabase/server'
import { ConsultantDashboard } from '@/components/consulente/ConsultantDashboard'

export default async function ConsulenteDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, can_view_hours, consultant_restaurant_ids')
    .eq('id', user!.id)
    .single()

  const restaurantIds: string[] = (profile?.consultant_restaurant_ids as string[] | null) ?? []

  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('id, name')
    .in('id', restaurantIds.length > 0 ? restaurantIds : ['00000000-0000-0000-0000-000000000000'])
    .order('name')

  return (
    <ConsultantDashboard
      userId={user!.id}
      fullName={profile?.full_name ?? ''}
      canViewHours={profile?.can_view_hours ?? false}
      restaurants={restaurants ?? []}
    />
  )
}
