import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/cassa/fatture/sostituisci
// Body: { fattura_id, restaurant_id } + FatturaRisolta (vedi FatturaCapture.tsx),
// stessa forma di /salva.
//
// Sostituisce i dati di una fattura GIÀ salvata con quelli di una nuova
// lettura dello stesso documento (Fatture → Visualizza → Ri-scansiona,
// quando la prima lettura ha sbagliato fornitore/importi/articoli). A
// differenza di /salva non crea una riga nuova: aggiorna quella esistente
// e rimpiazza le sue righe articolo/IVA, così l'id della fattura — e le
// foto originali già collegate — restano gli stessi.
//
// La risoluzione degli articoli (match a catalogo esistente o creazione
// di uno nuovo per un articolo 'nuovo' mai confermato in review) è
// identica a /salva e resta qui in TypeScript; la sostituzione vera e
// propria (righe + pulizia orfani + update anagrafica) è demandata alla
// RPC sostituisci_fattura, che la esegue atomicamente.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await request.json()
  const {
    fattura_id, restaurant_id, fornitore, numero_documento, data, ha_articoli,
    categoria_spesa_diretta_id, verifiche_sospette, iva_dettaglio, articoli, foto_paths,
  } = body ?? {}

  if (!fattura_id || !restaurant_id || !fornitore?.id || !numero_documento?.trim() || !data || !Array.isArray(iva_dettaglio) || !Array.isArray(foto_paths) || foto_paths.length === 0) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }
  if (!ha_articoli && !categoria_spesa_diretta_id) {
    return NextResponse.json({ error: 'Categoria spesa diretta obbligatoria per una fattura senza articoli' }, { status: 400 })
  }

  const { data: restaurant } = await supabase.from('restaurants').select('owner_id').eq('id', restaurant_id).single()
  if (!restaurant) return NextResponse.json({ error: 'Locale non trovato o non autorizzato' }, { status: 403 })

  const risolti: Array<{ testo_estratto: string; quantita: number; prezzo_riga: number; catalogo_articolo_id: string }> = []

  if (ha_articoli && Array.isArray(articoli)) {
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
        // Stesso nome per lo stesso fornitore già a catalogo: non è un
        // errore, si riusa quello esistente (stesso motivo di /salva).
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
          return NextResponse.json({ error: 'Errore nella creazione del nuovo articolo: ' + insErr.message }, { status: 500 })
        }
      }
      if (!catalogoArticoloId) {
        return NextResponse.json({ error: `Errore nella creazione del nuovo articolo "${nome}": id mancante` }, { status: 500 })
      }

      await supabase.from('articoli_mappature_testo').upsert(
        { owner_id: restaurant.owner_id, fornitore_id: fornitore.id, testo_estratto: a.testo_estratto, catalogo_articolo_id: catalogoArticoloId },
        { onConflict: 'owner_id,fornitore_id,testo_estratto' }
      )

      risolti.push({ testo_estratto: a.testo_estratto, quantita: a.quantita, prezzo_riga: a.prezzo_riga, catalogo_articolo_id: catalogoArticoloId })
    }
  }

  const { error } = await supabase.rpc('sostituisci_fattura', {
    p_fattura_id: fattura_id,
    p_fornitore_id: fornitore.id,
    p_numero_documento: numero_documento.trim(),
    p_data: data,
    p_ha_articoli: ha_articoli,
    p_categoria_spesa_diretta_id: ha_articoli ? null : categoria_spesa_diretta_id,
    p_verifiche_sospette: verifiche_sospette ?? [],
    p_iva_dettaglio: iva_dettaglio,
    p_articoli: risolti,
    p_foto_paths: foto_paths,
  })

  if (error) {
    const doppione = error.code === '23505'
    return NextResponse.json(
      { error: doppione ? 'Esiste già una fattura con questo numero per questo fornitore.' : 'Errore nel salvataggio: ' + error.message },
      { status: doppione ? 409 : 500 }
    )
  }

  const { data: fatturaFinale } = await supabase.from('fatture').select('*').eq('id', fattura_id).single()
  return NextResponse.json({ fattura: fatturaFinale })
}
