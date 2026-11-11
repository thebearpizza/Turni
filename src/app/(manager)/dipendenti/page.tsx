import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DipendentiClient, type DipendenteRiga } from '@/components/manager/DipendentiClient'
import type { ShiftSlot } from '@/types'
import { archivioAperto, soloVisibili } from '@/lib/localiVisibili'

export default async function DipendentiPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore')
    .eq('id', user!.id)
    .single()

  const isManager = profile?.role === 'manager'
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  // Riservato a manager e direttori: il capo servizio non gestisce dipendenti.
  if (!isManager && !isDirettore) redirect('/dashboard')
  const locale = isDirettore ? profile?.restaurant_id ?? null : null

  let qRist = supabase.from('restaurants').select('id, name').order('name')
  // I consulenti del lavoro hanno la loro sezione: qui solo lo staff dei locali.
  let qDip = supabase.from('profiles').select('*, restaurant:restaurants(id, name)').neq('role', 'consulente_lavoro').order('full_name')
  let qFasce = supabase.from('shift_slots').select('*').order('department').order('start_time')
  // Manager: i locali attivi, o quello aperto in archivio. Il direttore
  // resta sul proprio locale, anche se nascosto.
  const archivio = isManager ? await archivioAperto() : null
  if (locale) qRist = qRist.eq('id', locale)
  else if (isManager) qRist = soloVisibili(qRist, archivio)
  const { data: restaurants } = await qRist

  if (locale) { qDip = qDip.eq('restaurant_id', locale); qFasce = qFasce.eq('restaurant_id', locale) }
  else if (isManager) {
    // Persone e fasce seguono l'elenco dei locali: lo staff dei locali
    // nascosti non compare con "Tutti". Chi non ha un locale (es. gli altri
    // manager) resta visibile fra gli attivi, come prima; in archivio no.
    const ids = (restaurants ?? []).map(r => r.id as string)
    qFasce = qFasce.in('restaurant_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    if (archivio) qDip = qDip.eq('restaurant_id', archivio)
    else qDip = ids.length ? qDip.or(`restaurant_id.is.null,restaurant_id.in.(${ids.join(',')})`) : qDip.is('restaurant_id', null)
  }

  const [{ data: dipendenti }, { data: fasce }] = await Promise.all([qDip, qFasce])

  return (
    <DipendentiClient
      initialDipendenti={(dipendenti ?? []) as DipendenteRiga[]}
      restaurants={restaurants ?? []}
      fasce={(fasce ?? []) as ShiftSlot[]}
      single={isDirettore}
      currentUserId={user!.id}
      currentRestaurantId={locale}
    />
  )
}
