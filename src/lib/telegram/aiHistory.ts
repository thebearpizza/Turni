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
    .upsert({ telegram_id: telegramId, messages: stripProviderData(trimToLastTurns(messages, HISTORY_TURNS)), updated_at: new Date().toISOString() })
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

// Rimuove i metadati specifici del provider (es. `thoughtSignature` di Gemini)
// prima di salvare la cronologia: sono voluminosi e, se rigiocati in una
// richiesta successiva eventualmente gestita da un modello diverso (es. dopo
// un fallback per quota esaurita), possono causare errori di validazione.
function stripProviderData(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) => {
    const { providerOptions, ...rest } = m as ModelMessage & { providerOptions?: unknown }
    void providerOptions
    if (Array.isArray(rest.content)) {
      return {
        ...rest,
        content: rest.content.map((part) => {
          const { providerOptions, ...restPart } = part as typeof part & { providerOptions?: unknown }
          void providerOptions
          return restPart
        }),
      } as ModelMessage
    }
    return rest as ModelMessage
  })
}
