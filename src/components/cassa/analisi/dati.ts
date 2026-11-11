import type { createClient } from '@/lib/supabase/client'
import type { Acquisto, Chiusura, Voce } from '@/lib/analisi'

type Supa = ReturnType<typeof createClient>

// Con centinaia di chiusure l'elenco di id in querystring supera i limiti
// di URI del gateway: le richieste per chiusura_id vanno a blocchi.
const BLOCCO = 150
const blocchi = <T,>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / BLOCCO) }, (_, i) => xs.slice(i * BLOCCO, (i + 1) * BLOCCO))

export async function caricaChiusure(sb: Supa, locali: string[], a: string, b: string): Promise<{ righe: Chiusura[]; errore: boolean }> {
  if (!locali.length || b < a) return { righe: [], errore: false }
  const { data, error } = await sb
    .from('cassa_chiusure')
    .select('id, data, restaurant_id, totale_entrate, totale_spese_giornaliere, differenza, coperti, incasso_asporto, entrate_contanti, entrate_pos, entrate_bonifico')
    .in('restaurant_id', locali)
    .eq('stato', 'confermata')
    .gte('data', a)
    .lte('data', b)
    .order('data')
  type R = { id: string; data: string; restaurant_id: string; totale_entrate: number; totale_spese_giornaliere: number; differenza: number; coperti: number; incasso_asporto: number; entrate_contanti: number; entrate_pos: number; entrate_bonifico: number }
  return {
    errore: !!error,
    righe: ((data ?? []) as R[]).map(r => ({
      id: r.id, data: r.data, li: r.restaurant_id,
      ent: Number(r.totale_entrate) || 0, sp: Number(r.totale_spese_giornaliere) || 0, dif: Number(r.differenza) || 0,
      cop: Number(r.coperti) || 0, asp: Number(r.incasso_asporto) || 0,
      con: Number(r.entrate_contanti) || 0, pos: Number(r.entrate_pos) || 0, bon: Number(r.entrate_bonifico) || 0,
    })),
  }
}

/** Spese di cassa (tipo 'spese') o vendite per prodotto (tipo 'vendite') delle chiusure date. */
export async function caricaVoci(sb: Supa, chiusure: Chiusura[], tipo: 'spese' | 'vendite'): Promise<{ voci: Voce[]; errore: boolean }> {
  if (!chiusure.length) return { voci: [], errore: false }
  const info = new Map(chiusure.map(c => [c.id, c]))
  const risposte = await Promise.all(blocchi(chiusure.map(c => c.id)).map(ids => tipo === 'spese'
    ? sb.from('cassa_spese').select('importo, nome_spesa, chiusura_id, categoria:cassa_categorie(nome)').in('chiusura_id', ids)
    : sb.from('cassa_vendite_prodotti').select('importo, nome_prodotto, nome_categoria, chiusura_id').in('chiusura_id', ids)))
  const errore = risposte.some(r => r.error)
  const voci: Voce[] = []
  for (const r of risposte) {
    for (const x of (r.data ?? []) as Array<Record<string, unknown>>) {
      const c = info.get(x.chiusura_id as string)
      if (!c) continue
      voci.push({
        data: c.data, li: c.li,
        categoria: tipo === 'spese'
          ? ((x.categoria as { nome: string } | null)?.nome ?? 'Senza categoria')
          : ((x.nome_categoria as string | null) ?? 'Senza categoria'),
        nome: (tipo === 'spese' ? x.nome_spesa : x.nome_prodotto) as string,
        importo: Number(x.importo) || 0,
      })
    }
  }
  return { voci, errore }
}

/** Fatture fornitori del periodo, divise per tipologia degli articoli. */
export async function caricaAcquisti(sb: Supa, locali: string[], a: string, b: string): Promise<Acquisto[]> {
  if (!locali.length || b < a) return []
  const { data } = await sb
    .from('fatture')
    .select('data, restaurant_id, fornitore:fornitori(nome), fatture_articoli(prezzo_riga, catalogo_articolo:catalogo_articoli(tipologia))')
    .in('restaurant_id', locali)
    .gte('data', a)
    .lte('data', b)
  type R = { data: string; restaurant_id: string; fornitore: { nome: string } | null; fatture_articoli: { prezzo_riga: number; catalogo_articolo: { tipologia: string } | null }[] | null }
  return ((data ?? []) as unknown as R[]).map(f => {
    const o: Acquisto = { data: f.data, li: f.restaurant_id, fornitore: f.fornitore?.nome ?? '—', fo: 0, be: 0, de: 0, an: 0 }
    for (const r of f.fatture_articoli ?? []) {
      const v = Number(r.prezzo_riga) || 0, tp = r.catalogo_articolo?.tipologia
      if (tp === 'food') o.fo += v
      else if (tp === 'beverage') o.be += v
      else if (tp === 'detergenza') o.de += v
      else if (tp === 'altro_no_food') o.an += v
    }
    return o
  }).filter(o => o.fo + o.be + o.de + o.an > 0)
}

/** Spesa netta per fattura e fornitore nel periodo (scheda Fornitori di Analisi). */
export interface SpesaFornitore { data: string; li: string; fornitore: string; netto: number }

export async function caricaFornitori(sb: Supa, locali: string[], a: string, b: string): Promise<SpesaFornitore[]> {
  if (!locali.length || b < a) return []
  const { data } = await sb
    .from('fatture')
    .select('data, restaurant_id, totale_netto, fornitore:fornitori(nome)')
    .in('restaurant_id', locali)
    .gte('data', a)
    .lte('data', b)
  type R = { data: string; restaurant_id: string; totale_netto: number | null; fornitore: { nome: string } | null }
  return ((data ?? []) as unknown as R[]).map(f => ({ data: f.data, li: f.restaurant_id, fornitore: f.fornitore?.nome ?? '—', netto: Number(f.totale_netto) || 0 }))
}
