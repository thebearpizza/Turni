import { answerCallbackQuery, sendMessage } from './api'
import { getTelegramUser } from './auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession, clearSession } from './session'
import { canManageTurni, canManageOds, canManagePresenze } from './scope'
import type { Ctx } from './context'
import { reply } from './context'
import type { TgUpdate } from './types'

import { cmdHelp, handleStart } from './commands/help'
import { cmdTurni, cmdNuovoTurno, cmdRiposo, cmdEliminaTurno, handleTurniCallback, handleTurniText } from './commands/turni'
import { cmdOds, cmdNuovoOds, cmdCompletaOds, handleOdsCallback, handleOdsText } from './commands/ods'
import { cmdPresenze, cmdModificaPresenza, cmdNuovaPresenza, handlePresenzeCallback, handlePresenzeText } from './commands/presenze'

export async function handleUpdate(update: TgUpdate): Promise<void> {
  const cb = update.callback_query
  const msg = update.message

  const telegramId = cb?.from.id ?? msg?.from?.id
  const chatId = cb?.message?.chat.id ?? msg?.chat.id
  if (!telegramId || !chatId) return

  if (cb) {
    // Risponde subito per chiudere lo spinner del bottone su Telegram.
    await answerCallbackQuery(cb.id).catch(() => {})
  }

  const text = msg?.text ?? ''
  const callbackData = cb?.data
  const messageId = cb?.message?.message_id

  // ── /start — gestito prima della risoluzione del profilo ─────────────
  if (text.startsWith('/start')) {
    const args = text.replace(/^\/start(@\w+)?\s*/, '')
    const existing = await getTelegramUser(telegramId)
    return handleStart(telegramId, chatId, args, {
      username: msg?.from?.username,
      first_name: msg?.from?.first_name,
    }, existing)
  }

  const profile = await getTelegramUser(telegramId)
  if (!profile) {
    await sendMessage(
      chatId,
      '🔒 Il tuo account Telegram non è collegato a Turni.\n\nGenera un codice dall\'app (Dashboard → "Collega Telegram") e invialo con /start <codice>.',
    )
    return
  }

  const ctx: Ctx = {
    telegramId,
    chatId,
    profile,
    admin: createAdminClient(),
    text,
    args: text.replace(/^\/\w+(@\w+)?\s*/, ''),
    callbackData,
    messageId,
    callbackQueryId: cb?.id,
  }

  // ── Annulla globale ────────────────────────────────────────────────
  if (callbackData === 'cancel' || text === '/annulla') {
    await clearSession(telegramId)
    await reply(ctx, '❌ Operazione annullata.', { edit: !!callbackData })
    return
  }

  // ── Sessione attiva (wizard multi-step) ───────────────────────────────
  const session = await getSession(telegramId)
  if (session) {
    const handled = callbackData
      ? await dispatchCallback(ctx, session.state, session.data)
      : await dispatchText(ctx, session.state, session.data)
    if (handled) return
    // Nessun handler ha gestito l'input: ignora silenziosamente i bottoni
    // obsoleti, o avvisa per il testo libero inatteso.
    if (!callbackData) {
      await reply(ctx, '⚠️ Non ho capito. Usa /annulla per interrompere l\'operazione in corso.')
    }
    return
  }

  // ── Comandi ────────────────────────────────────────────────────────
  if (callbackData) return // bottone orfano senza sessione: ignorato

  const match = text.match(/^\/(\w+)/)
  const command = match?.[1]?.toLowerCase()
  if (!command) return

  switch (command) {
    case 'help':
      return void cmdHelp(ctx)

    case 'turni':
      if (!canManageTurni(profile)) return void unauthorized(ctx)
      return void cmdTurni(ctx)
    case 'nuovoturno':
      if (!canManageTurni(profile)) return void unauthorized(ctx)
      return void cmdNuovoTurno(ctx)
    case 'riposo':
      if (!canManageTurni(profile)) return void unauthorized(ctx)
      return void cmdRiposo(ctx)
    case 'eliminaturno':
      if (!canManageTurni(profile)) return void unauthorized(ctx)
      return void cmdEliminaTurno(ctx)

    case 'ods':
      if (!canManageOds(profile)) return void unauthorized(ctx)
      return void cmdOds(ctx)
    case 'nuovoods':
      if (!canManageOds(profile)) return void unauthorized(ctx)
      return void cmdNuovoOds(ctx)
    case 'completaods':
      if (!canManageOds(profile)) return void unauthorized(ctx)
      return void cmdCompletaOds(ctx)

    case 'presenze':
      if (!canManagePresenze(profile)) return void unauthorized(ctx)
      return void cmdPresenze(ctx)
    case 'modificapresenza':
      if (!canManagePresenze(profile)) return void unauthorized(ctx)
      return void cmdModificaPresenza(ctx)
    case 'nuovapresenza':
      if (!canManagePresenze(profile)) return void unauthorized(ctx)
      return void cmdNuovaPresenza(ctx)

    default:
      return void reply(ctx, "❓ Comando non riconosciuto. Usa /help per l'elenco dei comandi.")
  }
}

async function unauthorized(ctx: Ctx) {
  return reply(ctx, '🚫 Non sei autorizzato a usare questo comando.')
}

async function dispatchCallback(ctx: Ctx, state: string, data: Record<string, unknown>): Promise<boolean> {
  if (state.startsWith('nt_') || state.startsWith('r_') || state.startsWith('dt_')) {
    return handleTurniCallback(ctx, state, data)
  }
  if (state.startsWith('no_') || state.startsWith('co_')) {
    return handleOdsCallback(ctx, state, data)
  }
  if (state.startsWith('mp_') || state.startsWith('np_')) {
    return handlePresenzeCallback(ctx, state, data)
  }
  return false
}

async function dispatchText(ctx: Ctx, state: string, data: Record<string, unknown>): Promise<boolean> {
  if (state.startsWith('nt_')) return handleTurniText(ctx, state, data)
  if (state.startsWith('no_')) return handleOdsText(ctx, state, data)
  if (state.startsWith('mp_') || state.startsWith('np_')) return handlePresenzeText(ctx, state, data)
  return false
}
