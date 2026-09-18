import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { estraiPagine, EstrazioneTimeoutError } from '@/lib/cassa/fattureExtraction'

const BUCKET = 'fatture_foto'

// La lettura AI di più pagine supera comodamente i 10s di default di
// molte piattaforme serverless. Il budget interno dell'estrazione
// (BUDGET_ESTRAZIONE_MS) sta sotto questo limite di proposito: vogliamo
// rispondere noi con un errore leggibile, non essere terminati a metà.
export const maxDuration = 60

// POST /api/cassa/fatture/estrai
// Body JSON: { restaurant_id: string, foto_paths: string[] }
//
// Fase 1 (di due — vedi /api/cassa/fatture/componi per la fase 2): legge
// SOLO le pagine, senza ancora raggrupparle in fatture né risolvere
// fornitore/catalogo — vedi il commento su estraiPagine in
// fattureExtraction.ts sul perché il raggruppamento è deliberatamente un
// passo a parte. Le foto le ha già caricate il client direttamente su
// Supabase Storage (vedi FatturaCapture.tsx) — qui arrivano solo i
// percorsi, non i byte: il corpo di una richiesta a una funzione
// serverless Vercel è limitato a 4.5 MB, e con più pagine ad alta
// risoluzione lo si supera facilmente passando i file nella richiesta
// stessa.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json({ error: "Estrazione automatica non disponibile: l'assistente AI non è configurato." }, { status: 503 })
  }

  const body = await request.json()
  const restaurantId = body?.restaurant_id as string | undefined
  const fotoPaths = body?.foto_paths as string[] | undefined
  // Presente solo per una ri-scansione: le foto sono quelle GIÀ della
  // fattura esistente, non "nuove" — su nessun errore qui sotto vanno
  // rimosse da storage, altrimenti la fattura esistente perderebbe per
  // sempre i suoi documenti originali.
  const excludeFatturaId = body?.exclude_fattura_id as string | undefined
  if (!restaurantId) return NextResponse.json({ error: 'Locale mancante' }, { status: 400 })
  if (!fotoPaths?.length) return NextResponse.json({ error: 'Nessuna foto ricevuta' }, { status: 400 })
  // Ogni percorso deve appartenere al locale dichiarato — altrimenti un
  // utente potrebbe passare percorsi di un altro locale (il download
  // sotto è comunque filtrato da RLS, ma qui evitiamo pure il tentativo).
  if (fotoPaths.some(p => !p.startsWith(`${restaurantId}/`))) {
    return NextResponse.json({ error: 'Percorso foto non valido' }, { status: 400 })
  }

  // Il locale deve esistere ed essere leggibile (RLS) dall'utente corrente.
  const { data: restaurant } = await supabase.from('restaurants').select('id').eq('id', restaurantId).single()
  if (!restaurant) return NextResponse.json({ error: 'Locale non trovato o non autorizzato' }, { status: 403 })

  const fotoBuffers: { buffer: ArrayBuffer; mediaType: string }[] = []
  for (const path of fotoPaths) {
    const { data: fileBlob, error: downloadErr } = await supabase.storage.from(BUCKET).download(path)
    if (downloadErr || !fileBlob) {
      return NextResponse.json({ error: 'Errore nel recupero delle foto caricate: ' + (downloadErr?.message ?? 'file non trovato') }, { status: 500 })
    }
    fotoBuffers.push({ buffer: await fileBlob.arrayBuffer(), mediaType: fileBlob.type || 'image/jpeg' })
  }

  try {
    const pagine = await estraiPagine(fotoBuffers)
    return NextResponse.json({ pagine })
  } catch (err) {
    if (!excludeFatturaId) await supabase.storage.from(BUCKET).remove(fotoPaths)
    console.error('Errore estrazione fattura:', err instanceof Error ? err.message : err)

    if (err instanceof EstrazioneTimeoutError) {
      return NextResponse.json(
        { error: 'La lettura ha superato il tempo massimo. Riprova con meno pagine per volta, oppure compila i dati a mano.' },
        { status: 504 }
      )
    }

    const rateLimited = /429|rate.?limit|quota|RESOURCE_EXHAUSTED|503|UNAVAILABLE|overloaded|high demand|try again later/i.test(err instanceof Error ? err.message : String(err))
    return NextResponse.json(
      { error: rateLimited ? 'Assistente AI sovraccarico in questo momento, riprova tra poco.' : 'Errore nella lettura della fattura, riprova o compila i dati a mano.' },
      { status: rateLimited ? 429 : 502 }
    )
  }
}
