import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { PresenzeClient, type AbsenceItem } from '@/components/manager/PresenzeClient'
import { FallbackApprovalSection, type PendingItem } from '@/components/manager/FallbackApprovalSection'
import { autoCloseStaleShifts } from '@/lib/autoCloseStaleShifts'
import { formatInTimeZone } from 'date-fns-tz'

const TZ = 'Europe/Rome'

export default async function PresenzePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore')
    .eq('id', user!.id)
    .single()

  // La tab "Presenze" è riservata al manager — capo servizio e direttori
  // hanno la preview presenze nella Dashboard.
  if (profile?.role === 'capo_servizio') redirect('/dashboard')

  // Chiudi i turni lasciati aperti (uscita dimenticata) prima di caricare la
  // lista, così il manager non vede mai una timbratura bloccata da ore/giorni.
  await autoCloseStaleShifts(createAdminClient())

  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('id, name')
    .order('name')

  const nowRome = formatInTimeZone(new Date(), TZ, 'yyyy-MM')
  const [year, month] = nowRome.split('-').map(Number)
  const startDate = new Date(Date.UTC(year, month - 1, 1))
  const endDate   = new Date(Date.UTC(year, month, 0, 23, 59, 59))

  // Date boundaries for absence range (YYYY-MM-DD strings, no timezone shift needed)
  const monthStart = `${nowRome}-01`
  const monthEnd   = `${nowRome}-${String(new Date(Date.UTC(year, month, 0)).getDate()).padStart(2, '0')}`

  let presenzeQuery = supabase
    .from('attendances')
    .select('*, profile:profiles(id, full_name, role), restaurant:restaurants(id, name)')
    .gte('check_in', startDate.toISOString())
    .lte('check_in', endDate.toISOString())
    .order('check_in', { ascending: false })

  // Approved absences that overlap with the current month
  let absencesQuery = supabase
    .from('absences')
    .select('id, user_id, restaurant_id, type, start_date, end_date, profile:profiles!user_id(id, full_name)')
    .eq('status', 'approved')
    .lte('start_date', monthEnd)
    .gte('end_date', monthStart)

  if (profile?.role === 'capo_servizio' && profile.restaurant_id) {
    presenzeQuery  = presenzeQuery.eq('restaurant_id', profile.restaurant_id)
    absencesQuery  = absencesQuery.eq('restaurant_id', profile.restaurant_id)
  }

  const isManager   = profile?.role === 'manager'
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  const canSeeFallback = isManager || isDirettore

  // Fetch pending fallback attendances only for authorised roles
  let pendingFallback: PendingItem[] = []
  if (canSeeFallback) {
    let pendingQuery = supabase
      .from('attendances')
      .select('id, user_id, check_in, check_out, fallback_photo_path, restaurant_id, profile:profiles(full_name), restaurant:restaurants(name)')
      .eq('needs_manager_approval', true)
      .order('check_in', { ascending: false })

    // Direttore is scoped to their own restaurant
    if (isDirettore && profile?.restaurant_id) {
      pendingQuery = pendingQuery.eq('restaurant_id', profile.restaurant_id)
    }

    const { data } = await pendingQuery
    pendingFallback = (data ?? []) as unknown as PendingItem[]
  }

  const [
    { data: presenze, error: presenzeError },
    { data: dipendenti },
    { data: absences },
  ] = await Promise.all([
    presenzeQuery,
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['dipendente', 'capo_servizio'])
      .order('full_name'),
    absencesQuery,
  ])

  if (presenzeError) console.error('[presenze] query error:', presenzeError.message)

  return (
    <div className="p-6 lg:p-8">
      {canSeeFallback && (
        <FallbackApprovalSection initialPending={pendingFallback} />
      )}
      <PresenzeClient
        initialPresenze={presenze ?? []}
        initialAbsences={(absences ?? []) as unknown as AbsenceItem[]}
        restaurants={restaurants ?? []}
        dipendenti={dipendenti ?? []}
        currentUserRole={profile?.role ?? 'capo_servizio'}
        currentRestaurantId={profile?.restaurant_id ?? null}
        isDirectore={profile?.is_direttore ?? false}
      />
    </div>
  )
}
