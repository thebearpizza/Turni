import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { autoCloseStaleShifts } from '@/lib/autoCloseStaleShifts'
import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { fromZonedTime } from 'date-fns-tz'
import { calcolaGriglia, giorniDelMese, TZ_REPORT, MINUTI_DOPPIO_TURNO, ORE_ATTESE_GIORNO } from './calcolo'
import type { AssenzaRep, DipendenteRep, PresenzaRep } from './calcolo'

// Stili dell'export del design (xlsx.js): intestazione blu notte con testo
// bianco, codici colorati, ore in decimale "0.0#", bordi sottili grigi.
const RIEMPI: Record<string, string> = {
  head: 'FF1F2A44', P: 'FFD9EFE0', PP: 'FF86DFA5', R: 'FFF6D5D5', F: 'FFE7DCF7', M: 'FFD7E5F6', AI: 'FFE4E4E4',
}
const BORDO: Partial<ExcelJS.Borders> = (() => {
  const b = { style: 'thin' as const, color: { argb: 'FFD9D9D9' } }
  return { top: b, left: b, bottom: b, right: b }
})()
const CENTRO: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' }

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore, managed_restaurant_ids, consultant_restaurant_ids, can_view_hours')
    .eq('id', user.id)
    .single()

  // Allow-list stretta: solo chi ha davvero titolo a vedere presenze/ore di
  // uno staff. dipendente, cassiere e hostess non hanno alcuna funzione di
  // supervisione — bloccarli qui, non solo a livello di routing, perché
  // questa API viene chiamata direttamente (fetch), non solo attraverso una
  // pagina protetta.
  if (!profile || !['manager', 'capo_servizio', 'consulente_lavoro'].includes(profile.role)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { month, restaurantIds, type } = await request.json()

  if (!month || !restaurantIds?.length || !['presenze', 'ore'].includes(type)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  // Un consulente del lavoro senza can_view_hours vede solo le presenze
  // (chi c'è, chi manca), mai il dettaglio delle ore lavorate.
  if (profile.role === 'consulente_lavoro' && type === 'ore' && !profile.can_view_hours) {
    return NextResponse.json({ error: 'Non autorizzato a visualizzare le ore lavorate' }, { status: 403 })
  }
  // Stessa regola della schermata: il capo servizio che non è direttore
  // vede solo le presenze, mai le ore.
  if (profile.role === 'capo_servizio' && type === 'ore' && !profile.is_direttore) {
    return NextResponse.json({ error: 'Non autorizzato a visualizzare le ore lavorate' }, { status: 403 })
  }

  // Ogni ruolo vede solo i ristoranti che gli competono davvero — mai
  // l'elenco grezzo arrivato dal client:
  //  - capo_servizio: solo il proprio ristorante;
  //  - consulente_lavoro: solo i ristoranti a cui è stato assegnato;
  //  - manager: i ristoranti che gestisce (managed_restaurant_ids), oppure
  //    tutti se è il proprietario della piattaforma (null).
  const allowedIds: string[] =
    profile.role === 'capo_servizio'
      ? (profile.restaurant_id ? restaurantIds.filter((id: string) => id === profile.restaurant_id) : [])
    : profile.role === 'consulente_lavoro'
      ? restaurantIds.filter((id: string) => (profile.consultant_restaurant_ids ?? []).includes(id))
    : profile.managed_restaurant_ids === null
      ? restaurantIds
      : restaurantIds.filter((id: string) => profile.managed_restaurant_ids!.includes(id))

  if (allowedIds.length === 0) {
    return NextResponse.json({ error: 'Nessun ristorante autorizzato per questa richiesta' }, { status: 403 })
  }

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }
  const nd = giorniDelMese(month)
  const startDate = `${month}-01`
  const endDate = `${month}-${String(nd).padStart(2, '0')}`
  // Confini a mezzanotte di Roma, così gli ingressi dopo mezzanotte cadono nel giorno giusto
  const rangeStart = fromZonedTime(`${startDate}T00:00:00`, TZ_REPORT).toISOString()
  const rangeEnd = fromZonedTime(`${endDate}T23:59:59`, TZ_REPORT).toISOString()
  const P = type === 'presenze'

  const admin = createAdminClient()

  // Chiude le uscite dimenticate (turni aperti da oltre 16h), così le ore
  // non riportano una sessione aperta a zero per chi ha scordato l'uscita.
  await autoCloseStaleShifts(admin)

  const { data: ristoranti } = await admin.from('restaurants').select('id, name').in('id', allowedIds).order('name')
  // L'ordine dei fogli segue quello chiesto dal client (l'ordine delle pillole).
  const ordinati = allowedIds.map(id => (ristoranti ?? []).find(r => r.id === id)).filter(Boolean) as { id: string; name: string }[]

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'inTurno'
  workbook.created = new Date()
  const usati = new Set<string>()

  for (const restaurant of ordinati) {
    const [{ data: employees }, { data: attendances }, { data: absences }] = await Promise.all([
      admin.from('profiles').select('id, full_name, restaurant_id')
        .eq('restaurant_id', restaurant.id).in('role', ['dipendente', 'capo_servizio']).order('full_name'),
      admin.from('attendances').select('id, user_id, restaurant_id, check_in, check_out')
        .eq('restaurant_id', restaurant.id).gte('check_in', rangeStart).lte('check_in', rangeEnd),
      admin.from('absences').select('id, user_id, restaurant_id, type, start_date, end_date')
        .eq('restaurant_id', restaurant.id).eq('status', 'approved').lte('start_date', endDate).gte('end_date', startDate),
    ])
    if (!employees?.length) continue

    const dip = employees as DipendenteRep[]
    const griglia = calcolaGriglia(month, dip, (attendances ?? []) as PresenzaRep[], (absences ?? []) as AssenzaRep[])

    // Nome del foglio = nome del locale (max 31 caratteri, senza i simboli vietati da Excel, univoco)
    let nome = restaurant.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Locale'
    for (let i = 2; usati.has(nome); i++) nome = `${nome.slice(0, 28)} ${i}`
    usati.add(nome)
    const sheet = workbook.addWorksheet(nome, { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] })
    sheet.properties.defaultRowHeight = 20
    sheet.columns = [{ width: 24 }, ...Array.from({ length: nd }, () => ({ width: P ? 5 : 6 })), ...(P ? [] : [{ width: 9 }, { width: 11 }])]

    const head = sheet.addRow(['Dipendente', ...Array.from({ length: nd }, (_, i) => i + 1), ...(P ? [] : ['Totale', 'Differenza'])])
    head.height = 20
    head.eachCell(c => {
      c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RIEMPI.head } }
      c.alignment = CENTRO
      c.border = BORDO
    })

    for (const e of dip) {
      const giorni = griglia.get(e.id) ?? []
      let tot = 0, lavorati = 0
      const valori: (string | number | null)[] = giorni.map(g => {
        if (!g) return null
        if (g.tipo === 'assenza') return g.codice
        const h = Math.round(g.minuti / 60 * 100) / 100
        tot += h
        if (g.minuti > 0) lavorati++
        // PP: oltre 12 ore lavorate nel giorno (doppio turno)
        return P ? (g.minuti > MINUTI_DOPPIO_TURNO ? 'PP' : 'P') : h
      })
      // Differenza: ore lavorate meno le 8,5 attese per ogni giorno lavorato
      const diff = Math.round((tot - lavorati * ORE_ATTESE_GIORNO) * 100) / 100
      const riga = sheet.addRow([e.full_name, ...valori, ...(P ? [] : [Math.round(tot * 100) / 100, diff])])
      riga.height = 20
      riga.getCell(1).alignment = { vertical: 'middle' }
      riga.getCell(1).border = BORDO
      for (let d = 0; d < nd; d++) {
        const c = riga.getCell(d + 2), v = valori[d]
        c.alignment = CENTRO
        c.border = BORDO
        if (typeof v === 'string') {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RIEMPI[v] } }
          c.font = { bold: true, color: { argb: 'FF1A1A1A' } }
        } else if (typeof v === 'number') {
          // Nel design le ore stanno sul verde della presenza
          c.numFmt = '0.0#'
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RIEMPI.P } }
        }
      }
      if (!P) {
        const c = riga.getCell(nd + 2)
        c.numFmt = '0.0#'
        c.font = { bold: true, color: { argb: 'FF1A1A1A' } }
        c.alignment = CENTRO
        c.border = BORDO
        const d = riga.getCell(nd + 3)
        d.numFmt = '+0.0#;-0.0#;0'
        d.font = { bold: true, color: { argb: diff > 0 ? 'FF166534' : diff < 0 ? 'FF991B1B' : 'FF1A1A1A' } }
        d.alignment = CENTRO
        d.border = BORDO
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
