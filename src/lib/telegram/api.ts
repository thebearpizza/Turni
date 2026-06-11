import type { InlineKeyboardMarkup, TgUser } from './types'

const API_BASE = 'https://api.telegram.org'

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN non configurato')
  return t
}

async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const json = await res.json()
  if (!json.ok) {
    throw new Error(`Telegram API error (${method}): ${json.description ?? 'unknown'}`)
  }
  return json.result as T
}

export interface SendMessageOptions {
  reply_markup?: InlineKeyboardMarkup
  parse_mode?: 'Markdown' | 'HTML'
}

export async function sendMessage(chatId: number, text: string, options?: SendMessageOptions) {
  return call<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    ...options,
  })
}

export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  options?: SendMessageOptions,
) {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...options,
  })
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string, showAlert?: boolean) {
  return call('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert ?? false,
  })
}

export async function setWebhook(url: string, secretToken: string) {
  return call('setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query'],
  })
}

let cachedMe: TgUser | null = null
export async function getMe(): Promise<TgUser> {
  if (cachedMe) return cachedMe
  cachedMe = await call<TgUser>('getMe')
  return cachedMe
}
