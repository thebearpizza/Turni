import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ArticoliClient } from '@/components/cassa/ArticoliClient'

export default async function ArticoliPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, is_direttore').eq('id', user.id).single()
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  if (!profile || !(profile.role === 'manager' || isDirettore)) redirect('/cassa/chiusura')

  // fornitori è già scoped da RLS sull'owner corretto per entrambi i ruoli.
  const { data: fornitori } = await supabase.from('fornitori').select('id, nome').order('nome')

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="cassa-display text-2xl">Articoli</h1>
      <p className="text-muted-foreground text-sm mt-2 mb-6">Catalogo articoli per fornitore, con andamento prezzo.</p>
      <ArticoliClient fornitori={fornitori ?? []} />
    </div>
  )
}
