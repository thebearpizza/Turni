'use server'

import { randomInt } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { getMe } from '@/lib/telegram/api'
import type { Role } from '@/types'

// Ruoli che NON possono mai collegare Telegram (vincolo di sicurezza,
// applicato anche qui in difesa rispetto al solo nascondere il bottone in UI).
const FORBIDDEN_ROLES: Role[] = ['dipendente', 'consulente_lavoro']

const PIN_TTL_MS = 5 * 60 * 1000

async function getCaller() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Non autenticato')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile) throw new Error('Profilo non trovato')

  if (FORBIDDEN_ROLES.includes(profile.role as Role)) {
    throw new Error('Non autorizzato a collegare Telegram')
  }

  return { supabase, user }
}

export interface TelegramLinkInfo {
  linked:            boolean
  username:          string | null
  deepLink:          string | null
}

export async function generateTelegramLink(): Promise<TelegramLinkInfo> {
  const { supabase, user } = await getCaller()

  const pin = randomInt(100000, 1000000).toString()
  const expiresAt = new Date(Date.now() + PIN_TTL_MS).toISOString()

  const { error } = await supabase.from('telegram_link_pins').insert({
    pin,
    user_id: user.id,
    expires_at: expiresAt,
  })
  if (error) throw new Error(error.message)

  const me = await getMe()
  const deepLink = `https://t.me/${me.username}?start=${pin}`

  return { linked: false, username: me.username ?? null, deepLink }
}

export async function getTelegramLinkStatus(): Promise<{ linked: boolean; telegramUsername: string | null }> {
  const { supabase, user } = await getCaller()

  const { data } = await supabase
    .from('telegram_links')
    .select('telegram_username')
    .eq('user_id', user.id)
    .maybeSingle()

  return { linked: !!data, telegramUsername: data?.telegram_username ?? null }
}

export async function unlinkTelegram(): Promise<void> {
  const { supabase, user } = await getCaller()

  const { error } = await supabase.from('telegram_links').delete().eq('user_id', user.id)
  if (error) throw new Error(error.message)
}
