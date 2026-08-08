import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

// Landing dell'app Cassa: il manager entra su Analisi, il cassiere
// direttamente sulla Chiusura Cassa (unica sezione che gli serve davvero),
// l'hostess sulle Prenotazioni (l'unica che può vedere).
export default async function CassaIndexPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role === 'hostess') redirect('/cassa/prenotazioni')
  redirect(profile?.role === 'manager' ? '/cassa/analisi' : '/cassa/chiusura')
}
