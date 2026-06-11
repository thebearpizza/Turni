import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ApprovazioniClient } from '@/components/manager/ApprovazioniClient'
import { FallbackApprovalSection, type PendingItem } from '@/components/manager/FallbackApprovalSection'

export default async function ApprovazioniPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore')
    .eq('id', user!.id)
    .single()

  // Riservato a manager e direttori
  if (profile?.role === 'capo_servizio' && profile.is_direttore !== true) redirect('/dashboard')

  const isManager   = profile?.role === 'manager'
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  const canSeeFallback = isManager || isDirettore

  let absencesQuery = supabase
    .from('absences')
    .select('*, profile:profiles!user_id(id, full_name), restaurant:restaurants(id, name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (profile?.role === 'capo_servizio' && profile.restaurant_id) {
    absencesQuery = absencesQuery.eq('restaurant_id', profile.restaurant_id)
  }

  // Pending fallback attendances — only for manager / direttore
  let pendingFallback: PendingItem[] = []
  if (canSeeFallback) {
    let pendingQuery = supabase
      .from('attendances')
      .select('id, user_id, check_in, check_out, fallback_photo_path, restaurant_id, profile:profiles(full_name), restaurant:restaurants(name)')
      .eq('needs_manager_approval', true)
      .order('check_in', { ascending: false })

    if (isDirettore && profile?.restaurant_id) {
      pendingQuery = pendingQuery.eq('restaurant_id', profile.restaurant_id)
    }

    const { data } = await pendingQuery
    pendingFallback = (data ?? []) as unknown as PendingItem[]
  }

  const { data: requests, error: requestsError } = await absencesQuery
  if (requestsError) console.error('[approvazioni] query error:', requestsError.message)

  return (
    <div className="p-6 lg:p-8">
      {canSeeFallback && (
        <FallbackApprovalSection initialPending={pendingFallback} />
      )}
      <ApprovazioniClient initialRequests={requests ?? []} />
    </div>
  )
}
