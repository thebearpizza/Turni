import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { autoCloseStaleShifts } from '@/lib/autoCloseStaleShifts'
import { Users, Clock, CalendarX, CheckCircle, MessageSquare } from 'lucide-react'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import Link from 'next/link'
import { CapoServizioTimbraturaSection } from '@/components/manager/CapoServizioTimbraturaSection'
import { ConsulenteLavoroManager } from '@/components/manager/ConsulenteLavoroManager'
import { FallbackApprovalSection, type PendingItem } from '@/components/manager/FallbackApprovalSection'
import { PresenzePreviewClient, type PresenzaPreviewRow } from '@/components/manager/PresenzePreviewClient'
import { RestaurantQrCard } from '@/components/manager/RestaurantQrCard'
import { TelegramLinkButton } from '@/components/manager/TelegramLinkButton'

const TZ = 'Europe/Rome'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore, restaurant:restaurants(name, latitude, longitude, qr_secret)')
    .eq('id', user!.id)
    .single()

  const isManager   = profile?.role === 'manager'
  const isDirettore = profile?.role === 'capo_servizio' && (profile as { is_direttore?: boolean }).is_direttore === true
  const canSeeFallback = isManager || isDirettore

  // Chiudi le timbrature con uscita dimenticata prima di calcolare i KPI,
  // così "presenti oggi" e l'anteprima presenze non restano gonfiati.
  await autoCloseStaleShifts(createAdminClient())

  const todayRome = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const todayStart = fromZonedTime(`${todayRome}T00:00:00`, TZ).toISOString()

  const isCapoServizio = profile?.role === 'capo_servizio'
  const restaurantFilter = isCapoServizio && profile?.restaurant_id
    ? profile.restaurant_id : null

  const baseProfiles = supabase.from('profiles').select('id', { count: 'exact' }).in('role', ['dipendente', 'capo_servizio'])
  const basePresenti = supabase.from('attendances').select('id', { count: 'exact' }).is('check_out', null).gte('check_in', todayStart)
  const baseAssenze  = supabase.from('absences').select('id', { count: 'exact' }).eq('status', 'approved').lte('start_date', todayRome).gte('end_date', todayRome)
  const basePending  = supabase.from('absences').select('id', { count: 'exact' }).eq('status', 'pending')
  let baseBulletins  = supabase.from('bulletins').select('id', { count: 'exact', head: true })
  if (restaurantFilter) {
    baseBulletins = baseBulletins.or(`restaurant_id.eq.${restaurantFilter},restaurant_id.is.null`)
  }

  // Fetch own open attendance for capo_servizio timbratura section
  const [
    { count: totalDipendenti },
    { count: presenti },
    { count: assenzeOggi },
    { count: richiestePending },
    { count: bachecaCount },
    openAttendanceResult,
  ] = await Promise.all([
    restaurantFilter ? baseProfiles.eq('restaurant_id', restaurantFilter) : baseProfiles,
    restaurantFilter ? basePresenti.eq('restaurant_id', restaurantFilter) : basePresenti,
    restaurantFilter ? baseAssenze.eq('restaurant_id', restaurantFilter)  : baseAssenze,
    restaurantFilter ? basePending.eq('restaurant_id', restaurantFilter)  : basePending,
    baseBulletins,
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

  // Capo Servizio / Direttore: la 4ª card mostra i Messaggi in Bacheca al posto
  // delle Richieste in Attesa (riservate ad Assenze/Approvazioni del manager)
  const stats = isCapoServizio
    ? [
        { label: 'Dipendenti Totali',   value: totalDipendenti ?? 0, icon: Users,          color: 'text-blue-600',    href: '/dipendenti' },
        { label: 'Presenti Oggi',       value: presenti        ?? 0, icon: CheckCircle,    color: 'text-emerald-600', href: '/dashboard'  },
        { label: 'Assenti Oggi',        value: assenzeOggi     ?? 0, icon: CalendarX,      color: 'text-red-600',     href: '/dashboard'  },
        { label: 'Messaggi in Bacheca', value: bachecaCount    ?? 0, icon: MessageSquare,  color: 'text-violet-600',  href: '/bacheca'    },
      ]
    : [
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

      {/* Timbrature di emergenza — manager e direttori */}
      {canSeeFallback && (
        <FallbackPendingSection
          isManager={isManager}
          restaurantId={isDirettore ? (profile?.restaurant_id ?? null) : null}
        />
      )}

      {/* QR Code timbratura — capo servizio e direttori */}
      {isCapoServizio && profile?.restaurant && (
        <RestaurantQrCard
          restaurantName={(profile.restaurant as unknown as { name: string }).name}
          qrSecret={(profile.restaurant as unknown as { qr_secret: string }).qr_secret}
        />
      )}

      {/* Preview presenze di oggi — capo servizio e direttori. Niente ore
          lavorate; cliccabile solo per il direttore (aggiunge/modifica). */}
      {isCapoServizio && restaurantFilter && (
        <PresenzePreviewSection restaurantId={restaurantFilter} isDirettore={isDirettore} />
      )}

      {/* Consulenti del Lavoro — solo manager */}
      {isManager && (
        <ConsulenteLavoroManagerSection managerId={user!.id} />
      )}

      {/* Bot Telegram — manager e capi servizio/direttori. Mai per
          dipendenti o consulenti (questa pagina non è accessibile a loro). */}
      <TelegramLinkButton />
    </div>
  )
}

async function PresenzePreviewSection({
  restaurantId,
  isDirettore,
}: {
  restaurantId: string
  isDirettore: boolean
}) {
  const supabase = await createClient()
  const todayRome = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const todayStart = fromZonedTime(`${todayRome}T00:00:00`, TZ).toISOString()

  const [{ data: presenze }, { data: dipendenti }] = await Promise.all([
    supabase
      .from('attendances')
      .select('id, user_id, check_in, check_out, profile:profiles(id, full_name)')
      .eq('restaurant_id', restaurantId)
      .gte('check_in', todayStart)
      .order('check_in', { ascending: false }),
    isDirettore
      ? supabase
          .from('profiles')
          .select('id, full_name')
          .eq('restaurant_id', restaurantId)
          .in('role', ['dipendente', 'capo_servizio'])
          .order('full_name')
      : Promise.resolve({ data: [] }),
  ])

  return (
    <PresenzePreviewClient
      initialRows={(presenze as unknown as PresenzaPreviewRow[]) ?? []}
      dipendenti={dipendenti ?? []}
      isDirettore={isDirettore}
    />
  )
}

async function FallbackPendingSection({
  isManager,
  restaurantId,
}: {
  isManager: boolean
  restaurantId: string | null
}) {
  const supabase = await createClient()
  let query = supabase
    .from('attendances')
    .select('id, user_id, check_in, check_out, fallback_photo_path, restaurant_id, profile:profiles(full_name), restaurant:restaurants(name)')
    .eq('needs_manager_approval', true)
    .order('check_in', { ascending: false })

  if (!isManager && restaurantId) {
    query = query.eq('restaurant_id', restaurantId)
  }

  const { data } = await query
  if (!data?.length) return null

  return (
    <div className="mt-6">
      <FallbackApprovalSection initialPending={data as unknown as PendingItem[]} />
    </div>
  )
}

async function ConsulenteLavoroManagerSection({ managerId }: { managerId: string }) {
  const supabase = await createClient()
  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('id, name')
    .order('name')

  return (
    <ConsulenteLavoroManager
      managerId={managerId}
      restaurants={restaurants ?? []}
    />
  )
}
