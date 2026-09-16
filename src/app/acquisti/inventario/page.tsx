import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InventarioClient } from '@/components/acquisti/InventarioClient'

// L'accesso a /acquisti/* (manager, direttore) è già gestito da
// acquisti/layout.tsx — qui serve solo il ruolo per scopare i dati
// (locale singolo per il direttore, selezione tra quelli gestiti per
// il manager), stesso pattern di fatture/page.tsx.
export default async function InventarioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, restaurant_id').eq('id', user.id).single()
  if (!profile) redirect('/login')

  if (profile.role === 'manager') {
    const { data: restaurants } = await supabase.from('restaurants').select('id, name').order('name')
    return (
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        <h1 className="cassa-display text-2xl">Inventario</h1>
        <p className="text-muted-foreground text-sm mt-2 mb-6">Giacenze di magazzino, per ristorante.</p>
        <InventarioClient role="manager" restaurants={restaurants ?? []} />
      </div>
    )
  }

  const { data: restaurant } = profile.restaurant_id
    ? await supabase.from('restaurants').select('id, name').eq('id', profile.restaurant_id).single()
    : { data: null }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="cassa-display text-2xl">Inventario</h1>
      <p className="text-muted-foreground text-sm mt-2 mb-6">Giacenze di magazzino del tuo locale.</p>
      <InventarioClient role="direttore" restaurants={restaurant ? [restaurant] : []} />
    </div>
  )
}
