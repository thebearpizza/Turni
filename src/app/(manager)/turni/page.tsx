import { createClient } from '@/lib/supabase/server'
import { TurniManagerClient } from '@/components/manager/TurniManagerClient'
import { scopeTurnsQuery, scopeStaffQuery, type ScopeProfile } from '@/lib/turniScope'
import { startOfWeek, addDays, format } from 'date-fns'

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

  // Il caricamento iniziale copre solo la settimana corrente ±1: senza
  // limite di date, la query scarica ogni turno mai creato nello scope del
  // ruolo — con locali attivi da mesi si superano le 1000 righe di default
  // di Supabase, e a sparire sono proprio le settimane future che si stanno
  // pianificando (l'ordinamento crescente le mette in fondo, dove il limite
  // taglia). Le settimane oltre questo intervallo vengono richieste al volo
  // dal client quando si naviga (vedi TurniManagerClient).
  const todayWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const initialRangeStart = format(addDays(todayWeekStart, -7), 'yyyy-MM-dd')
  const initialRangeEnd = format(addDays(todayWeekStart, 13), 'yyyy-MM-dd')

  // ── Query Scoping (RBAC) — vedi src/lib/turniScope.ts ──────────────
  let turnsQuery = supabase
    .from('turns')
    .select('*, profile:profiles!user_id(id, full_name), restaurant:restaurants(id, name)')
    .gte('date', initialRangeStart)
    .lte('date', initialRangeEnd)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })
  turnsQuery = scopeTurnsQuery(turnsQuery, scopeProfile, user!.id)

  // Dipendenti assegnabili al turno — stesso scoping dei turni stessi
  let staffQuery = supabase
    .from('profiles')
    .select('id, full_name, department, restaurant_id, role, weekly_hours_target')
    .in('role', ['dipendente', 'capo_servizio'])
    .order('full_name')
  staffQuery = scopeStaffQuery(staffQuery, scopeProfile)

  // Turni standard (Pattern Master) — stesso scoping dei turni reali
  let standardQuery = supabase
    .from('standard_shifts')
    .select('*, profile:profiles!user_id(id, full_name)')
    .order('day_of_week')
  standardQuery = scopeTurnsQuery(standardQuery, scopeProfile, user!.id)

  // Malattie e ferie approvate del periodo: in rosso nella timeline del capo
  // servizio e nella griglia settimanale (Direttore v2). Il manager le legge
  // su tutti i suoi locali (RLS), gli altri sul proprio.
  const absencesQuery = profile?.role === 'manager'
    ? supabase
        .from('absences')
        .select('user_id, type, start_date, end_date')
        .eq('status', 'approved')
        .lte('start_date', initialRangeEnd)
        .gte('end_date', initialRangeStart)
    : profile?.restaurant_id
    ? supabase
        .from('absences')
        .select('user_id, type, start_date, end_date')
        .eq('status', 'approved')
        .eq('restaurant_id', profile.restaurant_id)
        .lte('start_date', initialRangeEnd)
        .gte('end_date', initialRangeStart)
    : Promise.resolve({ data: [] })

  const [{ data: turns }, { data: staff }, { data: restaurants }, { data: standardShifts }, { data: absences }] = await Promise.all([
    turnsQuery,
    staffQuery,
    profile?.role === 'manager'
      ? supabase.from('restaurants').select('id, name').order('name')
      : Promise.resolve({ data: [] }),
    standardQuery,
    absencesQuery,
  ])

  return (
    <TurniManagerClient
        initialTurns={(turns as unknown as import('@/types').Turn[]) ?? []}
        initialStandardShifts={(standardShifts as unknown as import('@/types').StandardShift[]) ?? []}
        initialAbsences={(absences as { user_id: string; type: string; start_date: string; end_date: string }[] | null) ?? []}
        staff={staff ?? []}
        restaurants={restaurants ?? []}
        currentUserId={user!.id}
        currentUserRole={profile?.role ?? 'capo_servizio'}
        currentDepartment={profile?.department ?? null}
        currentRestaurantId={profile?.restaurant_id ?? null}
        currentIsDirettore={profile?.is_direttore ?? false}
      />
  )
}
