import type { createAdminClient } from '@/lib/supabase/admin'
import type { ModelMessage } from 'ai'
import { trimToLastTurns, stripProviderData } from '@/lib/telegram/aiHistory'

// Cronologia dell'assistente per la barra IA della Home web (Task 4) —
// stessa forma di src/lib/telegram/aiHistory.ts, chiave sul profilo
// (uuid) invece che sul telegram_id: vedi la migration
// 20260915d_hub_ai_messages per il motivo di una tabella separata.

type AdminClient = ReturnType<typeof createAdminClient>

const HISTORY_TURNS = 4

export async function getHubAiHistory(admin: AdminClient, userId: string): Promise<ModelMessage[]> {
  const { data } = await admin
    .from('hub_ai_messages')
    .select('messages')
    .eq('user_id', userId)
    .maybeSingle()

  return (data?.messages as ModelMessage[] | null) ?? []
}

export async function saveHubAiHistory(admin: AdminClient, userId: string, messages: ModelMessage[]): Promise<void> {
  await admin
    .from('hub_ai_messages')
    .upsert({ user_id: userId, messages: stripProviderData(trimToLastTurns(messages, HISTORY_TURNS)), updated_at: new Date().toISOString() })
}

export async function clearHubAiHistory(admin: AdminClient, userId: string): Promise<void> {
  await admin.from('hub_ai_messages').delete().eq('user_id', userId)
}
