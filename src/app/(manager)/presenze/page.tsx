import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { PresenzeClient, type AbsenceItem, type PresenzaRiga, type DipendentePresenze } from '@/components/manager/PresenzeClient'
import { autoCloseStaleShifts } from '@/lib/autoCloseStaleShifts'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { archivioAperto, soloVisibili } from '@/lib/localiVisibili'

const TZ = 'Europe/Rome'

export default async function PresenzePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user!.id)
    .single()

  // La scheda Presenze è del manager: nel design il direttore non ha la
  // sezione (Direttore Tablet v2 / Smartphone), il capo servizio vede le
  // presenze di oggi nella sua Home.
  if (profile?.role !== 'manager') redirect('/dashboard')

  // Chiudi i turni lasciati aperti (uscita dimenticata) prima di caricare la
  // lista, così il manager non vede mai una timbratura bloccata da ore/giorni.
  await autoCloseStaleShifts(createAdminClient())

  // Confini del mese sulla mezzanotte di Roma, non su quella UTC: in ora
  // legale le timbrature della prima/ultima notte finirebbero nel mese sbagliato.
  const mese = formatInTimeZone(new Date(), TZ, 'yyyy-MM')
  const [y, m] = mese.split('-').map(Number)
  const ultimo = `${mese}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`

  // Solo i locali attivi, o quello aperto in archivio: timbrature,
  // dipendenti e assenze seguono quell'elenco, così "Tutti" non somma le
  // presenze dei locali nascosti.
  const { data: restaurants } = await soloVisibili(supabase.from('restaurants').select('id, name').order('name'), await archivioAperto())
  const ids = (restaurants ?? []).map(r => r.id as string)
  const idsLocali = ids.length ? ids : ['00000000-0000-0000-0000-000000000000']

  const [
    { data: presenze, error: presenzeError },
    { data: dipendenti },
    { data: absences },
  ] = await Promise.all([
    supabase
      .from('attendances')
      .select('id, user_id, restaurant_id, check_in, check_out, needs_manager_approval, fallback_photo_path_in, fallback_photo_path_out, profile:profiles(id, full_name, role, department)')
      .in('restaurant_id', idsLocali)
      .gte('check_in', fromZonedTime(`${mese}-01T00:00:00`, TZ).toISOString())
      .lte('check_in', fromZonedTime(`${ultimo}T23:59:59`, TZ).toISOString())
      .order('check_in'),
    supabase
      .from('profiles')
      .select('id, full_name, role, department, restaurant_id')
      .in('role', ['dipendente', 'capo_servizio'])
      .in('restaurant_id', idsLocali)
      .order('full_name'),
    supabase
      .from('absences')
      .select('id, user_id, restaurant_id, type, start_date, end_date, profile:profiles!user_id(id, full_name)')
      .eq('status', 'approved')
      .in('restaurant_id', idsLocali)
      .lte('start_date', ultimo)
      .gte('end_date', `${mese}-01`),
  ])

  if (presenzeError) console.error('[presenze] query error:', presenzeError.message)

  return (
    <PresenzeClient
      initialPresenze={(presenze ?? []) as unknown as PresenzaRiga[]}
      initialAbsences={(absences ?? []) as unknown as AbsenceItem[]}
      initialMonth={mese}
      restaurants={restaurants ?? []}
      dipendenti={(dipendenti ?? []) as DipendentePresenze[]}
    />
  )
}
