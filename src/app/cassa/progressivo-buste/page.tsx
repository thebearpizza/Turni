import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ProgressivoBusteClient } from '@/components/cassa/ProgressivoBusteClient'

export default async function ProgressivoBustePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, is_direttore').eq('id', user.id).single()
  if (profile?.role === 'capo_servizio' && profile.is_direttore) redirect('/cassa/fatture')
  if (profile?.role === 'hostess') redirect('/cassa/prenotazioni')
  if (profile?.role !== 'manager') redirect('/cassa/chiusura')

  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('id, name')
    .order('name')

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="cassa-display text-2xl">Progressivo Buste</h1>
      <p className="text-muted-foreground text-sm mt-2 mb-6">Contanti per banca, per locale e periodo.</p>
      <ProgressivoBusteClient restaurants={restaurants ?? []} />
    </div>
  )
}
