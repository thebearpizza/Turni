import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeModificaPayload } from '@/lib/cassa/modificaFields'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'

// POST /api/cassa/richiedi-modifica
// Body: { chiusura_id: string, payload: Record<string, number> }
// Cassiere-only. Crea una richiesta di modifica in attesa di approvazione
// per una chiusura già confermata — la riga originale non viene toccata —
// e notifica i manager che gestiscono il ristorante.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, full_name')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'cassiere') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { chiusura_id, payload: rawPayload } = await request.json()
  const payload = sanitizeModificaPayload(rawPayload)
  if (!chiusura_id || !payload) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  const { data: chiusura } = await supabase
    .from('cassa_chiusure')
    .select('id, restaurant_id, data, stato')
    .eq('id', chiusura_id)
    .maybeSingle()

  if (!chiusura || chiusura.restaurant_id !== profile.restaurant_id) {
    return NextResponse.json({ error: 'Chiusura non trovata o non autorizzata' }, { status: 404 })
  }
  if (chiusura.stato !== 'confermata') {
    return NextResponse.json({ error: 'Questa chiusura non è ancora confermata: puoi modificarla direttamente.' }, { status: 400 })
  }

  // Inserita con il client autenticato (non admin): la RLS di
  // cassa_chiusure_modifiche_insert verifica di nuovo richiesto_da e ristorante.
  const { data: modifica, error } = await supabase
    .from('cassa_chiusure_modifiche')
    .insert({ chiusura_id, payload, richiesto_da: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Risoluzione dei manager destinatari e inserimento notifiche: richiede
  // l'admin client, perché le policy RLS di profiles/notifications non
  // permettono a un cassiere di leggere altri profili né scrivere notifiche altrui.
  const admin = createAdminClient()
  const { data: restaurant } = await admin
    .from('restaurants')
    .select('is_demo')
    .eq('id', chiusura.restaurant_id)
    .single()
  const { data: managers } = await admin
    .from('profiles')
    .select('id, managed_restaurant_ids')
    .eq('role', 'manager')

  const targetManagers = ((managers ?? []) as { id: string; managed_restaurant_ids: string[] | null }[]).filter(m =>
    m.managed_restaurant_ids === null
      ? !restaurant?.is_demo
      : m.managed_restaurant_ids.includes(chiusura.restaurant_id)
  )

  if (targetManagers.length) {
    await admin.from('notifications').insert(
      targetManagers.map(m => ({
        user_id: m.id,
        title: 'Richiesta modifica chiusura cassa',
        message: `${profile.full_name} ha richiesto una modifica alla chiusura cassa del ${chiusura.data}`,
        link: '/cassa/approvazioni',
      }))
    )
  }

  revalidatePath('/cassa/approvazioni')
  return NextResponse.json({ modifica }, { status: 201 })
}
