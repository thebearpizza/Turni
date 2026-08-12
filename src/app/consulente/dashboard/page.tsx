import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
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

  // Manager di riferimento per il primo messaggio: senza, un consulente la
  // cui casella è ancora vuota non avrebbe alcun destinatario per scrivere.
  // managed_restaurant_ids null = proprietario della piattaforma (gestisce
  // implicitamente ogni ristorante, quindi è sempre un candidato valido).
  // Client admin: la RLS di profiles limita ciò che un consulente può
  // leggere ai soli profili dei ristoranti a cui è assegnato, ma i manager
  // hanno tipicamente restaurant_id nullo (sono scope-ati via
  // managed_restaurant_ids) e non sarebbero mai visibili con quella regola.
  let initialManagerId: string | null = null
  if (restaurantIds.length > 0) {
    const admin = createAdminClient()
    const { data: managers } = await admin
      .from('profiles')
      .select('id, managed_restaurant_ids')
      .eq('role', 'manager')
    const match = (managers ?? []).find(m => {
      const managed = m.managed_restaurant_ids as string[] | null
      return managed === null || managed.some(id => restaurantIds.includes(id))
    })
    initialManagerId = match?.id ?? null
  }

  return (
    <ConsultantDashboard
      userId={user!.id}
      fullName={profile?.full_name ?? ''}
      canViewHours={profile?.can_view_hours ?? false}
      restaurants={restaurants ?? []}
      initialManagerId={initialManagerId}
    />
  )
}
