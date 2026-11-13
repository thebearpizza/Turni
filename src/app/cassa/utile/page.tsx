import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { archivioAperto, soloVisibili } from '@/lib/localiVisibili'
import { UtileClient } from '@/components/cassa/UtileClient'

export default async function UtilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role === 'hostess') redirect('/cassa/prenotazioni')
  if (profile?.role !== 'manager') redirect('/cassa/chiusura')

  // Come Analisi: solo i locali attivi, o il locale aperto in archivio.
  const { data: restaurants } = await soloVisibili(supabase.from('restaurants').select('id, name'), await archivioAperto())
    .order('name')

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-[120px] pt-1 lg:px-8">
      <h1 className="titolo-pagina">Utile</h1>
      <UtileClient restaurants={restaurants ?? []} />
    </div>
  )
}
