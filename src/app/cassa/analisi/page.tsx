import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { archivioAperto, soloVisibili } from '@/lib/localiVisibili'
import { AnalisiClient } from '@/components/cassa/AnalisiClient'

export default async function AnalisiCassaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  if (profile?.role === 'hostess') redirect('/cassa/prenotazioni')
  if (profile?.role !== 'manager') redirect('/cassa/chiusura')

  // Solo i locali attivi, oppure il solo locale aperto in archivio: tutte
  // le serie di Analisi (anche confronto e AI) partono da questo elenco.
  const { data: restaurants } = await soloVisibili(supabase.from('restaurants').select('id, name'), await archivioAperto())
    .order('name')

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-[120px] pt-1 lg:px-8">
      <h1 className="titolo-pagina">Analisi</h1>
      <AnalisiClient restaurants={restaurants ?? []} nome={profile?.full_name?.split(' ')[0]} />
    </div>
  )
}
