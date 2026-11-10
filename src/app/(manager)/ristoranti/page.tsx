import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RestaurantsClient } from '@/components/manager/RestaurantsClient'
import type { Restaurant, ShiftSlot } from '@/types'

export default async function RistorantiPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user!.id)
    .single()

  if (profile?.role !== 'manager') redirect('/dashboard')

  const [{ data: restaurants }, { data: fasce }] = await Promise.all([
    supabase.from('restaurants').select('*').order('name'),
    supabase.from('shift_slots').select('*').order('department').order('start_time'),
  ])

  return <RestaurantsClient initialRestaurants={(restaurants ?? []) as Restaurant[]} initialFasce={(fasce ?? []) as ShiftSlot[]} />
}
