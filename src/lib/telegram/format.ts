import { addDays, format } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import type { InlineKeyboardMarkup } from './types'

export const TZ = 'Europe/Rome'

export function todayStr(): string {
  return formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
}

export function dateAfter(days: number): string {
  return formatInTimeZone(addDays(new Date(), days), TZ, 'yyyy-MM-dd')
}

export function formatDateLabel(dateStr: string): string {
  return formatInTimeZone(`${dateStr}T12:00:00Z`, TZ, 'EEEE d MMMM', { locale: it })
}

export function formatDateShort(dateStr: string): string {
  return formatInTimeZone(`${dateStr}T12:00:00Z`, TZ, 'dd/MM', { locale: it })
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isValidTime(text: string): boolean {
  return TIME_RE.test(text.trim())
}

export function normalizeTime(text: string): string {
  return `${text.trim()}:00`
}

// Caratteri speciali Markdown (legacy "Markdown" mode di Telegram).
export function escapeMd(text: string): string {
  return text.replace(/([_*`[\]])/g, '\\$1')
}

// ── Inline keyboard builders ──────────────────────────────────────────

export function buildDateKeyboard(prefix: string, days = 7): InlineKeyboardMarkup {
  const today = new Date()
  const labels = ['Oggi', 'Domani']
  const rows: InlineKeyboardMarkup['inline_keyboard'] = []
  let row: InlineKeyboardMarkup['inline_keyboard'][number] = []

  for (let i = 0; i < days; i++) {
    const d = addDays(today, i)
    const dateStr = format(d, 'yyyy-MM-dd')
    const label = labels[i] ?? formatInTimeZone(`${dateStr}T12:00:00Z`, TZ, 'EEE d/MM', { locale: it })
    row.push({ text: label, callback_data: `${prefix}:${dateStr}` })
    if (row.length === 2) {
      rows.push(row)
      row = []
    }
  }
  if (row.length) rows.push(row)
  rows.push([{ text: '❌ Annulla', callback_data: 'cancel' }])
  return { inline_keyboard: rows }
}

export function buildEmployeeKeyboard(
  employees: { id: string; full_name: string }[],
  prefix: string,
): InlineKeyboardMarkup {
  const rows = employees.map(e => [{ text: e.full_name, callback_data: `${prefix}:${e.id}` }])
  rows.push([{ text: '❌ Annulla', callback_data: 'cancel' }])
  return { inline_keyboard: rows }
}

export function buildYesNoKeyboard(prefix: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Sì', callback_data: `${prefix}:yes` },
        { text: '❌ No', callback_data: `${prefix}:no` },
      ],
    ],
  }
}

export function buildCancelKeyboard(): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: '❌ Annulla', callback_data: 'cancel' }]] }
}
