import type { createAdminClient } from '@/lib/supabase/admin'
import type { TelegramProfile } from './auth'
import { isManager, isDirettore } from './scope'
import type { InlineKeyboardMarkup } from './types'

type Admin = ReturnType<typeof createAdminClient>

// ── Selezione ristorante (solo manager, che opera a livello globale) ──

export async function listRestaurants(admin: Admin) {
  const { data } = await admin.from('restaurants').select('id, name').order('name')
  return data ?? []
}

export function buildRestaurantKeyboard(restaurants: { id: string; name: string }[], prefix: string): InlineKeyboardMarkup {
  const rows = restaurants.map(r => [{ text: r.name, callback_data: `${prefix}:${r.id}` }])
  rows.push([{ text: '❌ Annulla', callback_data: 'cancel' }])
  return { inline_keyboard: rows }
}

// ── Selezione dipendente, nello scope del chiamante ───────────────────
// manager        → tutti i dipendenti/capi servizio del ristorante scelto
// direttore      → tutti i dipendenti/capi servizio del proprio ristorante
// capo_servizio  → solo dipendenti del proprio ristorante + reparto

export async function listAssignableStaff(
  admin: Admin,
  profile: TelegramProfile,
  restaurantId?: string,
) {
  let query = admin
    .from('profiles')
    .select('id, full_name, department, restaurant_id')
    .in('role', ['dipendente', 'capo_servizio'])
    .order('full_name')

  if (isManager(profile)) {
    if (restaurantId) query = query.eq('restaurant_id', restaurantId)
  } else if (isDirettore(profile)) {
    query = query.eq('restaurant_id', profile.restaurant_id)
  } else {
    query = query.eq('restaurant_id', profile.restaurant_id).eq('department', profile.department)
  }

  const { data } = await query
  return data ?? []
}
