import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FornitoriClient } from '@/components/acquisti/FornitoriClient'

// L'accesso a /acquisti/* (manager, direttore) è già gestito da
// acquisti/layout.tsx — qui serve solo sapere se questo utente può
// modificare (CRUD riservato al manager) o vede in sola lettura.
export default async function FornitoriPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile) redirect('/login')

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="cassa-display text-2xl">Fornitori</h1>
      <p className="text-muted-foreground text-sm mt-2 mb-6">Anagrafica fornitori, fatture e catalogo articoli.</p>
      <FornitoriClient canEdit={profile.role === 'manager'} />
    </div>
  )
}
