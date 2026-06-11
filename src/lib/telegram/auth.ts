import { createAdminClient } from '@/lib/supabase/admin'
import type { Department, Role } from '@/types'

export interface TelegramProfile {
  id:            string
  full_name:     string
  role:          Role
  restaurant_id: string | null
  department:    Department | null
  is_direttore:  boolean
  restaurant?:   { id: string; name: string } | null
}

// Ruoli che NON possono mai collegare Telegram (vincolo di sicurezza).
const FORBIDDEN_ROLES: Role[] = ['dipendente', 'consulente_lavoro']

export async function getTelegramUser(telegramId: number): Promise<TelegramProfile | null> {
  const admin = createAdminClient()

  const { data: link } = await admin
    .from('telegram_links')
    .select('user_id')
    .eq('telegram_id', telegramId)
    .maybeSingle()

  if (!link) return null

  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, role, restaurant_id, department, is_direttore, restaurant:restaurants(id, name)')
    .eq('id', link.user_id)
    .single()

  if (!profile) return null

  // Difesa in profondità: se il ruolo è cambiato dopo il collegamento,
  // tratta l'utente come non collegato.
  if (FORBIDDEN_ROLES.includes(profile.role as Role)) return null

  return profile as unknown as TelegramProfile
}

export async function linkAccountByPin(
  telegramId: number,
  pin: string,
  telegramUser: { username?: string; first_name?: string },
): Promise<TelegramProfile> {
  const admin = createAdminClient()

  const { data: pinRow } = await admin
    .from('telegram_link_pins')
    .select('user_id, expires_at')
    .eq('pin', pin)
    .maybeSingle()

  if (!pinRow || new Date(pinRow.expires_at) < new Date()) {
    throw new Error('Codice non valido o scaduto. Genera un nuovo codice dall\'app.')
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, role, restaurant_id, department, is_direttore, restaurant:restaurants(id, name)')
    .eq('id', pinRow.user_id)
    .single()

  if (!profile) throw new Error('Profilo non trovato')

  if (FORBIDDEN_ROLES.includes(profile.role as Role)) {
    throw new Error('Il tuo ruolo non è abilitato a collegare Telegram.')
  }

  // Rimuove eventuali collegamenti precedenti in conflitto (stesso utente
  // Supabase o stesso account Telegram già collegati altrove).
  await admin.from('telegram_links').delete().eq('user_id', profile.id)
  await admin.from('telegram_links').delete().eq('telegram_id', telegramId)

  await admin.from('telegram_links').insert({
    user_id:              profile.id,
    telegram_id:          telegramId,
    telegram_username:    telegramUser.username ?? null,
    telegram_first_name:  telegramUser.first_name ?? null,
    linked_at:            new Date().toISOString(),
  })

  await admin.from('telegram_link_pins').delete().eq('pin', pin)

  return profile as unknown as TelegramProfile
}
