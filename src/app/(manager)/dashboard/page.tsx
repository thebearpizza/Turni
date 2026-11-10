import { redirect } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { autoCloseStaleShifts } from '@/lib/autoCloseStaleShifts'
import { CapoServizioTimbraturaSection } from '@/components/manager/CapoServizioTimbraturaSection'
import { PresenzeOggiLista } from '@/components/presenze/PresenzeOggiLista'
import { HomeManager } from '@/components/home/HomeManager'
import { ReportClient } from '@/components/manager/ReportClient'
import { presenzeOggi } from '@/lib/presenzeOggi'
import { PushNotificationPrompt } from '@/components/shared/PushNotificationPrompt'
import { datiHomeManager } from '@/lib/homeManager'

const TZ = 'Europe/Rome'

// Home di capo servizio e direttore.
// - Capo servizio (Capo Servizio.dc.html, 7a): la timbratura identica al
//   dipendente e sotto le presenze di oggi del suo reparto.
// - Direttore (Direttore Smartphone / Tablet v2): la Home del manager su un
//   solo locale (MTHome "single"), con sopra la sua timbratura.
// Il manager ha la Home su /hub: il vecchio "Riepilogo" non esiste più.
export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore, department, full_name, restaurant:restaurants(name, latitude, longitude)')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'manager') redirect('/hub')
  if (!profile || profile.role !== 'capo_servizio' || !profile.restaurant_id) redirect('/login')

  const isDirettore = profile.is_direttore === true
  const restaurantId = profile.restaurant_id as string
  const rest = (Array.isArray(profile.restaurant) ? profile.restaurant[0] : profile.restaurant) as { name: string; latitude: number | null; longitude: number | null } | null

  // Chiudi le timbrature con uscita dimenticata prima di calcolare le
  // presenze, così "in servizio" non resta gonfiato.
  await autoCloseStaleShifts(createAdminClient())

  const todayRome = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const reparto = isDirettore ? null : (profile.department ?? null)

  const [{ data: aperta }, { data: mieiTurni }] = await Promise.all([
    supabase.from('attendances').select('*').eq('user_id', user.id).is('check_out', null).order('check_in', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('turns').select('start_time, end_time, is_rest_day').eq('user_id', user.id).eq('date', todayRome).order('start_time'),
  ])
  const fasce = (mieiTurni ?? []).filter(t => !t.is_rest_day).map(t => `${t.start_time.slice(0, 5)} – ${t.end_time.slice(0, 5)}`)
  const turnoOggi = fasce.length ? `Turno di oggi · ${reparto ? reparto + ' ' : ''}${fasce.join(' / ')}` : 'Nessun turno oggi'

  const timbratura = (
    <CapoServizioTimbraturaSection
      initialOpenAttendance={aperta ?? null}
      restaurantLat={rest?.latitude ?? null}
      restaurantLng={rest?.longitude ?? null}
      variante={isDirettore ? 'compatta' : 'grande'}
      turnoOggi={turnoOggi}
    />
  )

  if (isDirettore) {
    return (
      <HomeManager
        d={await datiHomeManager(supabase, restaurantId)}
        singolo
        nome={profile.full_name ?? ''}
        sopra={<div className="flex flex-none flex-col gap-3"><PushNotificationPrompt />{timbratura}</div>}
        report={
          // Il foglio presenze del mese dentro la Home (MTReport compatto):
          // il componente porta i suoi margini laterali di pagina.
          <div className="-mx-4 h-full sm:-mx-8">
            <ReportClient
              restaurants={[{ id: restaurantId, name: rest?.name ?? '' }]}
              singolo
              puoModificare
              vedeOre
              utenteId={user.id}
              localeIniziale={restaurantId}
            />
          </div>
        }
      />
    )
  }

  const righe = await presenzeOggi(supabase, restaurantId, reparto)
  return (
    <div className="flex min-h-full flex-col sm:h-full">
      <PushNotificationPrompt />
      <div className="flex-none">{timbratura}</div>
      <PresenzeOggiLista
        titolo={`Presenze di oggi${reparto ? ` in ${reparto.toLowerCase()}` : ''}`}
        righe={righe}
        className="mx-4 mb-4 mt-6 min-h-[260px] flex-1"
      />
    </div>
  )
}
