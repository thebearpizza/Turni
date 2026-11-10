import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CassaManagerClient, type LocaleCassa } from '@/components/cassa/manager/CassaManagerClient'

// Cassa › Buste (MTCassa): progressivo delle buste di versamento.
export default async function ProgressivoBustePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role === 'hostess') redirect('/cassa/prenotazioni')
  if (profile?.role !== 'manager') redirect('/cassa/chiusura')

  const { data: restaurants } = await supabase.from('restaurants').select('id, name, closing_days').order('name')
  return <CassaManagerClient sec="buste" restaurants={(restaurants ?? []) as LocaleCassa[]} />
}
