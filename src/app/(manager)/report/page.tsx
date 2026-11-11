import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ReportClient } from '@/components/manager/ReportClient'
import { archivioAperto, soloVisibili } from '@/lib/localiVisibili'

export default async function ReportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore, managed_restaurant_ids')
    .eq('id', user!.id)
    .single()

  const isManager = profile?.role === 'manager'
  const isDirettore = profile?.role === 'capo_servizio' && !!profile?.is_direttore
  // Il capo servizio non ha il Report (decisione di prodotto): era tolto
  // dal menu ma restava raggiungibile dall'indirizzo.
  if (profile?.role === 'capo_servizio' && !isDirettore) redirect('/dashboard')

  // Il manager vede i locali che gestisce (tutti se proprietario della
  // piattaforma); direttore e capo servizio solo il proprio locale, senza
  // pillole (come nel design: MTReport "single").
  let query = supabase.from('restaurants').select('id, name').order('name')
  if (!isManager) query = query.eq('id', profile?.restaurant_id ?? '00000000-0000-0000-0000-000000000000')
  else {
    if (profile?.managed_restaurant_ids) query = query.in('id', profile.managed_restaurant_ids as string[])
    // Solo i locali attivi, o quello aperto in archivio: il Report legge
    // persone, presenze e assenze dall'elenco che riceve.
    query = soloVisibili(query, await archivioAperto())
  }
  const { data: restaurants } = await query

  return (
    <ReportClient
      restaurants={restaurants ?? []}
      singolo={!isManager}
      // Il capo servizio non direttore consulta solo le presenze, senza modificare.
      puoModificare={isManager || isDirettore}
      vedeOre={isManager || isDirettore}
      utenteId={user!.id}
      localeIniziale={profile?.restaurant_id ?? null}
    />
  )
}
