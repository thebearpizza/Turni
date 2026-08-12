import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// L'unico ingresso automatico delle prenotazioni è il webhook (vedi
// /api/cassa/prenotazioni/webhook): la lettura periodica di una casella
// Gmail non è mai stata configurata in produzione ed è stata rimossa. La
// route resta solo perché il tasto "Aggiorna" della tab Prenotazioni la
// chiama per forzare il ricaricamento di agenda e coda — vedi sincronizza()
// in PrenotazioniClient.tsx, che tollera già questa risposta.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'manager') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  return NextResponse.json({ error: 'Casella mail non configurata' }, { status: 503 })
}
