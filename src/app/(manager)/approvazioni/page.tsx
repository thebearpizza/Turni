import { createClient } from '@/lib/supabase/server'
import { ApprovazioniClient } from '@/components/manager/ApprovazioniClient'

export default async function ApprovazioniPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id')
    .eq('id', user!.id)
    .single()

  let query = supabase
    .from('absences')
    .select('*, profile:profiles(id, full_name), restaurant:restaurants(id, name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (profile?.role === 'capo_servizio' && profile.restaurant_id) {
    query = query.eq('restaurant_id', profile.restaurant_id)
  }

  const { data: requests } = await query

  return (
    <div className="p-6 lg:p-8">
      <ApprovazioniClient initialRequests={requests ?? []} />
    </div>
  )
}
