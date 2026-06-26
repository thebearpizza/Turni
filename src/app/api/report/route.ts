import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { autoCloseStaleShifts } from '@/lib/autoCloseStaleShifts'
import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { differenceInMinutes, getDaysInMonth } from 'date-fns'
import { it } from 'date-fns/locale'
import { ABSENCE_CODES } from '@/types'
import type { AbsenceType } from '@/types'

const TZ = 'Europe/Rome'
const TARGET_HOURS_PER_DAY = 8.5

function minutesToHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role === 'dipendente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { month, restaurantIds, type } = await request.json()

  if (!month || !restaurantIds?.length || !['presenze', 'ore'].includes(type)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  // Capo servizio può accedere solo al proprio ristorante
  const allowedIds = profile.role === 'capo_servizio' && profile.restaurant_id
    ? restaurantIds.filter((id: string) => id === profile.restaurant_id)
    : restaurantIds

  const [year, monthNum] = month.split('-').map(Number)
  const daysInMonth = getDaysInMonth(new Date(year, monthNum - 1))
  const startDate = `${month}-01`
  const endDate = `${month}-${String(daysInMonth).padStart(2, '0')}`
  // Use Rome-midnight boundaries so after-midnight check-ins are included correctly
  const rangeStart = fromZonedTime(`${startDate}T00:00:00`, TZ).toISOString()
  const rangeEnd = fromZonedTime(`${endDate}T23:59:59`, TZ).toISOString()

  const admin = createAdminClient()

  // Close forgotten check-outs (shifts open >16h) so reported hours don't show
  // an open/zero session for an employee who simply forgot to timbrare l'uscita.
  await autoCloseStaleShifts(admin)

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Turni App'
  workbook.created = new Date()

  const monthName = formatInTimeZone(new Date(year, monthNum - 1, 1), TZ, 'MMMM yyyy', { locale: it })

  for (const restaurantId of allowedIds) {
    const { data: restaurant } = await admin
      .from('restaurants')
      .select('id, name')
      .eq('id', restaurantId)
      .single()

    if (!restaurant) continue

    // Dipendenti del ristorante
    const { data: employees } = await admin
      .from('profiles')
      .select('id, full_name')
      .eq('restaurant_id', restaurantId)
      .in('role', ['dipendente', 'capo_servizio'])
      .order('full_name')

    if (!employees?.length) continue

    // Presenze del mese per il ristorante
    const { data: attendances } = await admin
      .from('attendances')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .gte('check_in', rangeStart)
      .lte('check_in', rangeEnd)

    // Assenze del mese per il ristorante
    const { data: absences } = await admin
      .from('absences')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'approved')
      .lte('start_date', endDate)
      .gte('end_date', startDate)

    const sheet = workbook.addWorksheet(restaurant.name.substring(0, 31))

    // Header row: dipendente + giorni + extra colonne
    const extraCols = type === 'ore' ? ['Totale Ore', 'Differenza', 'Note'] : ['Note']
    const headers = ['Dipendente', ...Array.from({ length: daysInMonth }, (_, i) => String(i + 1)), ...extraCols]
    const headerRow = sheet.addRow(headers)
    headerRow.font = { bold: true, size: 11 }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    headerRow.alignment = { horizontal: 'center' }

    // Freeze prima colonna e prima riga
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]

    // Larghezza colonne
    sheet.getColumn(1).width = 22
    for (let d = 2; d <= daysInMonth + 1; d++) {
      sheet.getColumn(d).width = 5
    }
    if (type === 'ore') {
      sheet.getColumn(daysInMonth + 2).width = 12
      sheet.getColumn(daysInMonth + 3).width = 12
      sheet.getColumn(daysInMonth + 4).width = 20
    } else {
      sheet.getColumn(daysInMonth + 2).width = 25
    }

    const CELL_COLORS: Record<string, string> = {
      P: 'FFd4edda',   // verde pastello
      PP: 'FF86efac',  // verde intenso (doppio turno >12h)
      F: 'FFe8d5f5',   // lilla
      M: 'FFd0e8f5',   // azzurro
      R: 'FFf5d0d0',   // rosso pastello
      AI: 'FFd8c5f0',  // viola
    }

    for (const emp of employees) {
      const row: (string | number)[] = [emp.full_name]
      let totalMinutes = 0
      let workDays = 0

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${month}-${String(day).padStart(2, '0')}`

        // Controlla assenza
        const absence = absences?.find(a =>
          a.user_id === emp.id &&
          a.start_date <= dateStr &&
          a.end_date >= dateStr
        )

        if (absence) {
          const code = ABSENCE_CODES[absence.type as AbsenceType]
          if (type === 'presenze') {
            row.push(code)
          } else {
            row.push('')
          }
          continue
        }

        // Tutte le sessioni di questo dipendente in questo giorno (Rome time)
        const daySessions = attendances?.filter(a => {
          if (a.user_id !== emp.id) return false
          const dayRome = formatInTimeZone(new Date(a.check_in), TZ, 'yyyy-MM-dd')
          return dayRome === dateStr
        }) ?? []

        if (daySessions.length > 0) {
          const hasOpen = daySessions.some(a => !a.check_out)
          const dayMinutes = daySessions.reduce((sum, a) => {
            if (!a.check_out) return sum
            return sum + differenceInMinutes(new Date(a.check_out), new Date(a.check_in))
          }, 0)

          if (type === 'presenze') {
            row.push(dayMinutes > 720 ? 'PP' : 'P')
          } else {
            if (hasOpen && dayMinutes === 0) {
              row.push('In corso')
            } else {
              totalMinutes += dayMinutes
              workDays++
              row.push(minutesToHours(dayMinutes))
            }
          }
        } else {
          row.push('')
        }
      }

      if (type === 'ore') {
        const targetMinutes = workDays * TARGET_HOURS_PER_DAY * 60
        const diffMinutes = totalMinutes - targetMinutes
        const diffSign = diffMinutes >= 0 ? '+' : '-'
        row.push(minutesToHours(totalMinutes))
        row.push(`${diffSign}${minutesToHours(Math.abs(diffMinutes))}`)
        row.push('')
      } else {
        row.push('')
      }

      const dataRow = sheet.addRow(row)
      dataRow.alignment = { horizontal: 'center' }
      dataRow.getCell(1).alignment = { horizontal: 'left' }

      // Colora celle
      for (let colIdx = 2; colIdx <= daysInMonth + 1; colIdx++) {
        const cell = dataRow.getCell(colIdx)
        const val = String(cell.value ?? '')
        const color = CELL_COLORS[val]
        if (color) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
          cell.font = { color: { argb: 'FF1a1a1a' }, bold: true }
        }
      }

      // Colora totale e differenza per ore
      if (type === 'ore') {
        const diffCell = dataRow.getCell(daysInMonth + 3)
        const diffVal = String(diffCell.value ?? '')
        if (diffVal.startsWith('+')) {
          diffCell.font = { color: { argb: 'FF166534' }, bold: true }
        } else if (diffVal.startsWith('-')) {
          diffCell.font = { color: { argb: 'FF991B1B' }, bold: true }
        }
      }
    }

    // Bordi
    const totalRows = sheet.rowCount
    const totalCols = headers.length
    for (let r = 1; r <= totalRows; r++) {
      for (let c = 1; c <= totalCols; c++) {
        sheet.getCell(r, c).border = {
          top: { style: 'thin', color: { argb: 'FFe2e8f0' } },
          left: { style: 'thin', color: { argb: 'FFe2e8f0' } },
          bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } },
          right: { style: 'thin', color: { argb: 'FFe2e8f0' } },
        }
      }
    }
  }

  if (workbook.worksheets.length === 0) {
    return NextResponse.json({ error: 'Nessun dato trovato per il periodo selezionato' }, { status: 404 })
  }

  const buffer = await workbook.xlsx.writeBuffer()

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="report-${type}-${month}.xlsx"`,
    },
  })
}
