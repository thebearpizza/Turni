import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'

const TZ = 'Europe/Rome'

interface SpesaRow {
  nome_spesa: string
  importo: number
  categoria: { nome: string } | null
}

// POST /api/cassa/chiusura-export
// Body: { chiusura_id: string }
// Manager-only (la RLS di cassa_chiusure scoped su can_manage_restaurant
// restituisce solo le chiusure dei ristoranti che questo manager gestisce).
//
// Solo PDF, solo tabelle: niente più scelta di formato né grafici
// incorporati. Generarli (next/og + Excel) era il punto più pesante in CPU
// di tutta l'app — ogni export li ricalcolava da zero, aperto o no il file
// risultante — a fronte di un valore marginale su un documento pensato per
// essere stampato/archiviato, non consultato come dashboard.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'manager') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { chiusura_id } = await request.json()
  if (!chiusura_id) {
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

  const pdfBytes = await buildPdf(chiusura, restaurantName, dataLabel, (spese ?? []) as unknown as SpesaRow[])
  return new NextResponse(new Uint8Array(pdfBytes) as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="chiusura-${safeName}-${chiusura.data}.pdf"`,
    },
  })
}

// Palette "Ledger" del design system Cassa, convertita da HSL (globals.css,
// scope .cassa) a RGB 0-1 per pdf-lib — stessi valori, altro spazio colore.
const PDF_COLORS = {
  primary: [0.143, 0.377, 0.268] as const,
  primaryForeground: [0.966, 0.956, 0.934] as const,
  copper: [0.651, 0.328, 0.189] as const,
  positiveBg: [0.888, 0.952, 0.922] as const,
  negativeBg: [0.973, 0.916, 0.907] as const,
  positiveText: [0.165, 0.435, 0.309] as const,
  negativeText: [0.664, 0.241, 0.176] as const,
  mutedFg: [0.35, 0.41, 0.38] as const,
  border: [0.852, 0.833, 0.788] as const,
  paper: [0.966, 0.956, 0.934] as const,
  ink: [0.115, 0.165, 0.14] as const,
  white: [1, 1, 1] as const,
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
  const CONTENT_W = PAGE_W - MARGIN * 2
  const c = (rgbTuple: readonly [number, number, number]) => rgb(...rgbTuple)

  let page = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - MARGIN
  }

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) newPage()
  }

  // Testata: banda verde ledger con nome locale, data e uno "stamp" di
  // stato — sostituisce il documento bianco/nero attuale.
  function drawHeader() {
    const BAND_H = 108
    page.drawRectangle({ x: 0, y: PAGE_H - BAND_H, width: PAGE_W, height: BAND_H, color: c(PDF_COLORS.primary) })

    page.drawText('C A S S A', { x: MARGIN, y: PAGE_H - 32, size: 9, font: bold, color: c(PDF_COLORS.copper) })
    page.drawText(restaurantName, { x: MARGIN, y: PAGE_H - 58, size: 22, font: bold, color: c(PDF_COLORS.primaryForeground) })
    page.drawText(dataLabel, { x: MARGIN, y: PAGE_H - 78, size: 12, font, color: c(PDF_COLORS.primaryForeground) })

    const stato = chiusura.stato === 'confermata' ? 'CONFERMATA' : 'BOZZA'
    const stampW = bold.widthOfTextAtSize(stato, 10) + 20
    const stampX = PAGE_W - MARGIN - stampW
    page.drawRectangle({
      x: stampX, y: PAGE_H - 46, width: stampW, height: 22,
      color: chiusura.stato === 'confermata' ? c(PDF_COLORS.copper) : c(PDF_COLORS.white),
      opacity: chiusura.stato === 'confermata' ? 1 : 0.25,
    })
    page.drawText(stato, {
      x: stampX + 10, y: PAGE_H - 40, size: 10, font: bold,
      color: chiusura.stato === 'confermata' ? c(PDF_COLORS.primaryForeground) : c(PDF_COLORS.primaryForeground),
    })

    // Elemento firma: bordo "a strappo" (stessa idea del cassa-perforated-top
    // CSS) appena sotto la banda, invece di una riga piena qualunque.
    const dashY = PAGE_H - BAND_H - 1
    for (let x = 0; x < PAGE_W; x += 9) {
      page.drawLine({ start: { x, y: dashY }, end: { x: x + 5, y: dashY }, thickness: 1.5, color: c(PDF_COLORS.copper), opacity: 0.55 })
    }

    y = PAGE_H - BAND_H - 26
  }

  function sectionTitle(text: string) {
    ensureSpace(30)
    page.drawText(text, { x: MARGIN, y, size: 13, font: bold, color: c(PDF_COLORS.primary) })
    page.drawLine({ start: { x: MARGIN, y: y - 6 }, end: { x: MARGIN + 42, y: y - 6 }, thickness: 2, color: c(PDF_COLORS.copper) })
    y -= 24
  }

  let rowIndex = 0
  function row(label: string, value: string, opts: { emphasis?: boolean; color?: readonly [number, number, number]; size?: number } = {}) {
    const ROW_H = 20
    ensureSpace(ROW_H)
    if (rowIndex % 2 === 0) {
      page.drawRectangle({ x: MARGIN, y: y - 5, width: CONTENT_W, height: ROW_H, color: c(PDF_COLORS.paper) })
    }
    const size = opts.size ?? (opts.emphasis ? 11.5 : 10.5)
    page.drawText(label, { x: MARGIN + 8, y, size, font: opts.emphasis ? bold : font, color: c(PDF_COLORS.mutedFg) })
    const valueFont = opts.emphasis ? bold : font
    const valueColor = opts.color ? c(opts.color) : opts.emphasis ? c(PDF_COLORS.primary) : c(PDF_COLORS.ink)
    const valueW = valueFont.widthOfTextAtSize(value, size)
    page.drawText(value, { x: MARGIN + CONTENT_W - 8 - valueW, y, size, font: valueFont, color: valueColor })
    y -= ROW_H
    rowIndex += 1
  }

  function spacer(h = 14) { y -= h }

  const euro = (n: number) => `€ ${Number(n).toFixed(2)}`

  drawHeader()

  sectionTitle('Entrate')
  row('Entrate Contanti', euro(chiusura.entrate_contanti))
  row('Entrate POS', euro(chiusura.entrate_pos))
  row('Entrate Bonifico', euro(chiusura.entrate_bonifico))
  row('Totale Entrate', euro(chiusura.totale_entrate), { emphasis: true, size: 14 })
  spacer()

  sectionTitle('Cassa')
  row('Fondo Cassa Iniziale', euro(chiusura.fondo_cassa_iniziale))
  row('Fondo Cassa Finale', euro(chiusura.fondo_cassa_finale))
  row('Totale Spese Giornaliere', euro(chiusura.totale_spese_giornaliere))
  row('Contanti per Banca', euro(chiusura.contanti_per_banca), { emphasis: true })
  spacer(8)

  const isBalanced = Math.abs(chiusura.differenza) < 0.005
  const diffLabel = isBalanced ? '0,00 €' : `${chiusura.differenza > 0 ? '+' : ''}${euro(chiusura.differenza)}`
  ensureSpace(44)
  page.drawRectangle({
    x: MARGIN, y: y - 32, width: CONTENT_W, height: 44,
    color: isBalanced ? c(PDF_COLORS.positiveBg) : c(PDF_COLORS.negativeBg),
  })
  page.drawText('Differenza', { x: MARGIN + 12, y: y - 10, size: 11, font: bold, color: isBalanced ? c(PDF_COLORS.positiveText) : c(PDF_COLORS.negativeText) })
  const diffFontSize = 12
  const diffW = bold.widthOfTextAtSize(diffLabel, diffFontSize)
  page.drawText(diffLabel, {
    x: MARGIN + CONTENT_W - 12 - diffW, y: y - 12, size: diffFontSize, font: bold,
    color: isBalanced ? c(PDF_COLORS.positiveText) : c(PDF_COLORS.negativeText),
  })
  y -= 60

  sectionTitle('Statistiche')
  row('Coperti', String(chiusura.coperti))
  row('Incasso Asporto', euro(chiusura.incasso_asporto))
  row('Media Scontrino', chiusura.coperti === 0 ? '—' : euro(chiusura.media_scontrino))
  spacer()

  sectionTitle('Spese')
  if (spese.length === 0) {
    ensureSpace(20)
    page.drawText('Nessuna spesa registrata.', { x: MARGIN + 8, y, size: 10.5, font, color: c(PDF_COLORS.mutedFg) })
    y -= 20
  } else {
    for (const s of spese) {
      row(s.nome_spesa + (s.categoria?.nome ? `  ·  ${s.categoria.nome}` : ''), euro(s.importo))
    }
  }
  spacer()

  // Footer su ogni pagina (non solo l'ultima, per chiusure con molte spese
  // che sforano su più pagine), con numerazione se ce n'è più di una.
  const footerY = MARGIN - 4
  const pages = doc.getPages()
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: footerY + 14 }, end: { x: PAGE_W - MARGIN, y: footerY + 14 }, thickness: 0.5, color: c(PDF_COLORS.border) })
    p.drawText('Generato da inTurno · Cassa', { x: MARGIN, y: footerY, size: 8, font, color: c(PDF_COLORS.mutedFg) })
    if (pages.length > 1) {
      const pageLabel = `Pagina ${i + 1} di ${pages.length}`
      const pageLabelW = font.widthOfTextAtSize(pageLabel, 8)
      p.drawText(pageLabel, { x: PAGE_W - MARGIN - pageLabelW, y: footerY, size: 8, font, color: c(PDF_COLORS.mutedFg) })
    }
  })

  return doc.save()
}
