import { FattureClient } from '@/components/acquisti/FattureClient'
import { contestoAcquisti } from '../_lib/contesto'

export default async function FatturePage({ searchParams }: { searchParams: Promise<{ xml?: string; f?: string }> }) {
  const { xml, f } = await searchParams
  const { supabase, ruolo, restaurants } = await contestoAcquisti()
  // Categorie e fornitori sono già limitati da RLS al gestore giusto.
  const [{ data: categorieDirette }, { data: fornitori }, fattura] = await Promise.all([
    supabase.from('categorie_fatture_dirette').select('id, nome').order('nome'),
    supabase.from('fornitori').select('id, nome').order('nome'),
    // ?f=<id> (da Articoli › Ultimo acquisto): si apre il mese di quella fattura.
    // Solo fra i locali in elenco: una fattura di un locale nascosto non
    // sposta il mese né si seleziona.
    f && restaurants.length ? supabase.from('fatture').select('id, data').eq('id', f).in('restaurant_id', restaurants.map(r => r.id)).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const sel = fattura.data as { id: string; data: string } | null
  return (
    <FattureClient
      ruolo={ruolo}
      restaurants={restaurants}
      categorieDirette={categorieDirette ?? []}
      fornitori={fornitori ?? []}
      meseIniziale={sel?.data.slice(0, 7)}
      selIniziale={sel?.id ?? null}
      apriXml={xml === '1'}
    />
  )
}
