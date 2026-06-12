import type { createAdminClient } from '@/lib/supabase/admin'
import type { ModelMessage } from 'ai'

// ── Memoria conversazionale dell'assistente AI ───────────────────────
// Mantiene gli ultimi scambi (utente/assistente) per telegram_id, così
// l'assistente può ragionare in relazione ai messaggi appena ricevuti
// (es. "elimina i suoi turni" dopo aver identificato un dipendente).

type AdminClient = ReturnType<typeof createAdminClient>

const HISTORY_LIMIT = 12 // messaggi (6 scambi utente/assistente)

export async function getAiHistory(admin: AdminClient, telegramId: number): Promise<ModelMessage[]> {
  const { data } = await admin
    .from('telegram_ai_messages')
    .select('role, content')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  return ((data ?? []) as { role: 'user' | 'assistant'; content: string }[])
    .reverse()
    .map(m => ({ role: m.role, content: m.content }))
}

export async function appendAiHistory(admin: AdminClient, telegramId: number, userText: string, assistantText: string): Promise<void> {
  await admin.from('telegram_ai_messages').insert([
    { telegram_id: telegramId, role: 'user', content: userText },
    { telegram_id: telegramId, role: 'assistant', content: assistantText },
  ])

  // Mantiene solo gli scambi più recenti, per non far crescere la tabella all'infinito.
  const { data: old } = await admin
    .from('telegram_ai_messages')
    .select('id')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .range(HISTORY_LIMIT, HISTORY_LIMIT + 50)

  const idsToDelete = (old ?? []).map((r: { id: number }) => r.id)
  if (idsToDelete.length) {
    await admin.from('telegram_ai_messages').delete().in('id', idsToDelete)
  }
}

export async function clearAiHistory(admin: AdminClient, telegramId: number): Promise<void> {
  await admin.from('telegram_ai_messages').delete().eq('telegram_id', telegramId)
}
