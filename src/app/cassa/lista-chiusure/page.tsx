import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ListaChiusureClient } from '@/components/cassa/ListaChiusureClient'
import { CassaManagerClient, type LocaleCassa } from '@/components/cassa/manager/CassaManagerClient'

// Cassa › Chiusure: per il manager la sezione di MTCassa (elenco del mese
// con chiusure mancanti, dettaglio e buste); per il cassiere la Lista
// chiusure del proprio locale (Cassiere e Dipendente 3b).
export default async function ListaChiusurePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, restaurant_id').eq('id', user.id).single()
  if (!profile) redirect('/login')
  if (profile.role === 'hostess') redirect('/cassa/prenotazioni')

  if (profile.role !== 'manager') {
    const { data: restaurant } = profile.restaurant_id
      ? await supabase.from('restaurants').select('id, name').eq('id', profile.restaurant_id).single()
      : { data: null }
    return <ListaChiusureClient restaurant={restaurant ?? null} />
  }

  const { data: restaurants } = await supabase.from('restaurants').select('id, name, closing_days').order('name')
  return <CassaManagerClient sec="chiusure" restaurants={(restaurants ?? []) as LocaleCassa[]} />
}
