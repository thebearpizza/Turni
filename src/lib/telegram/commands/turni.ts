import type { Ctx } from '../context'
import { reply } from '../context'
import { setSession, clearSession } from '../session'
import { toScopeProfile, scopeTurnsQuery, isManager, assigneeInScope } from '../scope'
import {
  formatDateLabel, todayStr, dateAfter, isValidTime, normalizeTime,
  buildDateKeyboard, buildEmployeeKeyboard, buildYesNoKeyboard, buildCancelKeyboard, escapeMd,
} from '../format'
import { listRestaurants, buildRestaurantKeyboard, listAssignableStaff } from '../wizard'

// ── /turni — elenco turni nel proprio scope per i prossimi 7 giorni ───
export async function cmdTurni(ctx: Ctx) {
  const { admin, profile } = ctx
  const start = todayStr()
  const end = dateAfter(6)

  let query = admin
    .from('turns')
    .select('date, start_time, end_time, is_extraordinary, is_rest_day, department, profile:profiles!user_id(full_name), restaurant:restaurants(name)')
    .gte('date', start)
    .lte('date', end)
    .order('date')
    .order('start_time')
    .limit(40)

  query = scopeTurnsQuery(query, toScopeProfile(profile), profile.id)

  const { data, error } = await query
  if (error) return reply(ctx, `Errore: ${error.message}`)

  type Row = {
    date: string; start_time: string; end_time: string
    is_extraordinary: boolean; is_rest_day: boolean; department: string | null
    profile: { full_name: string } | null
    restaurant: { name: string } | null
  }
  const rows = (data ?? []) as unknown as Row[]

  if (!rows.length) {
    return reply(ctx, '📅 Nessun turno programmato nei prossimi 7 giorni.')
  }

  let lastDate = ''
  const lines: string[] = ['📅 *Turni — prossimi 7 giorni*\n']
  for (const t of rows) {
    if (t.date !== lastDate) {
      lines.push(`\n*${escapeMd(formatDateLabel(t.date))}*`)
      lastDate = t.date
    }
    const name = escapeMd(t.profile?.full_name ?? '—')
    const restPart = isManager(profile) && t.restaurant?.name ? ` · ${escapeMd(t.restaurant.name)}` : ''
    if (t.is_rest_day) {
      lines.push(`  🛌 ${name} — Riposo${restPart}`)
    } else {
      const badge = t.is_extraordinary ? ' ⚡' : ''
      const dept = t.department ? ` (${escapeMd(t.department)})` : ''
      lines.push(`  🕐 ${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)} ${name}${dept}${badge}${restPart}`)
    }
  }

  return reply(ctx, lines.join('\n'), { parse_mode: 'Markdown' })
}

// ── /nuovoturno — wizard creazione turno ──────────────────────────────
export async function cmdNuovoTurno(ctx: Ctx) {
  if (isManager(ctx.profile)) {
    const restaurants = await listRestaurants(ctx.admin)
    if (!restaurants.length) return reply(ctx, 'Nessun ristorante trovato.')
    await setSession(ctx.telegramId, 'nt_restaurant', {})
    return reply(ctx, '🏢 Seleziona il ristorante:', { reply_markup: buildRestaurantKeyboard(restaurants, 'nt_rest') })
  }
  await startEmployeeStep(ctx, 'nt', {})
}

// ── /riposo — wizard inserimento riposo ────────────────────────────────
export async function cmdRiposo(ctx: Ctx) {
  if (isManager(ctx.profile)) {
    const restaurants = await listRestaurants(ctx.admin)
    if (!restaurants.length) return reply(ctx, 'Nessun ristorante trovato.')
    await setSession(ctx.telegramId, 'r_restaurant', {})
    return reply(ctx, '🏢 Seleziona il ristorante:', { reply_markup: buildRestaurantKeyboard(restaurants, 'r_rest') })
  }
  await startEmployeeStep(ctx, 'r', {})
}

async function startEmployeeStep(ctx: Ctx, prefix: string, data: Record<string, unknown>) {
  const staff = await listAssignableStaff(ctx.admin, ctx.profile, data.restaurant_id as string | undefined)
  if (!staff.length) return reply(ctx, 'Nessun dipendente trovato nel tuo reparto/ristorante.')
  await setSession(ctx.telegramId, `${prefix}_employee`, data)
  return reply(ctx, '👤 Seleziona il dipendente:', { reply_markup: buildEmployeeKeyboard(staff, `${prefix}_emp`) })
}

// ── /eliminaturno — wizard cancellazione turno ─────────────────────────
export async function cmdEliminaTurno(ctx: Ctx) {
  await setSession(ctx.telegramId, 'dt_date', {})
  return reply(ctx, '🗑️ Elimina turno\n\nSeleziona la data:', { reply_markup: buildDateKeyboard('dt_date') })
}

// ── Dispatcher per i bottoni (callback_query) ──────────────────────────
export async function handleTurniCallback(ctx: Ctx, state: string, data: Record<string, unknown>): Promise<boolean> {
  const cb = ctx.callbackData ?? ''

  // ── Nuovo turno ──
  if (state === 'nt_restaurant' && cb.startsWith('nt_rest:')) {
    const restaurantId = cb.split(':')[1]
    await startEmployeeStep(ctx, 'nt', { restaurant_id: restaurantId })
    return true
  }
  if (state === 'nt_employee' && cb.startsWith('nt_emp:')) {
    const employeeId = cb.split(':')[1]
    const staff = await listAssignableStaff(ctx.admin, ctx.profile, data.restaurant_id as string | undefined)
    const employee = staff.find(s => s.id === employeeId)
    if (!employee) return reply(ctx, 'Dipendente non trovato.').then(() => true)
    if (!assigneeInScope(ctx.profile, employee)) {
      await clearSession(ctx.telegramId)
      await reply(ctx, '🚫 Non autorizzato per questo dipendente.')
      return true
    }
    await setSession(ctx.telegramId, 'nt_date', {
      ...data, employee_id: employee.id, employee_name: employee.full_name,
      department: employee.department, restaurant_id: employee.restaurant_id,
    })
    await reply(ctx, `👤 ${escapeMd(employee.full_name)}\n\n📅 Seleziona la data:`, {
      parse_mode: 'Markdown', reply_markup: buildDateKeyboard('nt_date'),
    })
    return true
  }
  if (state === 'nt_date' && cb.startsWith('nt_date:')) {
    const date = cb.split(':')[1]
    await setSession(ctx.telegramId, 'nt_start', { ...data, date })
    await reply(ctx, `📅 ${escapeMd(formatDateLabel(date))}\n\n🕐 Inserisci l'orario di inizio (es. 09:00):`, {
      parse_mode: 'Markdown', reply_markup: buildCancelKeyboard(),
    })
    return true
  }
  if (state === 'nt_extra' && cb.startsWith('nt_extra:')) {
    const isExtra = cb.split(':')[1] === 'yes'
    const next = { ...data, is_extraordinary: isExtra }
    await setSession(ctx.telegramId, 'nt_confirm', next)
    await reply(ctx, summaryNuovoTurno(next), { parse_mode: 'Markdown', reply_markup: buildYesNoKeyboard('nt_confirm') })
    return true
  }
  if (state === 'nt_confirm' && cb.startsWith('nt_confirm:')) {
    const ok = cb.split(':')[1] === 'yes'
    await clearSession(ctx.telegramId)
    if (!ok) {
      await reply(ctx, '❌ Operazione annullata.')
      return true
    }
    const { error } = await ctx.admin.from('turns').insert({
      user_id:          data.employee_id,
      restaurant_id:    data.restaurant_id,
      department:       data.department,
      date:             data.date,
      start_time:       normalizeTime(data.start_time as string),
      end_time:         normalizeTime(data.end_time as string),
      is_extraordinary: !!data.is_extraordinary,
      is_rest_day:      false,
      created_by:       ctx.profile.id,
    })
    if (error) {
      await reply(ctx, `Errore: ${error.message}`)
    } else {
      await reply(ctx, `✅ Turno creato per *${escapeMd(data.employee_name as string)}*.`, { parse_mode: 'Markdown' })
    }
    return true
  }

  // ── Riposo ──
  if (state === 'r_restaurant' && cb.startsWith('r_rest:')) {
    const restaurantId = cb.split(':')[1]
    await startEmployeeStep(ctx, 'r', { restaurant_id: restaurantId })
    return true
  }
  if (state === 'r_employee' && cb.startsWith('r_emp:')) {
    const employeeId = cb.split(':')[1]
    const staff = await listAssignableStaff(ctx.admin, ctx.profile, data.restaurant_id as string | undefined)
    const employee = staff.find(s => s.id === employeeId)
    if (!employee) return reply(ctx, 'Dipendente non trovato.').then(() => true)
    if (!assigneeInScope(ctx.profile, employee)) {
      await clearSession(ctx.telegramId)
      await reply(ctx, '🚫 Non autorizzato per questo dipendente.')
      return true
    }
    await setSession(ctx.telegramId, 'r_date', {
      ...data, employee_id: employee.id, employee_name: employee.full_name,
      department: employee.department, restaurant_id: employee.restaurant_id,
    })
    await reply(ctx, `👤 ${escapeMd(employee.full_name)}\n\n📅 Seleziona la data del riposo:`, {
      parse_mode: 'Markdown', reply_markup: buildDateKeyboard('r_date'),
    })
    return true
  }
  if (state === 'r_date' && cb.startsWith('r_date:')) {
    const date = cb.split(':')[1]
    const next = { ...data, date }
    await setSession(ctx.telegramId, 'r_confirm', next)
    await reply(
      ctx,
      `🛌 Confermi il riposo per *${escapeMd(data.employee_name as string)}* il *${escapeMd(formatDateLabel(date))}*?`,
      { parse_mode: 'Markdown', reply_markup: buildYesNoKeyboard('r_confirm') },
    )
    return true
  }
  if (state === 'r_confirm' && cb.startsWith('r_confirm:')) {
    const ok = cb.split(':')[1] === 'yes'
    await clearSession(ctx.telegramId)
    if (!ok) {
      await reply(ctx, '❌ Operazione annullata.')
      return true
    }
    await createRiposo(ctx, data)
    return true
  }

  // ── Elimina turno ──
  if (state === 'dt_date' && cb.startsWith('dt_date:')) {
    const date = cb.split(':')[1]
    let query = ctx.admin
      .from('turns')
      .select('id, start_time, end_time, is_rest_day, profile:profiles!user_id(full_name)')
      .eq('date', date)
      .order('start_time')
    query = scopeTurnsQuery(query, toScopeProfile(ctx.profile), ctx.profile.id)
    const { data: turns } = await query
    type Row = { id: string; start_time: string; end_time: string; is_rest_day: boolean; profile: { full_name: string } | null }
    const rows = (turns ?? []) as unknown as Row[]
    if (!rows.length) {
      await clearSession(ctx.telegramId)
      await reply(ctx, `Nessun turno trovato per il ${escapeMd(formatDateLabel(date))}.`, { parse_mode: 'Markdown' })
      return true
    }
    const buttons = rows.map(t => [{
      text: t.is_rest_day
        ? `🛌 ${t.profile?.full_name ?? '—'} (Riposo)`
        : `${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)} ${t.profile?.full_name ?? '—'}`,
      callback_data: `dt_sel:${t.id}`,
    }])
    buttons.push([{ text: '❌ Annulla', callback_data: 'cancel' }])
    await setSession(ctx.telegramId, 'dt_select', { date })
    await reply(ctx, `🗑️ Turni del ${escapeMd(formatDateLabel(date))}\n\nSeleziona quello da eliminare:`, {
      parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons },
    })
    return true
  }
  if (state === 'dt_select' && cb.startsWith('dt_sel:')) {
    const id = cb.split(':')[1]
    await setSession(ctx.telegramId, 'dt_confirm', { ...data, turn_id: id })
    await reply(ctx, '⚠️ Confermi l\'eliminazione di questo turno?', { reply_markup: buildYesNoKeyboard('dt_confirm') })
    return true
  }
  if (state === 'dt_confirm' && cb.startsWith('dt_confirm:')) {
    const ok = cb.split(':')[1] === 'yes'
    await clearSession(ctx.telegramId)
    if (!ok) {
      await reply(ctx, '❌ Operazione annullata.')
      return true
    }
    let query = ctx.admin.from('turns').delete().eq('id', data.turn_id as string)
    query = scopeTurnsQuery(query, toScopeProfile(ctx.profile), ctx.profile.id)
    const { error } = await query
    if (error) await reply(ctx, `Errore: ${error.message}`)
    else await reply(ctx, '✅ Turno eliminato.')
    return true
  }

  return false
}

// ── Dispatcher per i messaggi di testo (input orari) ───────────────────
export async function handleTurniText(ctx: Ctx, state: string, data: Record<string, unknown>): Promise<boolean> {
  if (state === 'nt_start') {
    if (!isValidTime(ctx.text)) {
      await reply(ctx, '⚠️ Formato non valido. Inserisci l\'orario come HH:MM (es. 09:00).')
      return true
    }
    const next = { ...data, start_time: ctx.text.trim() }
    await setSession(ctx.telegramId, 'nt_end', next)
    await reply(ctx, '🕐 Inserisci l\'orario di fine (es. 17:00):', { reply_markup: buildCancelKeyboard() })
    return true
  }
  if (state === 'nt_end') {
    if (!isValidTime(ctx.text)) {
      await reply(ctx, '⚠️ Formato non valido. Inserisci l\'orario come HH:MM (es. 17:00).')
      return true
    }
    const next = { ...data, end_time: ctx.text.trim() }
    await setSession(ctx.telegramId, 'nt_extra', next)
    await reply(ctx, '⚡ È un turno straordinario?', { reply_markup: buildYesNoKeyboard('nt_extra') })
    return true
  }
  return false
}

function summaryNuovoTurno(data: Record<string, unknown>): string {
  return [
    '📋 *Riepilogo nuovo turno*',
    '',
    `👤 Dipendente: ${escapeMd(data.employee_name as string)}`,
    `📅 Data: ${escapeMd(formatDateLabel(data.date as string))}`,
    `🕐 Orario: ${data.start_time}–${data.end_time}`,
    `⚡ Straordinario: ${data.is_extraordinary ? 'Sì' : 'No'}`,
    '',
    'Confermi?',
  ].join('\n')
}

async function createRiposo(ctx: Ctx, data: Record<string, unknown>) {
  const { admin, profile } = ctx
  const { error } = await admin.from('turns').insert({
    user_id:          data.employee_id,
    restaurant_id:    data.restaurant_id,
    department:       data.department,
    date:             data.date,
    start_time:       '00:00:00',
    end_time:         '00:00:00',
    is_extraordinary: false,
    is_rest_day:      true,
    created_by:       profile.id,
  })

  if (error) {
    await reply(ctx, `Errore: ${error.message}`)
    return
  }

  await reply(ctx, `✅ Riposo registrato per *${escapeMd(data.employee_name as string)}* il *${escapeMd(formatDateLabel(data.date as string))}*.`, { parse_mode: 'Markdown' })

  // Notifica non bloccante ai manager
  const { data: managers } = await admin.from('profiles').select('id').eq('role', 'manager')
  if (managers?.length) {
    await admin.from('notifications').insert(
      managers.map(m => ({
        user_id: m.id,
        title:   'Nuovo riposo assegnato',
        message: `${profile.full_name} ha assegnato un riposo a ${data.employee_name} per il ${formatDateLabel(data.date as string)}`,
        link:    '/turni',
      }))
    )
  }
}
