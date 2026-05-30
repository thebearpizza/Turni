import { createClient } from '@/lib/supabase/server'
import { Users, Clock, CalendarX, CheckCircle } from 'lucide-react'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import Link from 'next/link'
import { CapoServizioTimbraturaSection } from '@/components/manager/CapoServizioTimbraturaSection'

const TZ = 'Europe/Rome'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, restaurant:restaurants(latitude, longitude)')
    .eq('id', user!.id)
    .single()

  const todayRome = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const todayStart = fromZonedTime(`${todayRome}T00:00:00`, TZ).toISOString()

  const isCapoServizio = profile?.role === 'capo_servizio'
  const restaurantFilter = isCapoServizio && profile?.restaurant_id
    ? profile.restaurant_id : null

  const baseProfiles = supabase.from('profiles').select('id', { count: 'exact' }).in('role', ['dipendente', 'capo_servizio'])
  const basePresenti = supabase.from('attendances').select('id', { count: 'exact' }).is('check_out', null).gte('check_in', todayStart)
  const baseAssenze  = supabase.from('absences').select('id', { count: 'exact' }).eq('status', 'approved').lte('start_date', todayRome).gte('end_date', todayRome)
  const basePending  = supabase.from('absences').select('id', { count: 'exact' }).eq('status', 'pending')

  // Fetch own open attendance for capo_servizio timbratura section
  const [
    { count: totalDipendenti },
    { count: presenti },
    { count: assenzeOggi },
    { count: richiestePending },
    openAttendanceResult,
  ] = await Promise.all([
    restaurantFilter ? baseProfiles.eq('restaurant_id', restaurantFilter) : baseProfiles,
    restaurantFilter ? basePresenti.eq('restaurant_id', restaurantFilter) : basePresenti,
    restaurantFilter ? baseAssenze.eq('restaurant_id', restaurantFilter)  : baseAssenze,
    restaurantFilter ? basePending.eq('restaurant_id', restaurantFilter)  : basePending,
    isCapoServizio
      ? supabase
          .from('attendances')
          .select('*')
          .eq('user_id', user!.id)
          .is('check_out', null)
          .order('check_in', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const stats = [
    { label: 'Dipendenti Totali',   value: totalDipendenti  ?? 0, icon: Users,       color: 'text-blue-600',    href: '/dipendenti' },
    { label: 'Presenti Oggi',       value: presenti         ?? 0, icon: CheckCircle, color: 'text-emerald-600', href: '/presenze'   },
    { label: 'Assenti Oggi',        value: assenzeOggi      ?? 0, icon: CalendarX,   color: 'text-red-600',     href: '/assenze'    },
    { label: 'Richieste in Attesa', value: richiestePending ?? 0, icon: Clock,       color: 'text-amber-600',   href: '/assenze'    },
  ]

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-0.5 capitalize">
          {formatInTimeZone(new Date(), TZ, "EEEE d MMMM yyyy", { locale: it })}
        </p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map(({ label, value, icon: Icon, color, href }) => (
          <Link
            key={label}
            href={href}
            className="bg-card border border-border rounded-md p-4 block
              transition-all duration-200 cursor-pointer
              hover:shadow-md hover:-translate-y-0.5
              hover:bg-zinc-50 dark:hover:bg-zinc-800/50
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <div className="flex items-end justify-between mt-2">
              <span className="text-3xl font-bold tracking-tight">{value}</span>
              <Icon className={`w-6 h-6 ${color} opacity-70`} />
            </div>
          </Link>
        ))}
      </div>

      {/* Timbratura — solo capo_servizio */}
      {isCapoServizio && (
        <CapoServizioTimbraturaSection
          initialOpenAttendance={openAttendanceResult.data ?? null}
          restaurantLat={(profile?.restaurant as { latitude?: number | null } | null)?.latitude ?? null}
          restaurantLng={(profile?.restaurant as { longitude?: number | null } | null)?.longitude ?? null}
        />
      )}
    </div>
  )
}
