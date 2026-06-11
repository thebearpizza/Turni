import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import type { Ctx } from '../context'
import { reply } from '../context'
import { setSession, clearSession } from '../session'
import { scopeStaffQuery, toScopeProfile, isManager, isDirettore, assigneeInScope } from '../scope'
import { TZ, escapeMd, buildEmployeeKeyboard, buildCancelKeyboard, buildYesNoKeyboard } from '../format'
import { listRestaurants, buildRestaurantKeyboard, listAssignableStaff } from '../wizard'
import { DEPARTMENTS, ODS_DAYS_IT, ODS_TYPE_LABELS, type OdsTaskType } from '@/types'
import type { InlineKeyboardMarkup } from '../types'

function getOdsCutoff(): string {
  const now = new Date()
  const romeHour = parseInt(formatInTimeZone(now, TZ, 'H'), 10)
  const refDate = romeHour < 4 ? new Date(now.getTime() - 86_400_000) : now
  const cutoffDate = formatInTimeZone(refDate, TZ, 'yyyy-MM-dd')
  return fromZonedTime(`${cutoffDate}T04:00:00`, TZ).toISOString()
}

function todayName(): string {
  return formatInTimeZone(new Date(), TZ, 'EEEE', { locale: it }).toLowerCase()
}

type OdsRow = {
  id: string; title: string; department: string; type: OdsTaskType
  recurrence_days: string[]; assigned_to: string | null
  assignee: { id: string; full_name: string } | null
}

function isDueToday(t: { type: OdsTaskType; recurrence_days: string[] }): boolean {
  if (t.type === 'quotidiana' || t.type === 'straordinaria') return true
  return t.recurrence_days.some(d => d.toLowerCase() === todayName())
}

// ── /ods — compiti di oggi nel proprio scope ──────────────────────────
export async function cmdOds(ctx: Ctx) {
  const { admin, profile } = ctx

  let query = admin
    .from('ods_tasks')
    .select('id, title, department, type, recurrence_days, assigned_to, assignee:profiles!assigned_to(id, full_name)')
    .order('department')
  query = scopeStaffQuery(query, toScopeProfile(profile))

  const { data, error } = await query
  if (error) return reply(ctx, `Errore: ${error.message}`)

  const tasks = ((data ?? []) as unknown as OdsRow[]).filter(isDueToday)
  if (!tasks.length) return reply(ctx, '📋 Nessun compito ODS previsto per oggi.')

  const cutoff = getOdsCutoff()
  const { data: completions } = await admin
    .from('ods_completions')
    .select('task_id')
    .in('task_id', tasks.map(t => t.id))
    .gte('completed_at', cutoff)

  const doneSet = new Set((completions ?? []).map((c: { task_id: string }) => c.task_id))

  const lines = ['📋 *ODS — Oggi*\n']
  for (const t of tasks) {
    const done = doneSet.has(t.id) ? '✅' : '⬜'
    const who = t.assignee?.full_name ?? `Tutto il reparto ${t.department}`
    lines.push(`${done} *${escapeMd(t.title)}*\n   ${escapeMd(t.department)} · ${escapeMd(who)} · ${ODS_TYPE_LABELS[t.type]}`)
  }

  return reply(ctx, lines.join('\n\n'), { parse_mode: 'Markdown' })
}

// ── /completaods — segna compiti come completati ───────────────────────
export async function cmdCompletaOds(ctx: Ctx) {
  const { admin, profile } = ctx

  let query = admin
    .from('ods_tasks')
    .select('id, title, department, type, recurrence_days')
    .order('department')
  query = scopeStaffQuery(query, toScopeProfile(profile))

  const { data } = await query
  const tasks = ((data ?? []) as unknown as OdsRow[]).filter(isDueToday)
  if (!tasks.length) return reply(ctx, '📋 Nessun compito ODS previsto per oggi.')

  const cutoff = getOdsCutoff()
  const { data: myCompletions } = await admin
    .from('ods_completions')
    .select('task_id')
    .eq('user_id', profile.id)
    .in('task_id', tasks.map(t => t.id))
    .gte('completed_at', cutoff)

  const doneSet = new Set((myCompletions ?? []).map((c: { task_id: string }) => c.task_id))
  const pending = tasks.filter(t => !doneSet.has(t.id))

  if (!pending.length) return reply(ctx, '✅ Hai già completato tutti i compiti di oggi!')

  const buttons = pending.map(t => [{ text: `✅ ${t.title} (${t.department})`, callback_data: `co_done:${t.id}` }])
  buttons.push([{ text: '❌ Annulla', callback_data: 'cancel' }])
  return reply(ctx, '📋 Seleziona il compito da segnare come completato:', { reply_markup: { inline_keyboard: buttons } })
}

// ── /nuovoods — wizard creazione compito ────────────────────────────────
export async function cmdNuovoOds(ctx: Ctx) {
  if (isManager(ctx.profile)) {
    const restaurants = await listRestaurants(ctx.admin)
    if (!restaurants.length) return reply(ctx, 'Nessun ristorante trovato.')
    await setSession(ctx.telegramId, 'no_restaurant', {})
    return reply(ctx, '🏢 Seleziona il ristorante:', { reply_markup: buildRestaurantKeyboard(restaurants, 'no_rest') })
  }
  await setSession(ctx.telegramId, 'no_title', {})
  return reply(ctx, '📝 Inserisci il titolo del nuovo compito ODS:', { reply_markup: buildCancelKeyboard() })
}

function buildTypeKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Quotidiana', callback_data: 'no_type:quotidiana' }, { text: 'Straordinaria', callback_data: 'no_type:straordinaria' }],
      [{ text: 'Settimanale', callback_data: 'no_type:settimanale' }, { text: 'Bisettimanale', callback_data: 'no_type:bisettimanale' }],
      [{ text: '❌ Annulla', callback_data: 'cancel' }],
    ],
  }
}

function buildDaysKeyboard(selected: string[]): InlineKeyboardMarkup {
  const rows = ODS_DAYS_IT.map(d => [{
    text: `${selected.includes(d) ? '✅' : '⬜'} ${d}`,
    callback_data: `no_day:${d}`,
  }])
  rows.push([{ text: '➡️ Fatto', callback_data: 'no_days_done' }])
  rows.push([{ text: '❌ Annulla', callback_data: 'cancel' }])
  return { inline_keyboard: rows }
}

function buildTargetKeyboard(profile: Ctx['profile']): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup['inline_keyboard'] = [[{ text: '👤 Dipendente specifico', callback_data: 'no_target:employee' }]]
  if (isDirettore(profile) || isManager(profile)) {
    for (const dept of DEPARTMENTS) {
      rows.push([{ text: `🏬 Reparto ${dept}`, callback_data: `no_target:dept:${dept}` }])
    }
    rows.push([{ text: '🏬 Tutti i reparti', callback_data: 'no_target:alldept' }])
  } else {
    rows.push([{ text: `🏬 Tutto il reparto ${profile.department}`, callback_data: `no_target:dept:${profile.department}` }])
  }
  rows.push([{ text: '❌ Annulla', callback_data: 'cancel' }])
  return { inline_keyboard: rows }
}

async function goToTargetStep(ctx: Ctx, data: Record<string, unknown>) {
  await setSession(ctx.telegramId, 'no_target', data)
  await reply(ctx, '🎯 A chi vuoi assegnare il compito?', { reply_markup: buildTargetKeyboard(ctx.profile) })
}

// ── Dispatcher callback ────────────────────────────────────────────────
export async function handleOdsCallback(ctx: Ctx, state: string, data: Record<string, unknown>): Promise<boolean> {
  const cb = ctx.callbackData ?? ''

  if (cb.startsWith('co_done:')) {
    const taskId = cb.split(':')[1]
    const { error } = await ctx.admin.from('ods_completions').insert({ task_id: taskId, user_id: ctx.profile.id })
    if (error) await reply(ctx, `Errore: ${error.message}`)
    else await reply(ctx, '✅ Compito segnato come completato!')
    return true
  }

  if (state === 'no_restaurant' && cb.startsWith('no_rest:')) {
    const restaurantId = cb.split(':')[1]
    await setSession(ctx.telegramId, 'no_title', { restaurant_id: restaurantId })
    await reply(ctx, '📝 Inserisci il titolo del nuovo compito ODS:', { reply_markup: buildCancelKeyboard() })
    return true
  }

  if (state === 'no_type' && cb.startsWith('no_type:')) {
    const type = cb.split(':')[1] as OdsTaskType
    const next = { ...data, type, days: [] as string[] }
    if (type === 'settimanale' || type === 'bisettimanale') {
      await setSession(ctx.telegramId, 'no_days', next)
      await reply(ctx, '📅 Seleziona i giorni della settimana:', { reply_markup: buildDaysKeyboard([]) })
    } else {
      await goToTargetStep(ctx, next)
    }
    return true
  }

  if (state === 'no_days' && cb.startsWith('no_day:')) {
    const day = cb.split(':')[1]
    const days = new Set((data.days as string[]) ?? [])
    if (days.has(day)) days.delete(day)
    else days.add(day)
    const next = { ...data, days: Array.from(days) }
    await setSession(ctx.telegramId, 'no_days', next)
    await reply(ctx, '📅 Seleziona i giorni della settimana:', { edit: true, reply_markup: buildDaysKeyboard(next.days) })
    return true
  }

  if (state === 'no_days' && cb === 'no_days_done') {
    const days = (data.days as string[]) ?? []
    if (!days.length) {
      await reply(ctx, '⚠️ Seleziona almeno un giorno.', { reply_markup: buildDaysKeyboard(days) })
      return true
    }
    await goToTargetStep(ctx, data)
    return true
  }

  if (state === 'no_target' && cb.startsWith('no_target:')) {
    const parts = cb.split(':')
    const kind = parts[1]
    if (kind === 'employee') {
      const staff = await listAssignableStaff(ctx.admin, ctx.profile, data.restaurant_id as string | undefined)
      if (!staff.length) return reply(ctx, 'Nessun dipendente trovato.').then(() => true)
      await setSession(ctx.telegramId, 'no_employee', data)
      await reply(ctx, '👤 Seleziona il dipendente:', { reply_markup: buildEmployeeKeyboard(staff, 'no_emp') })
      return true
    }
    if (kind === 'dept') {
      const department = parts[2]
      const next = { ...data, department, assigned_to: null }
      await setSession(ctx.telegramId, 'no_confirm', next)
      await reply(ctx, summaryNuovoOds(next), { parse_mode: 'Markdown', reply_markup: buildYesNoKeyboard('no_confirm') })
      return true
    }
    if (kind === 'alldept') {
      const next = { ...data, department: null, assigned_to: null, all_departments: true }
      await setSession(ctx.telegramId, 'no_confirm', next)
      await reply(ctx, summaryNuovoOds(next), { parse_mode: 'Markdown', reply_markup: buildYesNoKeyboard('no_confirm') })
      return true
    }
  }

  if (state === 'no_employee' && cb.startsWith('no_emp:')) {
    const employeeId = cb.split(':')[1]
    const staff = await listAssignableStaff(ctx.admin, ctx.profile, data.restaurant_id as string | undefined)
    const employee = staff.find(s => s.id === employeeId)
    if (!employee) return reply(ctx, 'Dipendente non trovato.').then(() => true)
    if (!assigneeInScope(ctx.profile, employee)) {
      await clearSession(ctx.telegramId)
      await reply(ctx, '🚫 Non autorizzato per questo dipendente.')
      return true
    }
    const next = { ...data, department: employee.department, assigned_to: employee.id, assignee_name: employee.full_name, restaurant_id: employee.restaurant_id }
    await setSession(ctx.telegramId, 'no_confirm', next)
    await reply(ctx, summaryNuovoOds(next), { parse_mode: 'Markdown', reply_markup: buildYesNoKeyboard('no_confirm') })
    return true
  }

  if (state === 'no_confirm' && cb.startsWith('no_confirm:')) {
    const ok = cb.split(':')[1] === 'yes'
    await clearSession(ctx.telegramId)
    if (!ok) {
      await reply(ctx, '❌ Operazione annullata.')
      return true
    }
    await createOdsFromWizard(ctx, data)
    return true
  }

  return false
}

// ── Dispatcher testo ──────────────────────────────────────────────────
export async function handleOdsText(ctx: Ctx, state: string, data: Record<string, unknown>): Promise<boolean> {
  if (state === 'no_title') {
    const title = ctx.text.trim()
    if (!title) {
      await reply(ctx, '⚠️ Il titolo non può essere vuoto. Riprova:')
      return true
    }
    const next = { ...data, title }
    await setSession(ctx.telegramId, 'no_type', next)
    await reply(ctx, '🔁 Con quale frequenza?', { reply_markup: buildTypeKeyboard() })
    return true
  }
  return false
}

function summaryNuovoOds(data: Record<string, unknown>): string {
  const target = data.all_departments
    ? 'Tutti i reparti'
    : data.assigned_to
      ? `${data.assignee_name}`
      : `Tutto il reparto ${data.department}`

  const days = (data.days as string[]) ?? []
  const lines = [
    '📋 *Riepilogo nuovo compito ODS*',
    '',
    `📝 Titolo: ${escapeMd(data.title as string)}`,
    `🔁 Tipo: ${ODS_TYPE_LABELS[data.type as OdsTaskType]}`,
  ]
  if (days.length) lines.push(`📅 Giorni: ${days.join(', ')}`)
  lines.push(`🎯 Assegnato a: ${escapeMd(target)}`)
  lines.push('', 'Confermi?')
  return lines.join('\n')
}

async function createOdsFromWizard(ctx: Ctx, data: Record<string, unknown>) {
  const { admin, profile } = ctx
  const restaurantId = (data.restaurant_id as string | undefined) ?? profile.restaurant_id
  if (!restaurantId) {
    await reply(ctx, 'Errore: ristorante non determinato.')
    return
  }

  const departments: string[] = data.all_departments
    ? [...DEPARTMENTS]
    : [data.department as string]

  const baseRow = {
    title:           data.title as string,
    restaurant_id:   restaurantId,
    type:            data.type as OdsTaskType,
    recurrence_days: (data.days as string[]) ?? [],
    creator_id:      profile.id,
  }

  let created = 0
  for (const department of departments) {
    const assignedTo = !data.all_departments ? (data.assigned_to as string | null) : null
    const { data: task, error } = await admin
      .from('ods_tasks')
      .insert({ ...baseRow, department, assigned_to: assignedTo })
      .select('id')
      .single()

    if (error || !task) continue
    created++

    // Notifiche non bloccanti ai destinatari
    let recipients: { id: string }[] = []
    if (assignedTo) {
      recipients = [{ id: assignedTo }]
    } else {
      const { data: staff } = await admin
        .from('profiles')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('department', department)
        .in('role', ['dipendente', 'capo_servizio'])
        .neq('id', profile.id)
      recipients = staff ?? []
    }
    if (recipients.length) {
      await admin.from('notifications').insert(
        recipients.map(r => ({
          user_id: r.id,
          title:   assignedTo ? 'Nuova mansione assegnata' : 'Nuova istruzione di Reparto',
          message: data.title as string,
          link:    '/ods',
        }))
      )
    }
  }

  if (created === 0) {
    await reply(ctx, 'Errore nella creazione del compito.')
  } else {
    await reply(ctx, `✅ Compito ODS creato${created > 1 ? ` per ${created} reparti` : ''}.`)
  }
}
