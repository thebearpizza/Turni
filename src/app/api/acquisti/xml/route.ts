import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { verificaPrezzoArticolo } from '@/lib/cassa/fattureVerifica'
import { ultimoPrezzoNoto } from '@/lib/cassa/fatturePrezzi'
import type { VerificaSospetta } from '@/types'

// POST /api/acquisti/xml
// Body: { restaurant_id, fatture: [{ chiave, piva, fornitore, numero, righe: [{ descrizione, prezzo_unitario }] }], crea_fornitori? }
//
// Importazione delle fatture elettroniche del mese: per ogni fattura già
// letta dal tracciato nel browser risolve il fornitore, segnala i doppioni
// e abbina le righe al catalogo. Abbinamenti SOLO esatti (partita IVA, poi
// nome identico senza maiuscole; testo già mappato o nome articolo
// identico), mai approssimati: con l'XML i dati sono certi e un
// abbinamento indovinato sporcherebbe lo storico prezzi. Senza
// crea_fornitori è un'anteprima e non scrive nulla; con crea_fornitori
// registra i fornitori mancanti, poi il browser salva ogni fattura con
// /api/cassa/fatture/salva.

interface RigaIn { descrizione: string; prezzo_unitario: number }
interface FatturaIn { chiave: string; piva: string | null; fornitore: string; numero: string; righe: RigaIn[] }

const norm = (s: string) => s.trim().toLowerCase()

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const restaurantId = body?.restaurant_id as string | undefined
  const fatture = body?.fatture as FatturaIn[] | undefined
  const crea = body?.crea_fornitori === true
  if (!restaurantId || !Array.isArray(fatture) || fatture.length === 0 || fatture.length > 300) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  // Accesso: solo chi vede il locale (RLS) ed è manager o direttore.
  const { data: profilo } = await supabase.from('profiles').select('role, is_direttore').eq('id', user.id).single()
  if (!profilo || !(profilo.role === 'manager' || (profilo.role === 'capo_servizio' && profilo.is_direttore))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { data: restaurant } = await supabase.from('restaurants').select('id, owner_id').eq('id', restaurantId).single()
  if (!restaurant) return NextResponse.json({ error: 'Locale non trovato o non autorizzato' }, { status: 403 })

  const { data: elenco } = await supabase.from('fornitori').select('id, nome, partita_iva').eq('owner_id', restaurant.owner_id)
  const fornitori = [...(elenco ?? [])]
  const prezzi = new Map<string, number | null>()

  const risultati = []
  for (const f of fatture) {
    const piva = f.piva?.trim() || null
    let fo = (piva ? fornitori.find(x => x.partita_iva?.trim() === piva) : undefined) ?? fornitori.find(x => norm(x.nome) === norm(f.fornitore))
    let nuovo = false
    if (!fo && crea) {
      const { data: ins, error } = await supabase.from('fornitori').insert({ owner_id: restaurant.owner_id, nome: f.fornitore.trim(), partita_iva: piva }).select('id, nome, partita_iva').single()
      if (error || !ins) return NextResponse.json({ error: 'Fornitore non registrato: ' + (error?.message ?? 'errore') }, { status: 500 })
      fornitori.push(ins); fo = ins; nuovo = true
    } else if (fo && !fo.partita_iva && piva && crea) {
      await supabase.from('fornitori').update({ partita_iva: piva }).eq('id', fo.id)
    }
    if (!fo) {
      risultati.push({ chiave: f.chiave, fornitore: { id: null, nome: f.fornitore, nuovo: true }, duplicato: false, righe: f.righe.map(() => ({ catalogo_articolo_id: null, sospetto: null })), verifiche: [] })
      continue
    }

    const { data: dop } = await supabase.from('fatture').select('id').eq('fornitore_id', fo.id).eq('numero_documento', f.numero.trim()).limit(1)
    const [{ data: mappe }, { data: catalogo }] = await Promise.all([
      supabase.from('articoli_mappature_testo').select('testo_estratto, catalogo_articolo_id').eq('owner_id', restaurant.owner_id).eq('fornitore_id', fo.id).in('testo_estratto', f.righe.map(r => r.descrizione)),
      supabase.from('catalogo_articoli').select('id, nome_articolo').eq('owner_id', restaurant.owner_id).eq('fornitore_id', fo.id),
    ])
    const perTesto = new Map((mappe ?? []).map(m => [m.testo_estratto, m.catalogo_articolo_id as string]))
    const perNome = new Map((catalogo ?? []).map(c => [norm(c.nome_articolo), c.id as string]))
    const verifiche: VerificaSospetta[] = []
    const righe = []
    for (const r of f.righe) {
      const id = perTesto.get(r.descrizione) ?? perNome.get(norm(r.descrizione)) ?? null
      let sospetto: VerificaSospetta | null = null
      if (id) {
        if (!prezzi.has(id)) prezzi.set(id, await ultimoPrezzoNoto(supabase, id))
        sospetto = verificaPrezzoArticolo(r.descrizione, r.prezzo_unitario, prezzi.get(id) ?? null)
        if (sospetto) verifiche.push(sospetto)
      }
      righe.push({ catalogo_articolo_id: id, sospetto })
    }
    risultati.push({ chiave: f.chiave, fornitore: { id: fo.id, nome: fo.nome, nuovo }, duplicato: !!dop?.length, righe, verifiche })
  }
  return NextResponse.json({ fatture: risultati })
}
