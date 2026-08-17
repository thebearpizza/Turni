import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FattureClient } from '@/components/cassa/FattureClient'

export default async function FatturePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, is_direttore, restaurant_id').eq('id', user.id).single()
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  if (profile?.role === 'hostess') redirect('/cassa/prenotazioni')
  if (!profile || !(profile.role === 'manager' || isDirettore)) redirect('/cassa/chiusura')

  // categorie_fatture_dirette e fornitori sono già scoped da RLS
  // sull'owner corretto per entrambi i ruoli, nessun filtro esplicito
  // necessario qui.
  const { data: categorieDirette } = await supabase.from('categorie_fatture_dirette').select('id, nome').order('nome')
  const { data: fornitori } = await supabase.from('fornitori').select('id, nome').order('nome')

  if (profile.role === 'manager') {
    const { data: restaurants } = await supabase.from('restaurants').select('id, name').order('name')
    return (
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        <h1 className="cassa-display text-2xl">Fatture</h1>
        <p className="text-muted-foreground text-sm mt-2 mb-6">Fatture caricate, per mese e ristorante.</p>
        <FattureClient role="manager" restaurants={restaurants ?? []} categorieDirette={categorieDirette ?? []} fornitori={fornitori ?? []} />
      </div>
    )
  }

  const { data: restaurant } = profile.restaurant_id
    ? await supabase.from('restaurants').select('id, name').eq('id', profile.restaurant_id).single()
    : { data: null }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="cassa-display text-2xl">Fatture</h1>
      <p className="text-muted-foreground text-sm mt-2 mb-6">Fatture caricate del tuo locale, per mese.</p>
      <FattureClient role="direttore" restaurants={restaurant ? [restaurant] : []} categorieDirette={categorieDirette ?? []} fornitori={fornitori ?? []} />
    </div>
  )
}
