import type { createClient } from '@/lib/supabase/client'
import { caricaChiusure, caricaVoci } from '@/components/cassa/analisi/dati'
import { contoEconomico, movimenti, valeNelMese, type ContoEconomico, type CostoGestione, type FatturaMese, type Movimento, type SpesaContanti } from '@/lib/utile'

// Dati dell'utile per un intervallo di mesi, condivisi da Cassa → Utile
// (un mese) e dal resoconto in Analisi (i mesi spuntati come completi).

type Supa = ReturnType<typeof createClient>

export interface DatiUtile {
  incassi: { li: string; data: string; ent: number }[]
  fatture: FatturaMese[]
  contanti: SpesaContanti[]
  costi: CostoGestione[]
  /** Mesi completi per locale: "id|2026-10-01". */
  completi: Set<string>
}

export const chiaveCompleto = (li: string, m01: string) => `${li}|${m01}`
export const fineMese = (m01: string) => { const [y, m] = m01.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }

/** a e b: primo giorno del primo e dell'ultimo mese. */
export async function caricaUtile(sb: Supa, ids: string[], a: string, b: string): Promise<{ dati: DatiUtile; errore: boolean }> {
  const vuoto: DatiUtile = { incassi: [], fatture: [], contanti: [], costi: [], completi: new Set() }
  if (!ids.length || b < a) return { dati: vuoto, errore: false }
  const fine = fineMese(b)
  const [ch, fa, co, cm] = await Promise.all([
    caricaChiusure(sb, ids, a, fine),
    sb.from('fatture')
      .select('data, numero_documento, restaurant_id, totale_netto, ha_articoli, fornitore:fornitori(nome), categoria:categorie_fatture_dirette(nome), fatture_articoli(prezzo_riga, catalogo_articolo:catalogo_articoli(tipologia))')
      .in('restaurant_id', ids).gte('data', a).lte('data', fine),
    sb.from('costi_gestione').select('id, restaurant_ids, categoria, descrizione, importo, ricorrente, mese_da, mese_a')
      .overlaps('restaurant_ids', ids).lte('mese_da', b).or(`mese_a.is.null,mese_a.gte.${a}`),
    sb.from('utile_mesi_completi').select('restaurant_id, mese').in('restaurant_id', ids).gte('mese', a).lte('mese', b),
  ])
  // Spese in contanti con la loro categoria di cassa: finiscono nella voce
  // corrispondente del conto (personale, merci, utenze...).
  const sp = ch.errore ? { voci: [], errore: true } : await caricaVoci(sb, ch.righe, 'spese')
  if (ch.errore || fa.error || co.error || sp.errore) return { dati: vuoto, errore: true }

  type R = { data: string; numero_documento: string; restaurant_id: string; totale_netto: number | null; ha_articoli: boolean; fornitore: { nome: string } | null; categoria: { nome: string } | null; fatture_articoli: { prezzo_riga: number; catalogo_articolo: { tipologia: string } | null }[] | null }
  const fatture = ((fa.data ?? []) as unknown as R[]).map(f => {
    const o: FatturaMese = {
      li: f.restaurant_id, netto: Number(f.totale_netto) || 0, diretta: f.ha_articoli ? null : (f.categoria?.nome ?? 'Altre fatture'),
      food: 0, beverage: 0, materiali: 0, data: f.data, fornitore: f.fornitore?.nome ?? undefined, numero: f.numero_documento,
    }
    for (const r of f.fatture_articoli ?? []) {
      const v = Number(r.prezzo_riga) || 0, tp = r.catalogo_articolo?.tipologia
      if (tp === 'food') o.food += v
      else if (tp === 'beverage') o.beverage += v
      else o.materiali += v
    }
    return o
  })
  return {
    errore: false,
    dati: {
      incassi: ch.righe.map(r => ({ li: r.li, data: r.data, ent: r.ent })),
      fatture,
      contanti: sp.voci.map(v => ({ categoria: v.categoria, importo: v.importo, nome: v.nome, data: v.data, li: v.li })),
      costi: ((co.data ?? []) as CostoGestione[]).map(c => ({ ...c, importo: Number(c.importo) || 0 })),
      // Tabella assente (migrazione non applicata): nessun mese completo.
      completi: new Set((cm.data ?? []).map(r => chiaveCompleto(r.restaurant_id as string, r.mese as string))),
    },
  }
}

/** Conto economico e uscite di un mese per i locali dati. */
export function contoMese(d: DatiUtile, m01: string, locali: Set<string>): { ce: ContoEconomico; mov: Movimento[]; giorni: number } {
  const mese = m01.slice(0, 7)
  const nelMese = (data?: string) => !!data && data.slice(0, 7) === mese
  const inc = d.incassi.filter(r => locali.has(r.li) && nelMese(r.data))
  const fatture = d.fatture.filter(f => locali.has(f.li) && nelMese(f.data))
  const contanti = d.contanti.filter(s => !!s.li && locali.has(s.li) && nelMese(s.data))
  const costi = d.costi.filter(c => valeNelMese(c, m01) && c.restaurant_ids.some(id => locali.has(id)))
  const x = { contanti, fatture, costi, locali }
  return {
    ce: contoEconomico({ incassi: inc.reduce((t, r) => t + r.ent, 0), ...x }),
    mov: movimenti(x).map(m => (m.fonte === 'a mano' ? { ...m, data: m01 } : m)),
    giorni: new Set(inc.map(r => r.data)).size,
  }
}
