import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { estraiReportChiusura, EstrazioneTimeoutError } from '@/lib/cassa/reportChiusuraExtraction'

const BUCKET = 'chiusura_report_foto'

// Stesso motivo di /api/cassa/fatture/estrai: la lettura AI supera
// comodamente i 10s di default di molte piattaforme serverless.
export const maxDuration = 60

// POST /api/cassa/chiusura/estrai-report
// Body: { restaurant_id, data, foto_paths }
//
// Legge il report di chiusura (foto/PDF) caricato all'inizio di Fase 1:
// restituisce SOLO i campi utili a precompilare il form (contanti, POS,
// bonifico, coperti, data letta, eventuale scostamento sul totale) — i
// prodotti venduti restano lato server e finiscono silenziosamente in
// Inventario (registra_consumo_chiusura), il cassiere non li vede mai.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json({ error: "Lettura automatica non disponibile: l'assistente AI non è configurato." }, { status: 503 })
  }

  const body = await request.json()
  const restaurantId = body?.restaurant_id as string | undefined
  const dataChiusura = body?.data as string | undefined
  const fotoPaths = body?.foto_paths as string[] | undefined
  if (!restaurantId) return NextResponse.json({ error: 'Locale mancante' }, { status: 400 })
  if (!dataChiusura) return NextResponse.json({ error: 'Data mancante' }, { status: 400 })
  if (!fotoPaths?.length) return NextResponse.json({ error: 'Nessun documento ricevuto' }, { status: 400 })
  // Ogni percorso deve appartenere al locale dichiarato — il download
  // sotto resta comunque filtrato da RLS, qui evitiamo pure il tentativo.
  if (fotoPaths.some(p => !p.startsWith(`${restaurantId}/`))) {
    return NextResponse.json({ error: 'Percorso file non valido' }, { status: 400 })
  }

  const { data: restaurant } = await supabase.from('restaurants').select('id').eq('id', restaurantId).single()
  if (!restaurant) return NextResponse.json({ error: 'Locale non trovato o non autorizzato' }, { status: 403 })

  const fotoBuffers: { buffer: ArrayBuffer; mediaType: string }[] = []
  for (const path of fotoPaths) {
    const { data: fileBlob, error: downloadErr } = await supabase.storage.from(BUCKET).download(path)
    if (downloadErr || !fileBlob) {
      return NextResponse.json({ error: 'Errore nel recupero del documento caricato: ' + (downloadErr?.message ?? 'file non trovato') }, { status: 500 })
    }
    fotoBuffers.push({ buffer: await fileBlob.arrayBuffer(), mediaType: fileBlob.type || 'image/jpeg' })
  }

  let estratto
  try {
    estratto = await estraiReportChiusura(fotoBuffers)
  } catch (err) {
    await supabase.storage.from(BUCKET).remove(fotoPaths)
    console.error('Errore estrazione report chiusura:', err instanceof Error ? err.message : err)
    if (err instanceof EstrazioneTimeoutError) {
      return NextResponse.json({ error: 'La lettura ha superato il tempo massimo. Riprova, oppure compila i dati a mano.' }, { status: 504 })
    }
    return NextResponse.json({ error: 'Errore nella lettura del documento. Riprova o compila i dati a mano.' }, { status: 500 })
  }

  // Il documento non serve più una volta letto: a differenza delle
  // foto fattura non è un documento fiscale da conservare (cassa_chiusure
  // non ha una colonna foto_paths).
  await supabase.storage.from(BUCKET).remove(fotoPaths)

  // Scarico silenzioso dall'Inventario — "al cassiere non interessa":
  // nessun prodotto torna al client, un eventuale errore resta solo nei
  // log server e non blocca mai la compilazione della chiusura.
  if (estratto.prodotti.length > 0) {
    const { error: scaricoErr } = await supabase.rpc('registra_consumo_chiusura', {
      p_restaurant_id: restaurantId,
      p_data: dataChiusura,
      p_prodotti: estratto.prodotti,
    })
    if (scaricoErr) console.error('Errore scarico inventario da chiusura:', scaricoErr.message)
  }

  // Vendite per categoria/prodotto per l'Analisi — anche queste in
  // silenzio, mai bloccanti: la chiusura potrebbe non esistere ancora
  // (report caricato prima di qualunque salvataggio di Fase 1), stessa
  // logica "trova o crea" di assicuraChiusura in SpeseBozzaCard.
  if (estratto.prodotti.length > 0) {
    let chiusuraId: string | null = null
    const { data: esistente } = await supabase
      .from('cassa_chiusure')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .eq('data', dataChiusura)
      .maybeSingle()
    if (esistente) {
      chiusuraId = esistente.id
    } else {
      const { data: creata, error: creaErr } = await supabase
        .from('cassa_chiusure')
        .insert({ restaurant_id: restaurantId, data: dataChiusura, stato: 'in_verifica', created_by: user.id })
        .select('id')
        .single()
      if (creaErr) {
        // Un'altra sessione l'ha creata nel frattempo (vincolo unique) — la riusa.
        if (creaErr.code === '23505') {
          const { data: concorrente } = await supabase
            .from('cassa_chiusure')
            .select('id')
            .eq('restaurant_id', restaurantId)
            .eq('data', dataChiusura)
            .maybeSingle()
          chiusuraId = concorrente?.id ?? null
        } else {
          console.error('Errore creazione chiusura per vendite prodotti:', creaErr.message)
        }
      } else {
        chiusuraId = creata.id
      }
    }

    if (chiusuraId) {
      const righe = estratto.prodotti
        .filter(p => p.nome)
        .map(p => ({
          chiusura_id: chiusuraId,
          nome_categoria: p.categoria,
          nome_prodotto: p.nome,
          quantita: p.quantita,
          importo: p.importo,
          valore_lordo: p.importo,
        }))
      const { error: venditeErr } = await supabase
        .from('cassa_vendite_prodotti')
        .upsert(righe, { onConflict: 'chiusura_id,nome_prodotto' })
      if (venditeErr) console.error('Errore salvataggio vendite prodotti:', venditeErr.message)
    }
  }

  const totaleCalcolato = estratto.entrate_contanti + estratto.entrate_pos + estratto.entrate_bonifico
  const scostamento = estratto.totale_dichiarato != null ? Math.abs(estratto.totale_dichiarato - totaleCalcolato) : 0

  return NextResponse.json({
    data: estratto.data,
    coperti: estratto.coperti,
    entrate_contanti: estratto.entrate_contanti,
    entrate_pos: estratto.entrate_pos,
    entrate_bonifico: estratto.entrate_bonifico,
    scostamento_totale: scostamento > 0.05 ? scostamento : null,
  })
}
