import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const TIPOLOGIE = ['food', 'beverage', 'detergenza', 'altro_no_food'] as const

// POST /api/cassa/fatture/conferma-articolo
// Body: { restaurant_id, fornitore_id, testo_estratto, decisione: 'stesso'|'nuovo',
//         catalogo_articolo_id? (se 'stesso'), nuovo_articolo? (se 'nuovo') }
//
// Salva la decisione dell'utente su un match ambiguo/nuovo in
// articoli_mappature_testo, così la stessa dicitura non verrà più chiesta
// per questo fornitore. Se 'nuovo', crea prima la riga in catalogo_articoli.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await request.json()
  const { restaurant_id, fornitore_id, testo_estratto, decisione, catalogo_articolo_id, nuovo_articolo } = body ?? {}

  if (!restaurant_id || !fornitore_id || !testo_estratto?.trim() || !['stesso', 'nuovo'].includes(decisione)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  const { data: restaurant } = await supabase.from('restaurants').select('owner_id').eq('id', restaurant_id).single()
  if (!restaurant) return NextResponse.json({ error: 'Locale non trovato o non autorizzato' }, { status: 403 })

  let resolvedArticoloId: string

  if (decisione === 'stesso') {
    if (!catalogo_articolo_id) return NextResponse.json({ error: 'catalogo_articolo_id mancante' }, { status: 400 })
    resolvedArticoloId = catalogo_articolo_id
  } else {
    const nome = nuovo_articolo?.nome_articolo?.trim()
    const tipologia = nuovo_articolo?.tipologia
    if (!nome || !TIPOLOGIE.includes(tipologia)) {
      return NextResponse.json({ error: 'nome_articolo e tipologia sono obbligatori per un nuovo articolo' }, { status: 400 })
    }

    const { data: nuovoArt, error: insErr } = await supabase
      .from('catalogo_articoli')
      .insert({
        owner_id: restaurant.owner_id,
        fornitore_id,
        nome_articolo: nome,
        tipologia,
        unita_misura: nuovo_articolo.unita_misura || null,
        fattore_conversione: nuovo_articolo.fattore_conversione || 1,
      })
      .select('id')
      .single()

    if (insErr || !nuovoArt) {
      return NextResponse.json({ error: 'Errore nella creazione del nuovo articolo: ' + (insErr?.message ?? 'sconosciuto') }, { status: 500 })
    }
    resolvedArticoloId = nuovoArt.id
  }

  const { error: mapErr } = await supabase.from('articoli_mappature_testo').upsert(
    {
      owner_id: restaurant.owner_id,
      fornitore_id,
      testo_estratto: testo_estratto.trim(),
      catalogo_articolo_id: resolvedArticoloId,
    },
    { onConflict: 'owner_id,fornitore_id,testo_estratto' }
  )
  if (mapErr) return NextResponse.json({ error: 'Errore nel salvataggio della mappatura: ' + mapErr.message }, { status: 500 })

  return NextResponse.json({ catalogo_articolo_id: resolvedArticoloId })
}
