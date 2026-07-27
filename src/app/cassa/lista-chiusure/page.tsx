import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ListaChiusureClient } from '@/components/cassa/ListaChiusureClient'

export default async function ListaChiusurePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, restaurant_id').eq('id', user.id).single()
  if (!profile) redirect('/login')

  if (profile.role !== 'manager') {
    // Cassiere: stesso trattamento di Chiusura Cassa — nessun selettore,
    // solo il proprio locale (RLS scopa comunque le righe, ma qui evitiamo
    // pure di mostrare un filtro senza alternative da filtrare).
    const { data: restaurant } = profile.restaurant_id
      ? await supabase.from('restaurants').select('id, name').eq('id', profile.restaurant_id).single()
      : { data: null }

    return (
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        <h1 className="cassa-display text-2xl">Lista Chiusure</h1>
        <p className="text-muted-foreground text-sm mt-2 mb-6">Chiusure cassa confermate del tuo locale, per mese.</p>
        <ListaChiusureClient restaurants={restaurant ? [restaurant] : []} role="cassiere" />
      </div>
    )
  }

  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('id, name')
    .order('name')

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="cassa-display text-2xl">Lista Chiusure</h1>
      <p className="text-muted-foreground text-sm mt-2 mb-6">Chiusure cassa confermate, per mese e ristorante.</p>
      <ListaChiusureClient restaurants={restaurants ?? []} role="manager" />
    </div>
  )
}
