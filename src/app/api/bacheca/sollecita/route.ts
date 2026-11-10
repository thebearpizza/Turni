import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { destinatariDi, type BersaglioBacheca } from '@/components/altro/destinatari'
import { chiamante, puoPubblicare, staffDi, notifica } from '../notifica'

export const dynamic = 'force-dynamic'

// POST /api/bacheca/sollecita { bulletinId } — "Sollecita chi non ha letto":
// manda di nuovo la notifica solo ai destinatari che non hanno ancora
// aperto il comunicato.
export async function POST(request: Request) {
  const c = await chiamante()
  if (!c) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  if (!puoPubblicare(c)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { bulletinId } = await request.json().catch(() => ({})) as { bulletinId?: string }
  if (!bulletinId) return NextResponse.json({ error: 'Comunicato mancante' }, { status: 400 })

  // Letto con il client dell'utente: se la RLS non glielo mostra, non può sollecitarlo.
  const supabase = await createClient()
  const { data: b } = await supabase
    .from('bulletins')
    .select('id, title, target, restaurant_id, target_roles, target_user_ids, target_department, created_by')
    .eq('id', bulletinId)
    .single()
  if (!b) return NextResponse.json({ error: 'Comunicato non trovato' }, { status: 404 })
  // Il capo servizio sollecita solo i propri comunicati.
  if (c.role === 'capo_servizio' && !c.is_direttore && b.created_by !== c.id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const staff = await staffDi(c)
  const { data: letti } = await createAdminClient().from('bulletin_reads').select('user_id').eq('bulletin_id', bulletinId)
  const hanno = new Set((letti ?? []).map((r: { user_id: string }) => r.user_id))
  const persone = destinatariDi(b as BersaglioBacheca, staff).filter(p => !hanno.has(p.id) && p.id !== b.created_by)
  const notificati = await notifica(persone, 'Comunicato da leggere', b.title)
  return NextResponse.json({ notificati })
}
