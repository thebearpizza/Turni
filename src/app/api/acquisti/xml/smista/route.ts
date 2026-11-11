import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { chiediAllIa, smistaDeterministico, type EsitoSmistamento, type FatturaDaSmistare, type LocaleSmistamento } from '@/lib/cassa/fattureSmistamento'

// POST /api/acquisti/xml/smista
// Body: { fatture: [{ chiave, destinatario, pec, fornitore, indizi: [{ fonte, testo }] }] }
//
// Decide a quale locale va ogni fattura XML letta nel browser (codice
// destinatario, riferimenti nei testi, poi IA solo se sicura; vedi
// fattureSmistamento.ts). Non scrive nulla: l'esito si mostra nel
// riepilogo dell'import, dove l'utente può ancora cambiarlo.

export const maxDuration = 60

const FONTI = new Set(['destinazione', 'sede', 'causale', 'riferimenti', 'righe'])

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const grezze = body?.fatture as FatturaDaSmistare[] | undefined
  if (!Array.isArray(grezze) || grezze.length === 0 || grezze.length > 300) return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })

  const { data: profilo } = await supabase.from('profiles').select('role, is_direttore, restaurant_id').eq('id', user.id).single()
  const manager = profilo?.role === 'manager'
  if (!profilo || !(manager || (profilo.role === 'capo_servizio' && profilo.is_direttore))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  // Locali gestibili: il manager quelli che vede (RLS, come Acquisti), il
  // direttore solo il suo. Senza la migrazione mancano codice e
  // riferimenti: restano nome del locale e IA.
  const leggi = (colonne: string) => {
    const q = supabase.from('restaurants').select(colonne)
    return manager ? q : q.eq('id', profilo.restaurant_id ?? '')
  }
  let res = await leggi('id, name, address, codice_destinatario, riferimenti_fatture')
  if (res.error) res = await leggi('id, name, address')
  if (res.error) return NextResponse.json({ error: 'Locali non leggibili: ' + res.error.message }, { status: 500 })
  const locali: LocaleSmistamento[] = ((res.data ?? []) as unknown as { id: string; name: string; address: string | null; codice_destinatario?: string | null; riferimenti_fatture?: string[] | null }[])
    .map(r => ({ id: r.id, nome: r.name, indirizzo: r.address, codice: r.codice_destinatario ?? null, riferimenti: r.riferimenti_fatture ?? [] }))
  if (!locali.length) return NextResponse.json({ error: 'Nessun locale gestibile' }, { status: 403 })

  // Testi già ripuliti nel browser: qui si limita solo quanto arriva.
  const fatture: FatturaDaSmistare[] = grezze.map(f => ({
    chiave: String(f.chiave ?? ''),
    destinatario: typeof f.destinatario === 'string' ? f.destinatario.slice(0, 7) : null,
    pec: typeof f.pec === 'string' ? f.pec.slice(0, 200) : null,
    fornitore: String(f.fornitore ?? '').slice(0, 200),
    indizi: (Array.isArray(f.indizi) ? f.indizi : []).filter(x => x && FONTI.has(x.fonte) && typeof x.testo === 'string').slice(0, 400).map(x => ({ fonte: x.fonte, testo: x.testo.slice(0, 500) })),
  }))

  const esiti = new Map<string, EsitoSmistamento>()
  // Le fatture in dubbio si raggruppano per insieme di locali candidati:
  // una richiesta all'IA per gruppo (al più 25 fatture ciascuna).
  type Gruppo = { locali: LocaleSmistamento[]; fatture: FatturaDaSmistare[]; motivi: Map<string, { motivo: string; candidati: string[] }> }
  const gruppi = new Map<string, Gruppo>()
  for (const f of fatture) {
    const e = smistaDeterministico(f, locali)
    if ('dubbio' in e) {
      const k = e.dubbio.map(l => l.id).sort().join(',')
      const g: Gruppo = gruppi.get(k) ?? { locali: e.dubbio, fatture: [], motivi: new Map() }
      g.fatture.push(f); g.motivi.set(f.chiave, { motivo: e.motivo, candidati: e.candidati })
      gruppi.set(k, g)
    } else esiti.set(f.chiave, e)
  }
  const richieste: Promise<void>[] = []
  for (const g of gruppi.values()) {
    for (let i = 0; i < g.fatture.length; i += 25) {
      const pezzo = g.fatture.slice(i, i + 25)
      richieste.push(chiediAllIa(pezzo, g.locali).then(ia => {
        for (const f of pezzo) {
          const m = g.motivi.get(f.chiave)!, x = ia.get(f.chiave)
          esiti.set(f.chiave, x
            ? { chiave: f.chiave, restaurant_id: x.restaurant_id, via: 'ia', motivo: x.perche ? `Assegnata dall'IA: ${x.perche}` : "Assegnata dall'IA", candidati: m.candidati }
            : { chiave: f.chiave, restaurant_id: null, via: null, motivo: m.motivo, candidati: m.candidati })
        }
      }))
    }
  }
  await Promise.all(richieste)
  return NextResponse.json({ fatture: fatture.map(f => esiti.get(f.chiave)) })
}
