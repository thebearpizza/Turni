import type { createAdminClient } from '@/lib/supabase/admin'
import type { ModelMessage } from 'ai'

// ── Memoria conversazionale dell'assistente AI ───────────────────────
// Mantiene la cronologia completa (testo + tool-call/tool-result) degli
// ultimi scambi per telegram_id, così l'assistente può ragionare in
// relazione ai messaggi appena ricevuti e riutilizzare ID restituiti
// dagli strumenti in turni precedenti (es. ID dei turni da eliminare
// dopo una conferma dell'utente).

type AdminClient = ReturnType<typeof createAdminClient>

const HISTORY_TURNS = 4 // numero di scambi utente/assistente da mantenere

export async function getAiHistory(admin: AdminClient, telegramId: number): Promise<ModelMessage[]> {
  const { data } = await admin
    .from('telegram_ai_messages')
    .select('messages')
    .eq('telegram_id', telegramId)
    .maybeSingle()

  return (data?.messages as ModelMessage[] | null) ?? []
}

export async function saveAiHistory(admin: AdminClient, telegramId: number, messages: ModelMessage[]): Promise<void> {
  await admin
    .from('telegram_ai_messages')
    .upsert({ telegram_id: telegramId, messages: trimToLastTurns(messages, HISTORY_TURNS), updated_at: new Date().toISOString() })
}

export async function clearAiHistory(admin: AdminClient, telegramId: number): Promise<void> {
  await admin.from('telegram_ai_messages').delete().eq('telegram_id', telegramId)
}

// Mantiene solo gli ultimi `maxTurns` scambi, tagliando a partire dal
// messaggio "user" che apre il primo scambio da conservare (così non si
// rompono coppie tool-call/tool-result a metà).
function trimToLastTurns(messages: ModelMessage[], maxTurns: number): ModelMessage[] {
  const turnStarts: number[] = []
  messages.forEach((m, i) => { if (m.role === 'user') turnStarts.push(i) })
  if (turnStarts.length <= maxTurns) return messages
  return messages.slice(turnStarts[turnStarts.length - maxTurns])
}
