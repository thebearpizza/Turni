import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { HubAssistenteChat } from '@/components/manager/HubAssistenteChat'

// Schermata dedicata dell'assistente (Task 4) — raggiunta dalla barra IA
// della Home Manager. Stesso guard di /hub: solo manager.
export default async function HubAssistentePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'manager') redirect('/dashboard')

  return <HubAssistenteChat />
}
