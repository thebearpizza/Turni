import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { runAiAssistant } from '@/lib/telegram/ai'
import { getHubAiHistory, saveHubAiHistory } from '@/lib/hub/aiHistory'
import type { Ctx } from '@/lib/telegram/context'
import type { TelegramProfile } from '@/lib/telegram/auth'

// POST /api/hub/assistente
// Body: { testo: string }
//
// Ingresso web dell'assistente IA (Task 4, barra in fondo alla Home
// Manager) — stessa logica di scope e stessi strumenti già in uso dal
// bot Telegram (src/lib/telegram/ai.ts/runAiAssistant): questa route
// costruisce solo il Ctx da una sessione web autenticata invece che da
// un aggiornamento Telegram, e passa una cronologia su hub_ai_messages
// (chiave profilo) invece che telegram_ai_messages (chiave telegram_id).
// Nessuna regola/prompt/strumento duplicato: è lo stesso assistente.
//
// Riservata al manager: la barra vive solo nella Home Manager (Task 3).
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json({ error: 'Assistente AI non configurato.' }, { status: 503 })
  }

  const body = await request.json().catch(() => null)
  const testo = (body?.testo as string | undefined)?.trim()
  if (!testo) return NextResponse.json({ error: 'Domanda mancante' }, { status: 400 })
  if (testo.length > 2000) return NextResponse.json({ error: 'Domanda troppo lunga.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: profileRow } = await admin
    .from('profiles')
    .select('id, full_name, role, restaurant_id, department, is_direttore, restaurant:restaurants(id, name)')
    .eq('id', user.id)
    .single()

  if (!profileRow || profileRow.role !== 'manager') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const profile = profileRow as unknown as TelegramProfile
  const ctx: Ctx = {
    // Non usati da runAiAssistant per il percorso web (la cronologia
    // arriva da historyStore, non da ctx.telegramId/chatId) — restano
    // solo per rispettare la forma di Ctx, condivisa con i comandi
    // Telegram che invece li usano davvero.
    telegramId: 0,
    chatId: 0,
    profile,
    admin,
    text: testo,
    args: testo,
  }

  const risposta = await runAiAssistant(ctx, testo, {
    get: () => getHubAiHistory(admin, profile.id),
    save: (messages) => saveHubAiHistory(admin, profile.id, messages),
  })

  return NextResponse.json({ risposta })
}
