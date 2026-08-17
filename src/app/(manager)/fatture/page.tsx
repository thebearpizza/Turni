import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FattureClient } from '@/components/cassa/FattureClient'

// Stessa vista di /cassa/fatture, ma ospitata dentro la shell dell'app
// Turni (ManagerSidebar, colori di default) invece che in quella di
// Cassa: il direttore la raggiunge dalla barra laterale di Turni e non
// deve "uscire" verso l'app Cassa solo per consultare le fatture.
export default async function FattureTurniPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, is_direttore, restaurant_id').eq('id', user.id).single()
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  if (!isDirettore) redirect('/dashboard')

  // categorie_fatture_dirette e fornitori sono già scoped da RLS sull'owner corretto.
  const { data: categorieDirette } = await supabase.from('categorie_fatture_dirette').select('id, nome').order('nome')
  const { data: fornitori } = await supabase.from('fornitori').select('id, nome').order('nome')

  const { data: restaurant } = profile.restaurant_id
    ? await supabase.from('restaurants').select('id, name').eq('id', profile.restaurant_id).single()
    : { data: null }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold tracking-tight">Fatture</h1>
      <p className="text-muted-foreground text-sm mt-2 mb-6">Fatture caricate del tuo locale, per mese.</p>
      <FattureClient role="direttore" restaurants={restaurant ? [restaurant] : []} categorieDirette={categorieDirette ?? []} fornitori={fornitori ?? []} />
    </div>
  )
}
