import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, Clock, CalendarX, CheckCircle } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'

const TZ = 'Europe/Rome'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id')
    .eq('id', user!.id)
    .single()

  const todayRome = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const todayStart = `${todayRome}T00:00:00`

  // Filtro per ristorante se capo_servizio
  const restaurantFilter = profile?.role === 'capo_servizio' && profile.restaurant_id
    ? profile.restaurant_id
    : null

  let profilesQuery = supabase.from('profiles').select('id', { count: 'exact' }).eq('role', 'dipendente')
  if (restaurantFilter) profilesQuery = profilesQuery.eq('restaurant_id', restaurantFilter)
  const { count: totalDipendenti } = await profilesQuery

  let presentiQuery = supabase.from('attendances')
    .select('id', { count: 'exact' })
    .is('check_out', null)
    .gte('check_in', new Date(todayStart).toISOString())
  if (restaurantFilter) presentiQuery = presentiQuery.eq('restaurant_id', restaurantFilter)
  const { count: presenti } = await presentiQuery

  let assenzeQuery = supabase.from('absences')
    .select('id', { count: 'exact' })
    .eq('status', 'approved')
    .lte('start_date', todayRome)
    .gte('end_date', todayRome)
  if (restaurantFilter) assenzeQuery = assenzeQuery.eq('restaurant_id', restaurantFilter)
  const { count: assenzeOggi } = await assenzeQuery

  let pendingQuery = supabase.from('absences')
    .select('id', { count: 'exact' })
    .eq('status', 'pending')
  if (restaurantFilter) pendingQuery = pendingQuery.eq('restaurant_id', restaurantFilter)
  const { count: richiestePending } = await pendingQuery

  const stats = [
    { label: 'Dipendenti Totali', value: totalDipendenti ?? 0, icon: Users, color: 'text-blue-500' },
    { label: 'Presenti Oggi', value: presenti ?? 0, icon: CheckCircle, color: 'text-emerald-500' },
    { label: 'Assenti Oggi', value: assenzeOggi ?? 0, icon: CalendarX, color: 'text-red-500' },
    { label: 'Richieste in Attesa', value: richiestePending ?? 0, icon: Clock, color: 'text-amber-500' },
  ]

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          {formatInTimeZone(new Date(), TZ, "EEEE d MMMM yyyy")}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span className="text-3xl font-bold">{value}</span>
                <Icon className={`w-8 h-8 ${color} opacity-80`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
