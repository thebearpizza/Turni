import { createAdminClient } from '@/lib/supabase/admin'
import { editMessageText, sendMessage } from './api'
import type { TelegramProfile } from './auth'
import type { InlineKeyboardMarkup } from './types'

export interface Ctx {
  telegramId:        number
  chatId:            number
  profile:           TelegramProfile
  admin:             ReturnType<typeof createAdminClient>
  /** Testo completo del messaggio (comandi o input liberi). */
  text:              string
  /** Testo dopo il comando, es. "/nuovoturno mario" → "mario". */
  args:              string
  /** Dati del bottone premuto (callback_query.data), se presente. */
  callbackData?:     string
  /** message_id del messaggio con la tastiera, per editMessageText. */
  messageId?:        number
  callbackQueryId?:  string
}

export interface ReplyOptions {
  reply_markup?: InlineKeyboardMarkup
  parse_mode?:   'Markdown'
  /** Se true e il contesto deriva da un callback, modifica il messaggio esistente invece di inviarne uno nuovo. */
  edit?:         boolean
}

export async function reply(ctx: Ctx, text: string, options: ReplyOptions = {}) {
  const { edit, ...rest } = options
  if (edit && ctx.messageId) {
    return editMessageText(ctx.chatId, ctx.messageId, text, rest)
  }
  return sendMessage(ctx.chatId, text, rest)
}
