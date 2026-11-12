import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { verificaPrezzoArticolo } from '@/lib/cassa/fattureVerifica'
import { ultimoPrezzoNoto } from '@/lib/cassa/fatturePrezzi'
import { proponiTipologie } from '@/lib/cassa/fattureSmistamento'
import type { VerificaSospetta } from '@/types'
import { archivioAperto, soloVisibili } from '@/lib/localiVisibili'

// Margine ampio: uno ZIP di un mese sono decine di fatture. Il lavoro è
// comunque raggruppato (vedi sotto) e il browser manda blocchi da 40.
export const maxDuration = 300

// POST /api/acquisti/xml
// Body: { restaurant_id?, fatture: [{ chiave, restaurant_id?, piva, fornitore, numero, righe: [{ descrizione, prezzo_unitario }] }], crea_fornitori? }
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
//
// Il locale è per fattura (smistamento, vedi /api/acquisti/xml/smista):
// fornitori e catalogo sono del gestore (owner_id) del locale. Una
// fattura ancora da assegnare si controlla col gestore dei locali
// visibili, se è uno solo; con crea_fornitori il locale è obbligatorio.

interface RigaIn { descrizione: string; prezzo_unitario: number }
interface FatturaIn { chiave: string; restaurant_id?: string | null; piva: string | null; fornitore: string; numero: string; righe: RigaIn[] }

const norm = (s: string) => s.trim().toLowerCase()

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const restaurantId = (body?.restaurant_id as string | undefined) ?? null
  const fatture = body?.fatture as FatturaIn[] | undefined
  const crea = body?.crea_fornitori === true
  // Solo in anteprima: tipologia proposta dall'IA per le righe senza
  // articolo a catalogo (il browser la conserva fino all'import).
  const proponi = body?.proponi_tipologie === true && !crea
  if (!Array.isArray(fatture) || fatture.length === 0 || fatture.length > 300) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }
  if (crea && fatture.some(f => !(f.restaurant_id ?? restaurantId))) {
    return NextResponse.json({ error: 'Locale mancante per una fattura' }, { status: 400 })
  }

  // Accesso: solo chi vede il locale (RLS) ed è manager o direttore.
  const { data: profilo } = await supabase.from('profiles').select('role, is_direttore').eq('id', user.id).single()
  if (!profilo || !(profilo.role === 'manager' || (profilo.role === 'capo_servizio' && profilo.is_direttore))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  // Locali visibili (RLS) e loro gestore. Per il manager solo gli attivi,
  // o quello aperto in archivio: una fattura non si importa in un locale
  // nascosto (il controllo qui sotto la rifiuta). Il direttore resta sul
  // suo locale, anche se nascosto.
  const qLocali = supabase.from('restaurants').select('id, owner_id')
  const { data: visibili } = await (profilo.role === 'manager' ? soloVisibili(qLocali, await archivioAperto()) : qLocali)
  const ownerDi = new Map((visibili ?? []).map(r => [r.id as string, r.owner_id as string | null]))
  const owners = [...new Set((visibili ?? []).map(r => r.owner_id as string | null))]
  const ownerUnico = owners.length === 1 ? owners[0] : null
  for (const f of fatture) {
    const rid = f.restaurant_id ?? restaurantId
    if (rid && !ownerDi.has(rid)) return NextResponse.json({ error: 'Locale non trovato o non autorizzato' }, { status: 403 })
  }

  const perOwner = new Map<string, { id: string; nome: string; partita_iva: string | null }[]>()
  async function fornitoriDi(owner: string) {
    if (!perOwner.has(owner)) {
      const { data: elenco } = await supabase.from('fornitori').select('id, nome, partita_iva').eq('owner_id', owner)
      perOwner.set(owner, [...(elenco ?? [])])
    }
    return perOwner.get(owner)!
  }
  // ── 1. Fornitori, in ordine: un fornitore nuovo va creato una volta sola
  // anche se compare in più fatture. Letture e scritture in memoria per
  // gestore, quindi poche richieste.
  const risolti: ({ f: FatturaIn; owner: string | null; fo: { id: string; nome: string; partita_iva: string | null } | null; nuovo: boolean })[] = []
  for (const f of fatture) {
    const rid = f.restaurant_id ?? restaurantId
    const owner = rid ? ownerDi.get(rid) ?? null : ownerUnico
    const fornitori = owner ? await fornitoriDi(owner) : []
    const piva = f.piva?.trim() || null
    let fo = (piva ? fornitori.find(x => x.partita_iva?.trim() === piva) : undefined) ?? fornitori.find(x => norm(x.nome) === norm(f.fornitore)) ?? null
    let nuovo = false
    if (!fo && crea && owner) {
      const { data: ins, error } = await supabase.from('fornitori').insert({ owner_id: owner, nome: f.fornitore.trim(), partita_iva: piva }).select('id, nome, partita_iva').single()
      if (error || !ins) return NextResponse.json({ error: 'Fornitore non registrato: ' + (error?.message ?? 'errore') }, { status: 500 })
      fornitori.push(ins); fo = ins; nuovo = true
    } else if (fo && !fo.partita_iva && piva && crea) {
      fo.partita_iva = piva
      await supabase.from('fornitori').update({ partita_iva: piva }).eq('id', fo.id)
    }
    risolti.push({ f, owner, fo, nuovo })
  }

  // ── 2. Doppioni, catalogo e mappature: una lettura per fornitore (non una
  // per fattura), tutte in parallelo. Prima erano centinaia di letture in
  // fila e la richiesta superava il limite di tempo.
  const perFornitore = new Map<string, { owner: string; numeri: Set<string>; testi: Set<string> }>()
  for (const r of risolti) {
    if (!r.fo || !r.owner) continue
    const x = perFornitore.get(r.fo.id) ?? { owner: r.owner, numeri: new Set<string>(), testi: new Set<string>() }
    x.numeri.add(r.f.numero.trim())
    r.f.righe.forEach(rg => x.testi.add(rg.descrizione))
    perFornitore.set(r.fo.id, x)
  }
  const doppioni = new Set<string>()
  const mappe = new Map<string, Map<string, string>>()
  const catalogo = new Map<string, Map<string, string>>()
  // Liste lunghe divise in pezzi: finiscono nell'indirizzo della richiesta.
  const aPezzi = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))
  await Promise.all([...perFornitore.entries()].map(async ([foId, x]) => {
    const [dop, map, cat] = await Promise.all([
      Promise.all(aPezzi([...x.numeri], 60).map(nn => supabase.from('fatture').select('numero_documento').eq('fornitore_id', foId).in('numero_documento', nn))),
      Promise.all(aPezzi([...x.testi], 40).map(tt => supabase.from('articoli_mappature_testo').select('testo_estratto, catalogo_articolo_id').eq('owner_id', x.owner).eq('fornitore_id', foId).in('testo_estratto', tt))),
      supabase.from('catalogo_articoli').select('id, nome_articolo').eq('owner_id', x.owner).eq('fornitore_id', foId),
    ])
    dop.forEach(({ data }) => (data ?? []).forEach(d => doppioni.add(`${foId}|${d.numero_documento}`)))
    mappe.set(foId, new Map(map.flatMap(({ data }) => (data ?? []).map(m => [m.testo_estratto as string, m.catalogo_articolo_id as string]))))
    catalogo.set(foId, new Map((cat.data ?? []).map(c => [norm(c.nome_articolo), c.id as string])))
  }))

  // ── 3. Ultimo prezzo noto di ogni articolo abbinato (stessa lettura di
  // sempre, per data fattura), 12 articoli alla volta invece che in fila.
  const idArticoli = new Set<string>()
  const abbina = (r: typeof risolti[number], desc: string) => (r.fo ? mappe.get(r.fo.id)?.get(desc) ?? catalogo.get(r.fo.id)?.get(norm(desc)) ?? null : null)
  for (const r of risolti) for (const rg of r.f.righe) { const id = abbina(r, rg.descrizione); if (id) idArticoli.add(id) }
  const prezzi = new Map<string, number | null>()
  for (const ids of aPezzi([...idArticoli], 12)) {
    const vv = await Promise.all(ids.map(id => ultimoPrezzoNoto(supabase, id)))
    ids.forEach((id, i) => prezzi.set(id, vv[i]))
  }

  const risultati = risolti.map(r => {
    const { f, fo, nuovo } = r
    if (!fo) return { chiave: f.chiave, fornitore: { id: null, nome: f.fornitore, nuovo: true }, duplicato: false, righe: f.righe.map(() => ({ catalogo_articolo_id: null, sospetto: null, tipologia_proposta: null as string | null })), verifiche: [] as VerificaSospetta[] }
    const verifiche: VerificaSospetta[] = []
    const righe = f.righe.map(rg => {
      const id = abbina(r, rg.descrizione)
      let sospetto: VerificaSospetta | null = null
      if (id) {
        sospetto = verificaPrezzoArticolo(rg.descrizione, rg.prezzo_unitario, prezzi.get(id) ?? null)
        if (sospetto) verifiche.push(sospetto)
      }
      return { catalogo_articolo_id: id, sospetto, tipologia_proposta: null as string | null }
    })
    return { chiave: f.chiave, fornitore: { id: fo.id, nome: fo.nome, nuovo }, duplicato: doppioni.has(`${fo.id}|${f.numero.trim()}`), righe, verifiche }
  })
  if (proponi) {
    const senza = risultati.flatMap((r, i) => r.duplicato ? [] : r.righe.flatMap((x, j) => (x.catalogo_articolo_id ? [] : [fatture[i].righe[j]?.descrizione ?? ''])))
    const proposte = await proponiTipologie(senza)
    risultati.forEach((r, i) => r.righe.forEach((x, j) => { if (!x.catalogo_articolo_id) x.tipologia_proposta = proposte.get((fatture[i].righe[j]?.descrizione ?? '').trim()) ?? null }))
  }
  return NextResponse.json({ fatture: risultati })
}
