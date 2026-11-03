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
    // Il manager apre l'app sulle Analisi di cassa: è la schermata che
    // consulta ogni mattina; la Home resta un tocco più in là nel dock.
    redirect('/cassa/analisi')
  } else if (profile.role === 'cassiere' || profile.role === 'hostess') {
    redirect('/cassa')
  } else if (profile.role === 'capo_servizio' && profile.is_direttore === true) {
    // Design Direttore v2: la Home del direttore è la sua timbratura con le
    // presenze di oggi e le approvazioni (dashboard), non l'indice delle aree.
    redirect('/dashboard')
  } else {
    redirect('/dashboard')
  }
}
