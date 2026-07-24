import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AnalisiClient } from '@/components/cassa/AnalisiClient'

export default async function AnalisiCassaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'manager') redirect('/cassa/chiusura')

  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('id, name')
    .order('name')

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold tracking-tight">Analisi</h1>
      <p className="text-muted-foreground text-sm mt-2 mb-6">Chiusure cassa confermate, per ristorante e periodo.</p>
      <AnalisiClient restaurants={restaurants ?? []} />
    </div>
  )
}
