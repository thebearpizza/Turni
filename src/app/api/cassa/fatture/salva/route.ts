import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/cassa/fatture/salva
// Body: FatturaRisolta (vedi FatturaCapture.tsx) + restaurant_id.
//
// Salvataggio definitivo (Task 3) dei dati già rivisti/confermati
// dall'utente in FatturaCapture (Task 1) con le verifiche di Task 2 già
// applicate. totale_netto/iva/lordo non vengono scritti qui: li
// ricalcola il trigger su fatture_iva_dettaglio/fatture_articoli (Task 0)
// una volta inserite le righe figlie, così restano sempre coerenti con
// quelle.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await request.json()
  const {
    restaurant_id, fornitore, numero_documento, data, ha_articoli,
    categoria_spesa_diretta_id, foto_paths, verifiche_sospette, iva_dettaglio, articoli,
  } = body ?? {}

  if (!restaurant_id || !fornitore?.id || !numero_documento?.trim() || !data || !Array.isArray(iva_dettaglio)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }
  if (!ha_articoli && !categoria_spesa_diretta_id) {
    return NextResponse.json({ error: 'Categoria spesa diretta obbligatoria per una fattura senza articoli' }, { status: 400 })
  }

  const { data: fattura, error: fatturaErr } = await supabase
    .from('fatture')
    .insert({
      restaurant_id,
      fornitore_id: fornitore.id,
      numero_documento: numero_documento.trim(),
      data,
      ha_articoli,
      categoria_spesa_diretta_id: ha_articoli ? null : categoria_spesa_diretta_id,
      foto_paths: foto_paths ?? [],
      verifiche_sospette: verifiche_sospette ?? [],
      created_by: user.id,
    })
    .select('id')
    .single()

  if (fatturaErr || !fattura) {
    // Stesso fornitore+numero_documento già a sistema: la UNIQUE della
    // tabella fa da ultima rete di sicurezza anche se il controllo in
    // /estrai (Task 2) fosse stato aggirato da una richiesta diretta.
    const doppione = fatturaErr?.code === '23505'
    return NextResponse.json(
      { error: doppione ? 'Fattura già presente a sistema (stesso fornitore e numero documento).' : 'Errore nel salvataggio: ' + (fatturaErr?.message ?? 'sconosciuto') },
      { status: doppione ? 409 : 500 }
    )
  }

  const { error: ivaErr } = await supabase.from('fatture_iva_dettaglio').insert(
    iva_dettaglio.map((r: { aliquota: number; imponibile: number; iva: number }) => ({
      fattura_id: fattura.id,
      aliquota: r.aliquota,
      imponibile: r.imponibile,
      iva: r.iva,
    }))
  )
  if (ivaErr) {
    await supabase.from('fatture').delete().eq('id', fattura.id)
    return NextResponse.json({ error: 'Errore nel salvataggio del dettaglio IVA: ' + ivaErr.message }, { status: 500 })
  }

  if (ha_articoli && Array.isArray(articoli) && articoli.length > 0) {
    const { error: artErr } = await supabase.from('fatture_articoli').insert(
      articoli.map((a: { testo_estratto: string; quantita: number; prezzo_riga: number; catalogo_articolo_id: string }) => ({
        fattura_id: fattura.id,
        catalogo_articolo_id: a.catalogo_articolo_id,
        testo_estratto: a.testo_estratto,
        quantita: a.quantita,
        prezzo_unitario: a.quantita !== 0 ? a.prezzo_riga / a.quantita : a.prezzo_riga,
        prezzo_riga: a.prezzo_riga,
      }))
    )
    if (artErr) {
      await supabase.from('fatture').delete().eq('id', fattura.id)
      return NextResponse.json({ error: 'Errore nel salvataggio degli articoli: ' + artErr.message }, { status: 500 })
    }
  }

  const { data: fatturaFinale } = await supabase.from('fatture').select('*').eq('id', fattura.id).single()
  return NextResponse.json({ fattura: fatturaFinale })
}
