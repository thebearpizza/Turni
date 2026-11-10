import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DipendentiClient, type DipendenteRiga } from '@/components/manager/DipendentiClient'
import type { ShiftSlot } from '@/types'

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
  if (locale) { qRist = qRist.eq('id', locale); qDip = qDip.eq('restaurant_id', locale); qFasce = qFasce.eq('restaurant_id', locale) }

  const [{ data: restaurants }, { data: dipendenti }, { data: fasce }] = await Promise.all([qRist, qDip, qFasce])

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
