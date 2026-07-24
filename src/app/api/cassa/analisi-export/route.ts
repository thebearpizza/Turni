import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'

const TZ = 'Europe/Rome'

interface ChiusuraRow {
  data: string
  restaurant_name: string
  fondo_cassa_iniziale: number
  entrate_contanti: number
  entrate_pos: number
  entrate_bonifico: number
  totale_entrate: number
  coperti: number
  incasso_asporto: number
  media_scontrino: number
  fondo_cassa_finale: number
  totale_spese_giornaliere: number
  contanti_per_banca: number
  banca_teorica: number
  differenza: number
}

interface Confronto {
  restaurant_name: string
  giorni: number
  totaleEntrate: number
  mediaEntrate: number
  totaleSpese: number
  mediaSpese: number
  totaleDifferenza: number
}

// POST /api/cassa/analisi-export
// Body: { restaurant_ids: string[], start: string, end: string, format: 'pdf' | 'xlsx' }
// Manager-only. Esporta le chiusure confermate filtrate nel Modulo
// Analisi (stesso filtro ristoranti/periodo mostrato a schermo), con un
// riepilogo di confronto per ristorante — sul modello dell'export
// Excel già usato in /api/report.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'manager') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { restaurant_ids, start, end, format } = await request.json()
  if (!Array.isArray(restaurant_ids) || !restaurant_ids.length || !start || !end || !['pdf', 'xlsx'].includes(format)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  const { data } = await supabase
    .from('cassa_chiusure')
    .select('*, restaurant:restaurants(name)')
    .in('restaurant_id', restaurant_ids)
    .eq('stato', 'confermata')
    .gte('data', start)
    .lte('data', end)
    .order('data')

  const rows: ChiusuraRow[] = ((data ?? []) as unknown as Array<Record<string, unknown> & { restaurant: { name: string } | null }>)
    .map(r => ({
      data: r.data as string,
      restaurant_name: r.restaurant?.name ?? '—',
      fondo_cassa_iniziale: r.fondo_cassa_iniziale as number,
      entrate_contanti: r.entrate_contanti as number,
      entrate_pos: r.entrate_pos as number,
      entrate_bonifico: r.entrate_bonifico as number,
      totale_entrate: r.totale_entrate as number,
      coperti: r.coperti as number,
      incasso_asporto: r.incasso_asporto as number,
      media_scontrino: r.media_scontrino as number,
      fondo_cassa_finale: r.fondo_cassa_finale as number,
      totale_spese_giornaliere: r.totale_spese_giornaliere as number,
      contanti_per_banca: r.contanti_per_banca as number,
      banca_teorica: r.banca_teorica as number,
      differenza: r.differenza as number,
    }))

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Nessuna chiusura confermata nel periodo selezionato' }, { status: 404 })
  }

  const confronti = buildConfronti(rows)
  const periodLabel = `${formatInTimeZone(`${start}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })} — ${formatInTimeZone(`${end}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })}`

  if (format === 'xlsx') {
    const buffer = await buildXlsx(rows, confronti, periodLabel)
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="analisi-cassa-${start}_${end}.xlsx"`,
      },
    })
  }

  const pdfBytes = await buildPdf(rows, confronti, periodLabel)
  return new NextResponse(new Uint8Array(pdfBytes) as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="analisi-cassa-${start}_${end}.pdf"`,
    },
  })
}

function buildConfronti(rows: ChiusuraRow[]): Confronto[] {
  const byRestaurant = new Map<string, { giorni: number; totaleEntrate: number; totaleSpese: number; totaleDifferenza: number }>()
  for (const r of rows) {
    let g = byRestaurant.get(r.restaurant_name)
    if (!g) { g = { giorni: 0, totaleEntrate: 0, totaleSpese: 0, totaleDifferenza: 0 }; byRestaurant.set(r.restaurant_name, g) }
    g.giorni += 1
    g.totaleEntrate += r.totale_entrate
    g.totaleSpese += r.totale_spese_giornaliere
    g.totaleDifferenza += r.differenza
  }
  return Array.from(byRestaurant.entries())
    .map(([restaurant_name, g]) => ({
      restaurant_name,
      giorni: g.giorni,
      totaleEntrate: g.totaleEntrate,
      mediaEntrate: g.totaleEntrate / g.giorni,
      totaleSpese: g.totaleSpese,
      mediaSpese: g.totaleSpese / g.giorni,
      totaleDifferenza: g.totaleDifferenza,
    }))
    .sort((a, b) => b.totaleEntrate - a.totaleEntrate)
}

async function buildXlsx(rows: ChiusuraRow[], confronti: Confronto[], periodLabel: string) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'inTurno'
  workbook.created = new Date()

  const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF0F172A' } }
  const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } }

  const detailSheet = workbook.addWorksheet('Chiusure')
  const detailHeaders = [
    'Data', 'Locale', 'Fondo Iniziale', 'Entrate Contanti', 'Entrate POS', 'Entrate Bonifico',
    'Totale Entrate', 'Coperti', 'Incasso Asporto', 'Media Scontrino', 'Fondo Finale',
    'Totale Spese', 'Contanti per Banca', 'Banca Teorica', 'Differenza',
  ]
  const detailHeaderRow = detailSheet.addRow(detailHeaders)
  detailHeaderRow.font = HEADER_FONT
  detailHeaderRow.fill = HEADER_FILL
  detailSheet.columns.forEach(col => { col.width = 16 })
  detailSheet.getColumn(2).width = 22
  detailSheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const r of rows) {
    detailSheet.addRow([
      r.data, r.restaurant_name, r.fondo_cassa_iniziale, r.entrate_contanti, r.entrate_pos, r.entrate_bonifico,
      r.totale_entrate, r.coperti, r.incasso_asporto, r.coperti === 0 ? '—' : r.media_scontrino, r.fondo_cassa_finale,
      r.totale_spese_giornaliere, r.contanti_per_banca, r.banca_teorica, r.differenza,
    ])
  }

  const summarySheet = workbook.addWorksheet('Confronto per ristorante')
  summarySheet.addRow([`Periodo: ${periodLabel}`]).font = { bold: true, size: 12 }
  summarySheet.addRow([])
  const summaryHeaderRow = summarySheet.addRow(['Ristorante', 'Giorni', 'Totale Entrate', 'Media Entrate/Giorno', 'Totale Spese', 'Media Spese/Giorno', 'Differenza Totale'])
  summaryHeaderRow.font = HEADER_FONT
  summaryHeaderRow.fill = HEADER_FILL
  summarySheet.columns.forEach(col => { col.width = 18 })
  summarySheet.getColumn(1).width = 24

  for (const c of confronti) {
    summarySheet.addRow([c.restaurant_name, c.giorni, c.totaleEntrate, c.mediaEntrate, c.totaleSpese, c.mediaSpese, c.totaleDifferenza])
  }

  return workbook.xlsx.writeBuffer()
}

async function buildPdf(rows: ChiusuraRow[], confronti: Confronto[], periodLabel: string) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const PAGE_W = 841.89 // A4 landscape, per fare stare più colonne
  const PAGE_H = 595.28
  const MARGIN = 40
  let page = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN

  function ensureSpace(size: number) {
    if (y < MARGIN + size) {
      page = doc.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - MARGIN
    }
  }

  function text(str: string, x: number, opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {}) {
    page.drawText(str, {
      x, y, size: opts.size ?? 10,
      font: opts.bold ? bold : font,
      color: opts.color ? rgb(...opts.color) : rgb(0.1, 0.1, 0.1),
    })
  }

  function heading(str: string, size = 16) {
    ensureSpace(size + 10)
    text(str, MARGIN, { size, bold: true })
    y -= size + 12
  }

  const euro = (n: number) => `€ ${Number(n).toFixed(2)}`

  heading('Analisi Cassa')
  ensureSpace(12)
  text(`Periodo: ${periodLabel}`, MARGIN, { size: 11 })
  y -= 24

  // ── Confronto per ristorante ──────────────────────────────────────
  heading('Confronto per ristorante', 13)
  const summaryCols = [
    { label: 'Ristorante', x: MARGIN, w: 160 },
    { label: 'Giorni', x: MARGIN + 160, w: 50 },
    { label: 'Totale Entrate', x: MARGIN + 210, w: 100 },
    { label: 'Media Entrate/Gg', x: MARGIN + 310, w: 100 },
    { label: 'Totale Spese', x: MARGIN + 410, w: 100 },
    { label: 'Differenza Totale', x: MARGIN + 510, w: 100 },
  ]
  ensureSpace(14)
  for (const c of summaryCols) text(c.label, c.x, { size: 9, bold: true })
  y -= 16
  for (const c of confronti) {
    ensureSpace(12)
    text(c.restaurant_name, summaryCols[0].x, { size: 9 })
    text(String(c.giorni), summaryCols[1].x, { size: 9 })
    text(euro(c.totaleEntrate), summaryCols[2].x, { size: 9 })
    text(euro(c.mediaEntrate), summaryCols[3].x, { size: 9 })
    text(euro(c.totaleSpese), summaryCols[4].x, { size: 9 })
    const balanced = Math.abs(c.totaleDifferenza) < 0.005
    text(balanced ? '0,00 €' : `${c.totaleDifferenza > 0 ? '+' : ''}${euro(c.totaleDifferenza)}`, summaryCols[5].x, {
      size: 9, bold: true, color: balanced ? [0.02, 0.5, 0.3] : [0.7, 0.1, 0.1],
    })
    y -= 14
  }
  y -= 20

  // ── Dettaglio chiusure ─────────────────────────────────────────────
  heading('Dettaglio chiusure', 13)
  const detailCols = [
    { label: 'Data', x: MARGIN, w: 70 },
    { label: 'Locale', x: MARGIN + 70, w: 140 },
    { label: 'Entrate', x: MARGIN + 210, w: 90 },
    { label: 'Spese', x: MARGIN + 300, w: 90 },
    { label: 'Contanti/Banca', x: MARGIN + 390, w: 90 },
    { label: 'Banca Teorica', x: MARGIN + 480, w: 90 },
    { label: 'Differenza', x: MARGIN + 570, w: 90 },
  ]

  function drawDetailHeader() {
    ensureSpace(14)
    for (const c of detailCols) text(c.label, c.x, { size: 9, bold: true })
    y -= 16
  }
  drawDetailHeader()

  for (const r of rows) {
    if (y < MARGIN + 12) { drawDetailHeader() }
    ensureSpace(12)
    text(r.data, detailCols[0].x, { size: 9 })
    text(r.restaurant_name, detailCols[1].x, { size: 9 })
    text(euro(r.totale_entrate), detailCols[2].x, { size: 9 })
    text(euro(r.totale_spese_giornaliere), detailCols[3].x, { size: 9 })
    text(euro(r.contanti_per_banca), detailCols[4].x, { size: 9 })
    text(euro(r.banca_teorica), detailCols[5].x, { size: 9 })
    const balanced = Math.abs(r.differenza) < 0.005
    text(balanced ? '0,00 €' : `${r.differenza > 0 ? '+' : ''}${euro(r.differenza)}`, detailCols[6].x, {
      size: 9, bold: true, color: balanced ? [0.02, 0.5, 0.3] : [0.7, 0.1, 0.1],
    })
    y -= 14
  }

  return doc.save()
}
