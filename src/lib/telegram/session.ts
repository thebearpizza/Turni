import { createAdminClient } from '@/lib/supabase/admin'

// ── Telegram conversational sessions (wizard state) ──────────────────
// Vercel functions are stateless: multi-step commands persist their
// progress here, keyed by telegram_id, between webhook invocations.

export interface TelegramSession<T = Record<string, unknown>> {
  state: string
  data: T
}

export async function getSession<T = Record<string, unknown>>(telegramId: number): Promise<TelegramSession<T> | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('telegram_sessions')
    .select('state, data')
    .eq('telegram_id', telegramId)
    .maybeSingle()

  if (!data) return null
  return { state: data.state, data: data.data as T }
}

export async function setSession(telegramId: number, state: string, data: Record<string, unknown> = {}): Promise<void> {
  const admin = createAdminClient()
  await admin
    .from('telegram_sessions')
    .upsert({ telegram_id: telegramId, state, data, updated_at: new Date().toISOString() })
}

export async function clearSession(telegramId: number): Promise<void> {
  const admin = createAdminClient()
  await admin.from('telegram_sessions').delete().eq('telegram_id', telegramId)
}
