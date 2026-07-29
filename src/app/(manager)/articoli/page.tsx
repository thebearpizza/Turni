import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ArticoliClient } from '@/components/cassa/ArticoliClient'

// Stessa vista di /cassa/articoli, ma ospitata dentro la shell dell'app
// Turni invece che in quella di Cassa — vedi /(manager)/fatture per il
// motivo (solo per il direttore, che vi arriva dalla sidebar di Turni).
export default async function ArticoliTurniPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, is_direttore').eq('id', user.id).single()
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  if (!isDirettore) redirect('/dashboard')

  // fornitori è già scoped da RLS sull'owner corretto.
  const { data: fornitori } = await supabase.from('fornitori').select('id, nome').order('nome')

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold tracking-tight">Articoli</h1>
      <p className="text-muted-foreground text-sm mt-2 mb-6">Catalogo articoli per fornitore, con andamento prezzo.</p>
      <ArticoliClient fornitori={fornitori ?? []} />
    </div>
  )
}
