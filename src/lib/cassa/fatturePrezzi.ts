import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

// Prezzo unitario dell'ultimo acquisto registrato per questo articolo di
// catalogo, ordinato per data fattura (non per data di inserimento a
// sistema, che potrebbe non coincidere se una fattura viene caricata in
// ritardo) — usato dalla verifica di scostamento prezzo (Task 2).
export async function ultimoPrezzoNoto(supabase: SupabaseServerClient, catalogoArticoloId: string): Promise<number | null> {
  const { data } = await supabase
    .from('fatture_articoli')
    .select('prezzo_unitario, fattura:fatture!inner(data)')
    .eq('catalogo_articolo_id', catalogoArticoloId)
    .order('data', { foreignTable: 'fatture', ascending: false })
    .limit(1)
    .maybeSingle()

  return data?.prezzo_unitario ?? null
}
