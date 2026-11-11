import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { archivioAperto, soloVisibili } from '@/lib/localiVisibili'

// Chi apre Acquisti e su quali locali: il manager su quelli visibili (gli
// attivi, oppure il solo locale aperto in archivio: mai i nascosti
// mescolati agli attivi), il direttore solo sul suo, anche se nascosto. L'accesso all'area è già
// controllato da acquisti/layout.tsx.
export async function contestoAcquisti() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role, restaurant_id').eq('id', user.id).single()
  if (!profile) redirect('/login')
  const ruolo: 'manager' | 'direttore' = profile.role === 'manager' ? 'manager' : 'direttore'
  const { data: restaurants } = ruolo === 'manager'
    ? await soloVisibili(supabase.from('restaurants').select('id, name'), await archivioAperto()).order('name')
    : profile.restaurant_id
      ? await supabase.from('restaurants').select('id, name').eq('id', profile.restaurant_id)
      : { data: [] as { id: string; name: string }[] }
  return { supabase, ruolo, restaurants: (restaurants ?? []) as { id: string; name: string }[] }
}
