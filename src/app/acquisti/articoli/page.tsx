import { ArticoliClient } from '@/components/acquisti/ArticoliClient'
import { contestoAcquisti } from '../_lib/contesto'

// Manager e direttore correggono il catalogo come hanno sempre fatto.
export default async function ArticoliPage() {
  const { supabase, ruolo, restaurants } = await contestoAcquisti()
  const { data: fornitori } = await supabase.from('fornitori').select('id, nome').order('nome')
  return <ArticoliClient restaurants={restaurants} fornitori={fornitori ?? []} canEdit single={ruolo === 'direttore' || restaurants.length <= 1} />
}
