import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { HomeManager } from '@/components/home/HomeManager'
import { datiHomeManager } from '@/lib/homeManager'

// Home del manager (design MTHome, Manager Smartphone / Tablet): riepilogo
// del giorno, indicatori di cassa, locali con andamento a 7 giorni e "Da
// fare" con le approvazioni. Il direttore ha la sua Home su /dashboard.
export default async function HubPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, is_direttore, full_name').eq('id', user.id).single()
  if (!profile || profile.role !== 'manager') redirect('/dashboard')

  return <HomeManager d={await datiHomeManager(supabase)} nome={profile.full_name ?? ''} />
}
