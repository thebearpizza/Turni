import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { destinatariDi, type BersaglioBacheca, type TargetBacheca } from '@/components/altro/destinatari'
import { chiamante, puoPubblicare, localiDi, staffDi, notifica } from './notifica'

export const dynamic = 'force-dynamic'

const SELECT = '*, restaurant:restaurants(id, name), author:profiles!created_by(id, full_name)'
const TARGETS: TargetBacheca[] = ['all', 'restaurant', 'role', 'users', 'department']

// POST /api/bacheca — pubblica un comunicato e avvisa i destinatari con la
// notifica "Nuovo comunicato in bacheca" (in-app + push). L'inserimento
// passa dal client dell'utente, quindi resta soggetto alla RLS di
// `bulletins`; qui in più si controlla che nessuno scriva fuori dai propri
// locali, perché le notifiche partono con il client amministratore.
export async function POST(request: Request) {
  const c = await chiamante()
  if (!c) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  if (!puoPubblicare(c)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  if (c.account_status === 'pending') return NextResponse.json({ error: 'Account in attesa di approvazione. La demo è in sola lettura.' }, { status: 403 })

  const b = await request.json().catch(() => null) as (BersaglioBacheca & { title?: string; body?: string; target_label?: string | null }) | null
  const title = b?.title?.trim() ?? ''
  if (!b || !title || !TARGETS.includes(b.target)) return NextResponse.json({ error: 'Dati del comunicato non validi' }, { status: 400 })

  const bersaglio: BersaglioBacheca = {
    target: b.target,
    restaurant_id: b.restaurant_id ?? null,
    target_roles: Array.isArray(b.target_roles) ? b.target_roles.filter(r => r === 'dipendente' || r === 'capo_servizio') : [],
    target_user_ids: Array.isArray(b.target_user_ids) ? b.target_user_ids.filter(x => typeof x === 'string') : [],
    target_department: b.target_department ?? null,
  }

  // Perimetro: chi non vede tutti i locali non può usare bersagli "aperti"
  // senza locale, né scegliere locali o persone fuori dai propri.
  const locali = localiDi(c)
  const staff = await staffDi(c)
  if (locali !== null) {
    const aperto = bersaglio.target === 'all' || bersaglio.target === 'role' || (bersaglio.target === 'department' && !bersaglio.restaurant_id)
    if (aperto && c.role !== 'manager') return NextResponse.json({ error: 'Scegli il tuo locale come destinatario' }, { status: 403 })
    if (bersaglio.restaurant_id && !locali.includes(bersaglio.restaurant_id)) return NextResponse.json({ error: 'Locale non autorizzato' }, { status: 403 })
    if (bersaglio.target === 'users') {
      const ammessi = new Set(staff.map(p => p.id))
      if (!(bersaglio.target_user_ids ?? []).every(id => ammessi.has(id))) return NextResponse.json({ error: 'Destinatari non autorizzati' }, { status: 403 })
    }
  }
  if (bersaglio.target === 'users' && !(bersaglio.target_user_ids ?? []).length) return NextResponse.json({ error: 'Scegli almeno una persona' }, { status: 400 })

  const supabase = await createClient()
  const riga = { title, body: b.body?.trim() ?? '', ...bersaglio, created_by: c.id }
  // `target_label` (descrizione dei destinatari come scelta nel foglio)
  // arriva con la migrazione proposta: finché la colonna non c'è si
  // salva senza.
  let { data, error } = await supabase.from('bulletins').insert({ ...riga, target_label: b.target_label ?? null }).select(SELECT).single()
  if (error && /target_label/.test(error.message)) {
    ({ data, error } = await supabase.from('bulletins').insert(riga).select(SELECT).single())
  }
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Pubblicazione non riuscita' }, { status: 400 })

  const persone = destinatariDi(bersaglio, staff).filter(p => p.id !== c.id)
  const notificati = await notifica(persone, 'Nuovo comunicato in bacheca', title)
  return NextResponse.json({ bulletin: data, notificati }, { status: 201 })
}
