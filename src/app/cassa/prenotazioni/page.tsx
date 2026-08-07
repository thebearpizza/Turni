import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PrenotazioniClient } from '@/components/cassa/PrenotazioniClient'

export default async function PrenotazioniPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, is_direttore').eq('id', user.id).single()
  if (profile?.role === 'capo_servizio' && profile.is_direttore) redirect('/cassa/fatture')
  if (profile?.role !== 'manager') redirect('/cassa/chiusura')

  // Solo i locali con almeno un'insegna configurata hanno un libro
  // visite collegato: mostrare gli altri nel selettore significherebbe
  // offrire un'agenda che non potrà mai riempirsi.
  const { data: insegne } = await supabase
    .from('prenotazioni_insegne')
    .select('id, restaurant_id, codice, etichetta, restaurants(id, name)')
    .order('codice')

  const perLocale = new Map<string, { id: string; name: string }>()
  for (const i of insegne ?? []) {
    const r = i.restaurants as unknown as { id: string; name: string } | null
    if (r) perLocale.set(r.id, r)
  }

  return (
    <PrenotazioniClient
      restaurants={[...perLocale.values()].sort((a, b) => a.name.localeCompare(b.name))}
      insegne={(insegne ?? []).map(i => ({
        id: i.id,
        restaurant_id: i.restaurant_id,
        codice: i.codice,
        etichetta: i.etichetta,
      }))}
    />
  )
}
