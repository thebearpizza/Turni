import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'

const TZ = 'Europe/Rome'

interface SpesaRow {
  nome_spesa: string
  importo: number
  categoria: { nome: string } | null
}

// POST /api/cassa/chiusura-export
// Body: { chiusura_id: string, format: 'pdf' | 'xlsx' }
// Manager-only (la RLS di cassa_chiusure scoped su can_manage_restaurant
// restituisce solo le chiusure dei ristoranti che questo manager gestisce).
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'manager') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { chiusura_id, format } = await request.json()
  if (!chiusura_id || !['pdf', 'xlsx'].includes(format)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  const { data: chiusura } = await supabase
    .from('cassa_chiusure')
    .select('*, restaurant:restaurants(name)')
    .eq('id', chiusura_id)
    .maybeSingle()

  if (!chiusura) return NextResponse.json({ error: 'Chiusura non trovata o non autorizzata' }, { status: 404 })

  const { data: spese } = await supabase
    .from('cassa_spese')
    .select('nome_spesa, importo, categoria:cassa_categorie(nome)')
    .eq('chiusura_id', chiusura_id)
    .order('created_at')

  const restaurantName = (chiusura.restaurant as unknown as { name: string } | null)?.name ?? 'ristorante'
  const dataLabel = formatInTimeZone(`${chiusura.data}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })
  const safeName = restaurantName.replace(/[^a-zA-Z0-9]+/g, '-')

  if (format === 'xlsx') {
    const buffer = await buildXlsx(chiusura, restaurantName, dataLabel, (spese ?? []) as unknown as SpesaRow[])
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="chiusura-${safeName}-${chiusura.data}.xlsx"`,
      },
    })
  }

  const pdfBytes = await buildPdf(chiusura, restaurantName, dataLabel, (spese ?? []) as unknown as SpesaRow[])
  return new NextResponse(new Uint8Array(pdfBytes) as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="chiusura-${safeName}-${chiusura.data}.pdf"`,
    },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildXlsx(chiusura: any, restaurantName: string, dataLabel: string, spese: SpesaRow[]) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'inTurno'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Chiusura Cassa')

  sheet.getColumn(1).width = 26
  sheet.getColumn(2).width = 16
  sheet.getColumn(3).width = 16

  const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF0F172A' } }
  const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } }

  const title = sheet.addRow([`Chiusura Cassa — ${restaurantName} — ${dataLabel}`])
  title.font = { bold: true, size: 14 }
  sheet.mergeCells(1, 1, 1, 3)
  sheet.addRow([])

  const fieldHeader = sheet.addRow(['Campo', 'Valore'])
  fieldHeader.font = HEADER_FONT
  fieldHeader.fill = HEADER_FILL

  const fieldRows: [string, string | number][] = [
    ['Fondo Cassa Iniziale', chiusura.fondo_cassa_iniziale],
    ['Entrate Contanti', chiusura.entrate_contanti],
    ['Entrate POS', chiusura.entrate_pos],
    ['Entrate Bonifico', chiusura.entrate_bonifico],
    ['Totale Entrate', chiusura.totale_entrate],
    ['Coperti', chiusura.coperti],
    ['Incasso Asporto', chiusura.incasso_asporto],
    ['Media Scontrino', chiusura.coperti === 0 ? '—' : chiusura.media_scontrino],
    ['Fondo Cassa Finale', chiusura.fondo_cassa_finale],
    ['Totale Spese Giornaliere', chiusura.totale_spese_giornaliere],
    ['Contanti per Banca', chiusura.contanti_per_banca],
    ['Banca Teorica', chiusura.banca_teorica],
    ['Differenza', chiusura.differenza],
    ['Stato', chiusura.stato === 'confermata' ? 'Confermata' : 'Bozza'],
  ]
  for (const [label, value] of fieldRows) sheet.addRow([label, value])

  sheet.addRow([])
  const speseHeader = sheet.addRow(['Spesa', 'Categoria', 'Importo'])
  speseHeader.font = HEADER_FONT
  speseHeader.fill = HEADER_FILL

  if (spese.length === 0) {
    sheet.addRow(['Nessuna spesa registrata', '', ''])
  } else {
    for (const s of spese) sheet.addRow([s.nome_spesa, s.categoria?.nome ?? '', s.importo])
  }

  return workbook.xlsx.writeBuffer()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildPdf(chiusura: any, restaurantName: string, dataLabel: string, spese: SpesaRow[]) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const PAGE_W = 595.28
  const PAGE_H = 841.89
  const MARGIN = 48
  let page = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN

  function line(text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gapAfter?: number } = {}) {
    const size = opts.size ?? 11
    if (y < MARGIN + size) {
      page = doc.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - MARGIN
    }
    page.drawText(text, {
      x: MARGIN,
      y,
      size,
      font: opts.bold ? bold : font,
      color: opts.color ? rgb(...opts.color) : rgb(0.1, 0.1, 0.1),
    })
    y -= size + (opts.gapAfter ?? 8)
  }

  const euro = (n: number) => `€ ${Number(n).toFixed(2)}`

  line('Chiusura Cassa', { size: 18, bold: true })
  line(`${restaurantName} — ${dataLabel}`, { size: 13, gapAfter: 16 })

  line('Entrate', { size: 13, bold: true })
  line(`Fondo Cassa Iniziale: ${euro(chiusura.fondo_cassa_iniziale)}`)
  line(`Entrate Contanti: ${euro(chiusura.entrate_contanti)}`)
  line(`Entrate POS: ${euro(chiusura.entrate_pos)}`)
  line(`Entrate Bonifico: ${euro(chiusura.entrate_bonifico)}`)
  line(`Totale Entrate: ${euro(chiusura.totale_entrate)}`, { bold: true })
  line(`Coperti: ${chiusura.coperti}`)
  line(`Incasso Asporto: ${euro(chiusura.incasso_asporto)}`)
  line(`Media Scontrino: ${chiusura.coperti === 0 ? '—' : euro(chiusura.media_scontrino)}`)
  line(`Fondo Cassa Finale: ${euro(chiusura.fondo_cassa_finale)}`, { gapAfter: 16 })

  line('Spese', { size: 13, bold: true })
  if (spese.length === 0) {
    line('Nessuna spesa registrata.')
  } else {
    for (const s of spese) {
      line(`${s.nome_spesa}${s.categoria?.nome ? ` (${s.categoria.nome})` : ''}: ${euro(s.importo)}`)
    }
  }
  line(`Totale Spese Giornaliere: ${euro(chiusura.totale_spese_giornaliere)}`, { bold: true, gapAfter: 16 })

  line('Quadratura', { size: 13, bold: true })
  line(`Banca Teorica: ${euro(chiusura.banca_teorica)}`)
  line(`Contanti per Banca: ${euro(chiusura.contanti_per_banca)}`)
  const isBalanced = Math.abs(chiusura.differenza) < 0.005
  line(`Differenza: ${isBalanced ? '0,00 €' : `${chiusura.differenza > 0 ? '+' : ''}${euro(chiusura.differenza)}`}`, {
    bold: true,
    color: isBalanced ? [0.02, 0.5, 0.3] : [0.7, 0.1, 0.1],
    gapAfter: 16,
  })
  line(`Stato: ${chiusura.stato === 'confermata' ? 'Confermata' : 'Bozza'}`)

  return doc.save()
}
