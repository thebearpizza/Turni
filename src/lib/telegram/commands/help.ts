import { sendMessage } from '../api'
import { linkAccountByPin, type TelegramProfile } from '../auth'
import { isManager, isDirettore, isCapoServizio } from '../scope'
import type { Ctx } from '../context'
import { reply } from '../context'

export function helpText(profile: TelegramProfile): string {
  const lines = [`👋 Ciao *${profile.full_name}*!`, '']

  lines.push('📅 *Turni*')
  lines.push('/turni — turni dei prossimi 7 giorni')
  lines.push('/nuovoturno — assegna un nuovo turno')
  lines.push('/riposo — assegna un riposo')
  lines.push('/eliminaturno — elimina un turno')
  lines.push('')

  lines.push('📋 *ODS*')
  lines.push('/ods — compiti di oggi')
  lines.push('/nuovoods — crea un nuovo compito')
  lines.push('/completaods — segna un compito come completato')

  if (isManager(profile) || isDirettore(profile)) {
    lines.push('')
    lines.push('🕐 *Presenze*')
    lines.push('/presenze — presenze di oggi')
    lines.push('/modificapresenza — modifica orari presenza')
    lines.push('/nuovapresenza — crea una presenza manuale')
  }

  lines.push('')
  lines.push('/help — mostra questo messaggio')
  lines.push('/annulla — annulla l\'operazione in corso')

  lines.push('')
  lines.push('🤖 *Assistente AI*')
  lines.push('Scrivimi anche in linguaggio naturale, senza comandi! Es. "Chi lavora venerdì in cucina?", "Segna un riposo a Mario per domani", "Crea un turno per Giulia lunedì 9-17".')

  let scopeLabel = ''
  if (isManager(profile)) scopeLabel = 'Manager — accesso globale a tutti i ristoranti'
  else if (isDirettore(profile)) scopeLabel = `Direttore — ${profile.restaurant?.name ?? 'ristorante'} (tutti i reparti)`
  else if (isCapoServizio(profile)) scopeLabel = `Capo Servizio — ${profile.restaurant?.name ?? 'ristorante'} (${profile.department ?? 'reparto'})`

  if (scopeLabel) lines.push('', `_${scopeLabel}_`)

  return lines.join('\n')
}

export async function cmdHelp(ctx: Ctx) {
  return reply(ctx, helpText(ctx.profile), { parse_mode: 'Markdown' })
}

// /start [pin] — gestito prima della risoluzione del profilo, perché un
// account non ancora collegato non ha un TelegramProfile.
export async function handleStart(
  telegramId: number,
  chatId: number,
  args: string,
  telegramUser: { username?: string; first_name?: string },
  existingProfile: TelegramProfile | null,
): Promise<void> {
  const pin = args.trim()

  if (!pin) {
    if (existingProfile) {
      await sendMessage(chatId, helpText(existingProfile), { parse_mode: 'Markdown' })
    } else {
      await sendMessage(
        chatId,
        '👋 Benvenuto nel bot Turni!\n\nPer collegare il tuo account, genera un codice dall\'app (sezione Dashboard → "Collega Telegram") e invialo qui.',
      )
    }
    return
  }

  try {
    const profile = await linkAccountByPin(telegramId, pin, telegramUser)
    await sendMessage(chatId, `✅ Account collegato con successo!\n\n${helpText(profile)}`, { parse_mode: 'Markdown' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore durante il collegamento.'
    await sendMessage(chatId, `❌ ${message}`)
  }
}
