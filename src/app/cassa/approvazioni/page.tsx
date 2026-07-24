import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ModificheApprovalSection, type PendingModifica } from '@/components/cassa/ModificheApprovalSection'

export default async function ApprovazioniCassaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'manager') redirect('/cassa/chiusura')

  const { data } = await supabase
    .from('cassa_chiusure_modifiche')
    .select('id, chiusura_id, payload, created_at, chiusura:cassa_chiusure(data, restaurant:restaurants(name)), richiedente:profiles!richiesto_da(full_name)')
    .eq('stato', 'in_attesa')
    .order('created_at')

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold tracking-tight">Approvazioni Cassa</h1>
      <p className="text-muted-foreground text-sm mt-2 mb-6">Richieste di modifica alle chiusure già confermate.</p>
      <ModificheApprovalSection initialPending={(data ?? []) as unknown as PendingModifica[]} />
    </div>
  )
}
