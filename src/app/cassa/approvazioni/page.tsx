import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CassaManagerClient, type LocaleCassa } from '@/components/cassa/manager/CassaManagerClient'

// Cassa › Approvazioni (MTCassa): modifiche a chiusure già inviate, in
// revisione. ?sel=<id> arriva da "Rivedi la modifica" e la apre subito.
export default async function ApprovazioniCassaPage({ searchParams }: { searchParams: Promise<{ sel?: string }> }) {
  const { sel } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role === 'hostess') redirect('/cassa/prenotazioni')
  if (profile?.role !== 'manager') redirect('/cassa/chiusura')

  const { data: restaurants } = await supabase.from('restaurants').select('id, name, closing_days').order('name')
  return <CassaManagerClient sec="approvazioni" restaurants={(restaurants ?? []) as LocaleCassa[]} selIniziale={sel} />
}
