import { createClient } from '@/lib/supabase/server'
import { TurniManagerClient } from '@/components/manager/TurniManagerClient'
import { scopeTurnsQuery, scopeStaffQuery, type ScopeProfile } from '@/lib/turniScope'

export default async function TurniPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, department, restaurant_id, is_direttore')
    .eq('id', user!.id)
    .single()

  const scopeProfile: ScopeProfile = {
    role:          profile?.role ?? 'dipendente',
    restaurant_id: profile?.restaurant_id ?? null,
    department:    profile?.department ?? null,
    is_direttore:  profile?.is_direttore ?? false,
  }

  // ── Query Scoping (RBAC) — vedi src/lib/turniScope.ts ──────────────
  let turnsQuery = supabase
    .from('turns')
    .select('*, profile:profiles!user_id(id, full_name), restaurant:restaurants(id, name)')
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })
  turnsQuery = scopeTurnsQuery(turnsQuery, scopeProfile, user!.id)

  // Dipendenti assegnabili al turno — stesso scoping dei turni stessi
  let staffQuery = supabase
    .from('profiles')
    .select('id, full_name, department, restaurant_id')
    .in('role', ['dipendente', 'capo_servizio'])
    .order('full_name')
  staffQuery = scopeStaffQuery(staffQuery, scopeProfile)

  // Turni standard (Pattern Master) — stesso scoping dei turni reali
  let standardQuery = supabase
    .from('standard_shifts')
    .select('*, profile:profiles!user_id(id, full_name)')
    .order('day_of_week')
  standardQuery = scopeTurnsQuery(standardQuery, scopeProfile, user!.id)

  const [{ data: turns }, { data: staff }, { data: restaurants }, { data: standardShifts }] = await Promise.all([
    turnsQuery,
    staffQuery,
    profile?.role === 'manager'
      ? supabase.from('restaurants').select('id, name').order('name')
      : Promise.resolve({ data: [] }),
    standardQuery,
  ])

  return (
    <div className="p-6 lg:p-8">
      <TurniManagerClient
        initialTurns={(turns as unknown as import('@/types').Turn[]) ?? []}
        initialStandardShifts={(standardShifts as unknown as import('@/types').StandardShift[]) ?? []}
        staff={staff ?? []}
        restaurants={restaurants ?? []}
        currentUserId={user!.id}
        currentUserRole={profile?.role ?? 'capo_servizio'}
        currentDepartment={profile?.department ?? null}
        currentRestaurantId={profile?.restaurant_id ?? null}
        currentIsDirettore={profile?.is_direttore ?? false}
      />
    </div>
  )
}
