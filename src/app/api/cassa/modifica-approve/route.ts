import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeModificaPayload } from '@/lib/cassa/modificaFields'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'

// POST /api/cassa/modifica-approve
// Body: { modificaId: string, action: 'approve' | 'reject' }
// Manager-only. Approve: applica il payload alla chiusura originale (i
// campi derivati vengono ricalcolati dal trigger). Reject: la chiusura
// originale resta invariata.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'manager') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { modificaId, action } = await request.json()
  if (!modificaId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  // La RLS di cassa_chiusure_modifiche_select restituisce solo le richieste
  // dei ristoranti che questo manager può gestire (can_manage_restaurant).
  const { data: modifica } = await supabase
    .from('cassa_chiusure_modifiche')
    .select('id, chiusura_id, payload, stato, richiesto_da')
    .eq('id', modificaId)
    .maybeSingle()

  if (!modifica) return NextResponse.json({ error: 'Richiesta non trovata o non autorizzata' }, { status: 404 })
  if (modifica.stato !== 'in_attesa') return NextResponse.json({ error: 'Richiesta già gestita' }, { status: 400 })

  const newStato = action === 'approve' ? 'approvata' : 'rifiutata'

  if (action === 'approve') {
    const payload = sanitizeModificaPayload(modifica.payload)
    if (!payload) return NextResponse.json({ error: 'Payload della richiesta non valido' }, { status: 400 })

    const { error: updErr } = await supabase
      .from('cassa_chiusure')
      .update({ ...payload, updated_by: user.id })
      .eq('id', modifica.chiusura_id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  const { error } = await supabase
    .from('cassa_chiusure_modifiche')
    .update({ stato: newStato, rivisto_da: user.id, rivisto_at: new Date().toISOString() })
    .eq('id', modificaId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (modifica.richiesto_da) {
    const admin = createAdminClient()
    await admin.from('notifications').insert({
      user_id: modifica.richiesto_da,
      title: action === 'approve' ? 'Modifica chiusura cassa approvata' : 'Modifica chiusura cassa rifiutata',
      message: action === 'approve'
        ? 'La tua richiesta di modifica alla chiusura cassa è stata approvata e applicata.'
        : 'La tua richiesta di modifica alla chiusura cassa è stata rifiutata dal manager.',
      link: '/cassa/chiusura',
    })
  }

  revalidatePath('/cassa/approvazioni')
  return NextResponse.json({ success: true, stato: newStato })
}
