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

  // Serve owner_id per creare eventuali nuovi articoli di catalogo (sotto).
  const { data: restaurant } = await supabase.from('restaurants').select('owner_id').eq('id', restaurant_id).single()
  if (!restaurant) return NextResponse.json({ error: 'Locale non trovato o non autorizzato' }, { status: 403 })

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
    // Un articolo "nuovo" può arrivare qui senza essere mai stato
    // confermato esplicitamente in review (non è più obbligatorio): in
    // quel caso porta nuovo_articolo invece di catalogo_articolo_id, e la
    // riga di catalogo si crea ORA — non prima, in review, altrimenti
    // annullare la fattura lascerebbe un articolo orfano a catalogo.
    const risolti: Array<{ testo_estratto: string; quantita: number; prezzo_riga: number; catalogo_articolo_id: string }> = []
    for (const a of articoli as Array<{
      testo_estratto: string
      quantita: number
      prezzo_riga: number
      catalogo_articolo_id?: string
      nuovo_articolo?: { nome_articolo: string; tipologia: string; unita_misura?: string }
    }>) {
      if (a.catalogo_articolo_id) {
        risolti.push({ testo_estratto: a.testo_estratto, quantita: a.quantita, prezzo_riga: a.prezzo_riga, catalogo_articolo_id: a.catalogo_articolo_id })
        continue
      }

      const nome = a.nuovo_articolo?.nome_articolo?.trim()
      if (!nome || !a.nuovo_articolo?.tipologia) {
        await supabase.from('fatture').delete().eq('id', fattura.id)
        return NextResponse.json({ error: `Articolo "${a.testo_estratto}" senza dati sufficienti per essere salvato` }, { status: 400 })
      }

      const { data: nuovoArt, error: insErr } = await supabase
        .from('catalogo_articoli')
        .insert({
          owner_id: restaurant.owner_id,
          fornitore_id: fornitore.id,
          nome_articolo: nome,
          tipologia: a.nuovo_articolo.tipologia,
          unita_misura: a.nuovo_articolo.unita_misura || null,
        })
        .select('id')
        .single()

      let catalogoArticoloId = nuovoArt?.id as string | undefined
      if (insErr) {
        // Stesso nome per lo stesso fornitore già a catalogo (es. due
        // articoli "nuovi" nella stessa fattura col medesimo nome
        // suggerito): non è un errore, si riusa quello esistente.
        if (insErr.code === '23505') {
          const { data: esistente } = await supabase
            .from('catalogo_articoli')
            .select('id')
            .eq('owner_id', restaurant.owner_id)
            .eq('fornitore_id', fornitore.id)
            .eq('nome_articolo', nome)
            .single()
          catalogoArticoloId = esistente?.id
        }
        if (!catalogoArticoloId) {
          await supabase.from('fatture').delete().eq('id', fattura.id)
          return NextResponse.json({ error: 'Errore nella creazione del nuovo articolo: ' + insErr.message }, { status: 500 })
        }
      }
      if (!catalogoArticoloId) {
        await supabase.from('fatture').delete().eq('id', fattura.id)
        return NextResponse.json({ error: `Errore nella creazione del nuovo articolo "${nome}": id mancante` }, { status: 500 })
      }

      await supabase.from('articoli_mappature_testo').upsert(
        { owner_id: restaurant.owner_id, fornitore_id: fornitore.id, testo_estratto: a.testo_estratto, catalogo_articolo_id: catalogoArticoloId },
        { onConflict: 'owner_id,fornitore_id,testo_estratto' }
      )

      risolti.push({ testo_estratto: a.testo_estratto, quantita: a.quantita, prezzo_riga: a.prezzo_riga, catalogo_articolo_id: catalogoArticoloId })
    }

    const { error: artErr } = await supabase.from('fatture_articoli').insert(
      risolti.map(a => ({
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
