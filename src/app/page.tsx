import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_direttore')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  if (profile.role === 'dipendente') {
    redirect('/home')
  } else if (profile.role === 'manager') {
    redirect('/hub')
  } else if (profile.role === 'cassiere' || profile.role === 'hostess') {
    redirect('/cassa')
  } else if (profile.role === 'capo_servizio' && profile.is_direttore === true) {
    // Il direttore ha una Home come il manager (Turni/Acquisti, non Cassa) —
    // vedi hub/page.tsx.
    redirect('/hub')
  } else {
    redirect('/dashboard')
  }
}
