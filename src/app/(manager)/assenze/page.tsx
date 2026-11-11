import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AssenzeClient, type AssenzaRiga } from '@/components/manager/AssenzeClient'
import { formatInTimeZone } from 'date-fns-tz'
import { archivioAperto, soloVisibili } from '@/lib/localiVisibili'

const TZ = 'Europe/Rome'
const SELECT_ASSENZE = 'id, user_id, restaurant_id, type, start_date, end_date, certificate_code, notes, status, created_at, profile:profiles!user_id(id, full_name)'

export default async function AssenzePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore')
    .eq('id', user!.id)
    .single()

  // Riservato a manager e direttori
  const isManager = profile?.role === 'manager'
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  if (!isManager && !isDirettore) redirect('/dashboard')

  // Il direttore lavora su un solo locale (design: `single`, niente pillole).
  const locale = isDirettore ? profile?.restaurant_id ?? null : null

  const mese = formatInTimeZone(new Date(), TZ, 'yyyy-MM')
  const [y, m] = mese.split('-').map(Number)
  const ultimo = `${mese}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`

  let qRist = supabase.from('restaurants').select('id, name').order('name')
  // Si possono registrare assenze anche ai capi servizio, non solo ai dipendenti.
  let qDip = supabase.from('profiles').select('id, full_name, restaurant_id').in('role', ['dipendente', 'capo_servizio']).order('full_name')
  let qApp = supabase.from('absences').select(SELECT_ASSENZE).eq('status', 'approved').lte('start_date', ultimo).gte('end_date', `${mese}-01`)
  let qPen = supabase.from('absences').select(SELECT_ASSENZE).eq('status', 'pending').order('created_at', { ascending: false })
  // Direttore: il proprio locale, anche se nascosto. Manager: solo i locali
  // attivi, o quello aperto in archivio.
  if (locale) qRist = qRist.eq('id', locale)
  else if (isManager) qRist = soloVisibili(qRist, await archivioAperto())
  const { data: restaurants } = await qRist
  // Dipendenti e assenze seguono quell'elenco: senza, "Tutti" porterebbe
  // dentro anche le persone e le assenze dei locali nascosti.
  const ids = (restaurants ?? []).map(r => r.id as string)
  const idsLocali = ids.length ? ids : ['00000000-0000-0000-0000-000000000000']
  qDip = qDip.in('restaurant_id', idsLocali)
  qApp = qApp.in('restaurant_id', idsLocali)
  qPen = qPen.in('restaurant_id', idsLocali)

  const [{ data: dipendenti }, { data: approvate, error: e1 }, { data: richieste, error: e2 }] = await Promise.all([qDip, qApp, qPen])
  if (e1 || e2) console.error('[assenze] query error:', (e1 ?? e2)?.message)

  return (
    <AssenzeClient
      initialApproved={(approvate ?? []) as unknown as AssenzaRiga[]}
      initialPending={(richieste ?? []) as unknown as AssenzaRiga[]}
      initialMonth={mese}
      restaurants={restaurants ?? []}
      dipendenti={dipendenti ?? []}
      single={isDirettore}
      restaurantId={locale}
    />
  )
}
