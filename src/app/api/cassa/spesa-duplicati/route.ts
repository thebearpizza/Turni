import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'

// POST /api/cassa/spesa-duplicati
// Body: { restaurant_id: string, testo: string }
// Verifica se il testo di una nuova voce di spesa corrisponde
// semanticamente a una voce già esistente (stesso owner_id), per evitare
// duplicati con formulazioni diverse (es. "benzina furgone" / "carburante
// mezzo aziendale"). Il pre-filtro pg_trgm (cassa_spese_nomi) restringe i
// candidati testualmente più vicini prima di interpellare l'AI.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

const ResultSchema = z.object({
  corrispondenza: z.string().nullable().describe(
    "Il testo ESATTO, tra i candidati forniti, che indica la stessa voce di spesa del nuovo testo. null se nessun candidato corrisponde."
  ),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { restaurant_id, testo } = await request.json()
  if (!restaurant_id || !testo?.trim()) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  const { data: candidati, error: candErr } = await supabase
    .rpc('cassa_spese_nomi', { p_restaurant_id: restaurant_id, p_query: testo.trim(), p_limit: 8 })

  if (candErr) return NextResponse.json({ error: candErr.message }, { status: 500 })

  const nomi = ((candidati ?? []) as { nome_spesa: string }[])
    // Un candidato identico (case-insensitive) non è un "possibile duplicato": è la stessa voce.
    .filter(c => c.nome_spesa.toLowerCase() !== testo.trim().toLowerCase())
    .map(c => c.nome_spesa)

  if (!nomi.length || !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json({ match: null })
  }

  const started = Date.now()
  try {
    const { object } = await generateObject({
      model: google(GEMINI_MODEL),
      schema: ResultSchema,
      prompt: `Sei un assistente che individua voci di spesa duplicate nel registro di cassa di un ristorante italiano.

Nuovo testo inserito dall'utente: "${testo.trim()}"

Voci di spesa già esistenti (candidati):
${nomi.map(n => `- "${n}"`).join('\n')}

Se il nuovo testo indica chiaramente la STESSA voce di spesa di uno dei candidati (anche con parole diverse, sinonimi o abbreviazioni — es. "benzina furgone" e "carburante mezzo aziendale" sono la stessa cosa), restituisci il testo ESATTO del candidato corrispondente. Se nessun candidato rappresenta la stessa voce di spesa, restituisci null. Non inventare candidati che non sono nell'elenco.`,
    })

    const elapsedMs = Date.now() - started
    console.log(`[cassa] check duplicati spesa: ${elapsedMs}ms, candidati=${nomi.length}`)

    const match = object.corrispondenza && nomi.includes(object.corrispondenza) ? object.corrispondenza : null
    const categoriaId = match
      ? ((candidati ?? []) as { nome_spesa: string; categoria_id: string | null }[])
          .find(c => c.nome_spesa === match)?.categoria_id ?? null
      : null

    return NextResponse.json({ match, categoria_id: categoriaId, elapsedMs })
  } catch (err) {
    console.error('Errore controllo duplicati spesa cassa:', err instanceof Error ? err.message : err)
    // In caso di errore/timeout dell'AI non si blocca il salvataggio: nessun match rilevato.
    return NextResponse.json({ match: null })
  }
}
