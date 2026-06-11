import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { Ctx } from '../context'
import { reply } from '../context'
import { setSession, clearSession } from '../session'
import { isManager, isDirettore, assigneeInScope } from '../scope'
import { TZ, todayStr, escapeMd, isValidTime, buildDateKeyboard, buildEmployeeKeyboard, buildCancelKeyboard, buildYesNoKeyboard, formatDateLabel } from '../format'
import { listAssignableStaff } from '../wizard'

function dayBounds(dateStr: string) {
  const start = fromZonedTime(`${dateStr}T00:00:00`, TZ).toISOString()
  const end = fromZonedTime(`${dateStr}T23:59:59.999`, TZ).toISOString()
  return { start, end }
}

// ── /presenze — presenze di oggi nel proprio scope ──────────────────────
export async function cmdPresenze(ctx: Ctx) {
  const { admin, profile } = ctx
  const { start, end } = dayBounds(todayStr())

  let query = admin
    .from('attendances')
    .select('id, check_in, check_out, profile:profiles(full_name), restaurant:restaurants(name)')
    .gte('check_in', start)
    .lte('check_in', end)
    .order('check_in')
    .limit(30)

  if (isDirettore(profile)) query = query.eq('restaurant_id', profile.restaurant_id)

  const { data, error } = await query
  if (error) return reply(ctx, `Errore: ${error.message}`)

  type Row = { check_in: string; check_out: string | null; profile: { full_name: string } | null; restaurant: { name: string } | null }
  const rows = (data ?? []) as unknown as Row[]
  if (!rows.length) return reply(ctx, '🕐 Nessuna presenza registrata oggi.')

  const lines = ['🕐 *Presenze di oggi*\n']
  for (const r of rows) {
    const checkIn = formatInTimeZone(r.check_in, TZ, 'HH:mm')
    const checkOut = r.check_out ? formatInTimeZone(r.check_out, TZ, 'HH:mm') : '—'
    const restPart = isManager(profile) && r.restaurant?.name ? ` · ${escapeMd(r.restaurant.name)}` : ''
    lines.push(`👤 ${escapeMd(r.profile?.full_name ?? '—')}: ${checkIn} → ${checkOut}${restPart}`)
  }
  return reply(ctx, lines.join('\n'), { parse_mode: 'Markdown' })
}

// ── /modificapresenza — wizard modifica orari presenza esistente ───────
export async function cmdModificaPresenza(ctx: Ctx) {
  const { admin, profile } = ctx
  const { start, end } = dayBounds(todayStr())

  let query = admin
    .from('attendances')
    .select('id, check_in, check_out, profile:profiles(full_name)')
    .gte('check_in', start)
    .lte('check_in', end)
    .order('check_in')
    .limit(30)

  if (isDirettore(profile)) query = query.eq('restaurant_id', profile.restaurant_id)

  const { data } = await query
  type Row = { id: string; check_in: string; check_out: string | null; profile: { full_name: string } | null }
  const rows = (data ?? []) as unknown as Row[]
  if (!rows.length) return reply(ctx, '🕐 Nessuna presenza registrata oggi da modificare.')

  const buttons = rows.map(r => [{
    text: `${r.profile?.full_name ?? '—'}: ${formatInTimeZone(r.check_in, TZ, 'HH:mm')} → ${r.check_out ? formatInTimeZone(r.check_out, TZ, 'HH:mm') : '—'}`,
    callback_data: `mp_sel:${r.id}`,
  }])
  buttons.push([{ text: '❌ Annulla', callback_data: 'cancel' }])
  await setSession(ctx.telegramId, 'mp_select', {})
  return reply(ctx, '✏️ Seleziona la presenza da modificare:', { reply_markup: { inline_keyboard: buttons } })
}

// ── /nuovapresenza — wizard creazione presenza manuale ──────────────────
export async function cmdNuovaPresenza(ctx: Ctx) {
  const staff = await listAssignableStaff(ctx.admin, ctx.profile, isManager(ctx.profile) ? undefined : ctx.profile.restaurant_id ?? undefined)
  if (!staff.length) return reply(ctx, 'Nessun dipendente trovato.')
  await setSession(ctx.telegramId, 'np_employee', {})
  return reply(ctx, '👤 Seleziona il dipendente:', { reply_markup: buildEmployeeKeyboard(staff, 'np_emp') })
}

// ── Dispatcher callback ────────────────────────────────────────────────
export async function handlePresenzeCallback(ctx: Ctx, state: string, data: Record<string, unknown>): Promise<boolean> {
  const cb = ctx.callbackData ?? ''
  const { admin, profile } = ctx

  if (state === 'mp_select' && cb.startsWith('mp_sel:')) {
    const id = cb.split(':')[1]
    let query = admin.from('attendances').select('id, check_in, check_out').eq('id', id)
    if (isDirettore(profile)) query = query.eq('restaurant_id', profile.restaurant_id)
    const { data: row } = await query.maybeSingle()
    if (!row) {
      await clearSession(ctx.telegramId)
      await reply(ctx, '🚫 Presenza non trovata o non autorizzata.')
      return true
    }
    const date = formatInTimeZone(row.check_in, TZ, 'yyyy-MM-dd')
    await setSession(ctx.telegramId, 'mp_checkin', { attendance_id: id, date })
    await reply(ctx, `🕐 Inserisci il nuovo orario di *ingresso* (HH:MM):`, { parse_mode: 'Markdown', reply_markup: buildCancelKeyboard() })
    return true
  }

  if (state === 'mp_checkout' && cb === 'mp_checkout:none') {
    await finalizeModificaPresenza(ctx, data, null)
    return true
  }

  if (state === 'np_employee' && cb.startsWith('np_emp:')) {
    const employeeId = cb.split(':')[1]
    const staff = await listAssignableStaff(admin, profile, isManager(profile) ? undefined : profile.restaurant_id ?? undefined)
    const employee = staff.find(s => s.id === employeeId)
    if (!employee) return reply(ctx, 'Dipendente non trovato.').then(() => true)
    if (!assigneeInScope(profile, employee)) {
      await clearSession(ctx.telegramId)
      await reply(ctx, '🚫 Non autorizzato per questo dipendente.')
      return true
    }
    await setSession(ctx.telegramId, 'np_date', { employee_id: employee.id, employee_name: employee.full_name, restaurant_id: employee.restaurant_id })
    await reply(ctx, `👤 ${escapeMd(employee.full_name)}\n\n📅 Seleziona la data:`, { parse_mode: 'Markdown', reply_markup: buildDateKeyboard('np_date') })
    return true
  }

  if (state === 'np_date' && cb.startsWith('np_date:')) {
    const date = cb.split(':')[1]
    await setSession(ctx.telegramId, 'np_checkin', { ...data, date })
    await reply(ctx, `📅 ${escapeMd(formatDateLabel(date))}\n\n🕐 Inserisci l'orario di *ingresso* (HH:MM):`, { parse_mode: 'Markdown', reply_markup: buildCancelKeyboard() })
    return true
  }

  if (state === 'np_checkout' && cb === 'np_checkout:none') {
    await finalizeNuovaPresenza(ctx, data, null)
    return true
  }

  if (state === 'np_confirm' && cb.startsWith('np_confirm:')) {
    const ok = cb.split(':')[1] === 'yes'
    await clearSession(ctx.telegramId)
    if (!ok) {
      await reply(ctx, '❌ Operazione annullata.')
      return true
    }
    await insertNuovaPresenza(ctx, data)
    return true
  }

  return false
}

// ── Dispatcher testo ──────────────────────────────────────────────────
export async function handlePresenzeText(ctx: Ctx, state: string, data: Record<string, unknown>): Promise<boolean> {
  if (state === 'mp_checkin') {
    if (!isValidTime(ctx.text)) {
      await reply(ctx, '⚠️ Formato non valido. Inserisci l\'orario come HH:MM.')
      return true
    }
    const next = { ...data, check_in: ctx.text.trim() }
    await setSession(ctx.telegramId, 'mp_checkout', next)
    await reply(ctx, '🕐 Inserisci il nuovo orario di *uscita* (HH:MM), oppure:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '➡️ Nessuna uscita', callback_data: 'mp_checkout:none' }], [{ text: '❌ Annulla', callback_data: 'cancel' }]] },
    })
    return true
  }
  if (state === 'mp_checkout') {
    if (!isValidTime(ctx.text)) {
      await reply(ctx, '⚠️ Formato non valido. Inserisci l\'orario come HH:MM oppure usa il bottone.')
      return true
    }
    await finalizeModificaPresenza(ctx, data, ctx.text.trim())
    return true
  }

  if (state === 'np_checkin') {
    if (!isValidTime(ctx.text)) {
      await reply(ctx, '⚠️ Formato non valido. Inserisci l\'orario come HH:MM.')
      return true
    }
    const next = { ...data, check_in: ctx.text.trim() }
    await setSession(ctx.telegramId, 'np_checkout', next)
    await reply(ctx, '🕐 Inserisci l\'orario di *uscita* (HH:MM), oppure:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '➡️ Nessuna uscita', callback_data: 'np_checkout:none' }], [{ text: '❌ Annulla', callback_data: 'cancel' }]] },
    })
    return true
  }
  if (state === 'np_checkout') {
    if (!isValidTime(ctx.text)) {
      await reply(ctx, '⚠️ Formato non valido. Inserisci l\'orario come HH:MM oppure usa il bottone.')
      return true
    }
    await finalizeNuovaPresenza(ctx, data, ctx.text.trim())
    return true
  }

  return false
}

async function finalizeModificaPresenza(ctx: Ctx, data: Record<string, unknown>, checkOut: string | null) {
  const { admin, profile } = ctx
  const date = data.date as string
  const checkIn = data.check_in as string

  const checkInIso = fromZonedTime(`${date}T${checkIn}:00`, TZ).toISOString()
  const checkOutIso = checkOut ? fromZonedTime(`${date}T${checkOut}:00`, TZ).toISOString() : null

  if (checkOutIso && checkOutIso <= checkInIso) {
    await clearSession(ctx.telegramId)
    await reply(ctx, "⚠️ L'orario di uscita deve essere successivo a quello di ingresso. Operazione annullata.")
    return
  }

  await clearSession(ctx.telegramId)

  let query = admin.from('attendances').update({ check_in: checkInIso, check_out: checkOutIso }).eq('id', data.attendance_id as string)
  if (isDirettore(profile)) query = query.eq('restaurant_id', profile.restaurant_id)
  const { error } = await query

  if (error) await reply(ctx, `Errore: ${error.message}`)
  else await reply(ctx, '✅ Presenza aggiornata.')
}

async function finalizeNuovaPresenza(ctx: Ctx, data: Record<string, unknown>, checkOut: string | null) {
  const next = { ...data, check_out: checkOut }
  await setSession(ctx.telegramId, 'np_confirm', next)

  const checkOutLabel = checkOut ?? '—'
  await reply(ctx, [
    '📋 *Riepilogo nuova presenza*',
    '',
    `👤 Dipendente: ${escapeMd(data.employee_name as string)}`,
    `📅 Data: ${escapeMd(formatDateLabel(data.date as string))}`,
    `🕐 Ingresso: ${data.check_in}`,
    `🕐 Uscita: ${checkOutLabel}`,
    '',
    'Confermi?',
  ].join('\n'), { parse_mode: 'Markdown', reply_markup: buildYesNoKeyboard('np_confirm') })
}

async function insertNuovaPresenza(ctx: Ctx, data: Record<string, unknown>) {
  const { admin } = ctx
  const date = data.date as string
  const checkIn = data.check_in as string
  const checkOut = data.check_out as string | null

  const checkInIso = fromZonedTime(`${date}T${checkIn}:00`, TZ).toISOString()
  const checkOutIso = checkOut ? fromZonedTime(`${date}T${checkOut}:00`, TZ).toISOString() : null

  if (checkOutIso && checkOutIso <= checkInIso) {
    await reply(ctx, "⚠️ L'orario di uscita deve essere successivo a quello di ingresso. Operazione annullata.")
    return
  }

  const { error } = await admin.from('attendances').insert({
    user_id:       data.employee_id,
    restaurant_id: data.restaurant_id,
    check_in:      checkInIso,
    check_out:     checkOutIso,
  })

  if (error) await reply(ctx, `Errore: ${error.message}`)
  else await reply(ctx, `✅ Presenza creata per *${escapeMd(data.employee_name as string)}*.`, { parse_mode: 'Markdown' })
}
