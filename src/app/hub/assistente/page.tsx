import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { HubAssistenteChat } from '@/components/manager/HubAssistenteChat'

// Pannello dell'assistente come rotta a sé: manager e direttore (che nel
// design Direttore Smartphone / Tablet v2 ha la stessa scintilla).
export default async function HubAssistentePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, is_direttore, full_name').eq('id', user.id).single()
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  if (!profile || (profile.role !== 'manager' && !isDirettore)) redirect('/dashboard')

  return <HubAssistenteChat nome={profile.full_name ?? ''} home={isDirettore ? '/dashboard' : '/hub'} />
}
