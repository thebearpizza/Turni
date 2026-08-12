import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ImageResponse } from 'next/og'
import { createElement as h, type ReactElement } from 'react'
import ExcelJS from 'exceljs'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'

const TZ = 'Europe/Rome'

interface SpesaRow {
  nome_spesa: string
  importo: number
  categoria: { nome: string } | null
}

// Palette qualitativa "Ledger" per i grafici — stessi colori del
// CategorieBreakdownChart lato client, per coerenza tra app ed export.
const CHART_QUALITATIVE = ['#266044', '#A65430', '#8A6D3B', '#4A6670', '#7C5C4B', '#A8763E', '#5E7A5A', '#9C4B3D']
const CHART_BG = '#F6F4EE'
const CHART_INK = '#1E2B24'
const CHART_MUTED = '#5A6B60'

// ExcelJS 4.4 non ha un'API per grafici nativi (nessun addChart, verificato
// nei type-def del pacchetto installato): l'unica via reale è incorporare
// immagini via workbook.addImage/worksheet.addImage (e, per il PDF,
// doc.embedPng + drawImage). Le immagini sono generate qui con next/og
// (Satori — nessuna dipendenza nativa tipo canvas, funziona in un runtime
// Node/Vercel senza binari extra).
async function renderChartPng(el: ReactElement, width: number, height: number): Promise<Buffer> {
  const res = new ImageResponse(el, { width, height })
  return Buffer.from(await res.arrayBuffer())
}

// Un grafico generato per l'export: il buffer PNG è renderizzato a
// RENDER_SCALE volte le dimensioni "di visualizzazione" (width/height,
// quelle da usare per l'embed in Excel/PDF) — più pixel sorgente della
// dimensione mostrata, cosi' il grafico resta nitido invece di sfocarsi
// quando incorporato/stampato (lo stesso principio delle immagini
// "retina"). width/height qui sono SEMPRE quelle da passare a
// worksheet.addImage/drawImage, mai le dimensioni del buffer.
interface ChartAsset {
  buffer: Buffer
  width: number
  height: number
}

// Fattore di sovracampionamento: 2x è già nitido a schermo e in stampa
// senza generare PNG eccessivamente pesanti per un export manuale.
const RENDER_SCALE = 2

async function buildPaymentChartPng(entrateContanti: number, entratePos: number, entrateBonifico: number): Promise<ChartAsset | null> {
  const totale = entrateContanti + entratePos + entrateBonifico
  if (totale <= 0) return null

  const segments = [
    { label: 'Contanti', value: entrateContanti, color: CHART_QUALITATIVE[0] },
    { label: 'POS', value: entratePos, color: CHART_QUALITATIVE[1] },
    { label: 'Bonifico', value: entrateBonifico, color: CHART_QUALITATIVE[3] },
  ].filter(s => s.value > 0)

  // Dimensioni "di visualizzazione" (quelle usate per l'embed) — il render
  // effettivo avviene a RENDER_SCALE volte queste, vedi ChartAsset sopra.
  // L'altezza deve coprire per intero padding + titolo + barra + blocco
  // legenda (dot/etichetta, importo, percentuale): un valore troppo
  // stretto qui non "schiaccia" il contenuto (le altezze sotto sono
  // fisse in px) ma lo TAGLIA, perché next/og renderizza esattamente il
  // canvas richiesto senza scroll — la percentuale in fondo spariva
  // proprio per questo. Il margine sotto il titolo è volutamente
  // generoso: il line-height reale del font usato in produzione (satori
  // su Vercel) rende meno spazio "leading" sotto il testo di quanto
  // sembri in anteprima locale, e la "g" di "Pagamento" arrivava quasi a
  // toccare la barra.
  const WIDTH = 360
  const HEIGHT = 218
  const s = (n: number) => n * RENDER_SCALE

  const el = h(
    'div',
    { style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: CHART_BG, padding: `${s(28)}px`, fontFamily: 'sans-serif' } },
    h('div', { style: { display: 'flex', fontSize: s(22), fontWeight: 700, color: CHART_QUALITATIVE[0], marginBottom: s(40) } }, 'Pagamento'),
    h(
      'div',
      { style: { display: 'flex', width: '100%', height: s(44), borderRadius: s(8), overflow: 'hidden' } },
      ...segments.map(seg => h('div', { key: seg.label, style: { display: 'flex', width: `${(seg.value / totale) * 100}%`, height: '100%', backgroundColor: seg.color } }))
    ),
    h(
      'div',
      { style: { display: 'flex', marginTop: s(22), gap: s(24) } },
      ...segments.map(seg =>
        h(
          'div',
          { key: seg.label, style: { display: 'flex', flexDirection: 'column' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: s(6) } },
            h('div', { style: { display: 'flex', width: s(10), height: s(10), borderRadius: s(5), backgroundColor: seg.color } }),
            h('div', { style: { display: 'flex', fontSize: s(13), color: CHART_MUTED } }, seg.label)
          ),
          h('div', { style: { display: 'flex', fontSize: s(16), fontWeight: 700, color: CHART_INK, marginTop: s(3) } }, `€ ${seg.value.toFixed(2)}`),
          h('div', { style: { display: 'flex', fontSize: s(11), color: CHART_MUTED } }, `${((seg.value / totale) * 100).toFixed(0)}%`)
        )
      )
    )
  )

  const buffer = await renderChartPng(el, s(WIDTH), s(HEIGHT))
  return { buffer, width: WIDTH, height: HEIGHT }
}

async function buildCategoryChartPng(spese: SpesaRow[]): Promise<ChartAsset | null> {
  if (spese.length === 0) return null

  const byCategoria = new Map<string, number>()
  for (const sp of spese) {
    const nome = sp.categoria?.nome ?? 'Senza categoria'
    byCategoria.set(nome, (byCategoria.get(nome) ?? 0) + sp.importo)
  }
  const entries = Array.from(byCategoria.entries())
    .map(([nome, totale]) => ({ nome, totale }))
    .sort((a, b) => b.totale - a.totale)
    .slice(0, 8)
  const max = Math.max(...entries.map(e => e.totale))

  // Dimensioni "di visualizzazione" calcolate dal numero di categorie:
  // usate SIA per il layout interno (barre/colonne) SIA per l'embed in
  // Excel/PDF, cosi' l'aspect ratio incorporato coincide sempre con
  // quello effettivamente renderizzato — prima la larghezza dipendeva dal
  // numero di categorie ma l'embed usava un box fisso 360x180,
  // deformando il grafico ("schiacciato") ogni volta che l'aspect ratio
  // reale non era esattamente 2:1.
  const COL_W = 60
  const COL_GAP = 14
  const PADDING = 24
  // La riga delle barre riserva SEMPRE lo spazio per l'etichetta importo
  // sopra la barra (VALUE_LABEL_H), cosi' anche la barra più alta (quella
  // al 100% di BAR_MAX_H) non trabocca oltre l'altezza fissa della riga.
  const VALUE_LABEL_H = 20
  const BAR_MAX_H = 90
  const BARS_ROW_H = VALUE_LABEL_H + BAR_MAX_H
  const LABEL_ROW_H = 16
  const TITLE_ROW_H = 34
  // Minimo alzato da 220 a 300: con una sola categoria (o poche) il box
  // poteva restare più stretto del titolo "Spese per categoria" a
  // fontSize 20, che andava a capo su due righe pur avendo un'altezza di
  // riga fissa (TITLE_ROW_H) tarata per una riga sola — le righe
  // sottostanti finivano schiacciate/sovrapposte dal testo traboccante.
  const WIDTH = Math.max(300, entries.length * (COL_W + COL_GAP) - COL_GAP + PADDING * 2)
  const HEIGHT = PADDING * 2 + TITLE_ROW_H + BARS_ROW_H + 8 + LABEL_ROW_H
  const s = (n: number) => n * RENDER_SCALE
  // Troncamento più corto del precedente: a fontSize 10 su una colonna di
  // 60px una decina di caratteri è il limite per restare su una riga
  // sola — oltre, il testo andava a capo su due righe e sballava
  // l'altezza calcolata sopra.
  const truncate = (nome: string) => nome.length > 10 ? `${nome.slice(0, 9)}…` : nome

  const el = h(
    'div',
    { style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: CHART_BG, padding: `${s(PADDING)}px`, fontFamily: 'sans-serif' } },
    h('div', { style: { display: 'flex', height: s(TITLE_ROW_H), alignItems: 'center', fontSize: s(20), fontWeight: 700, color: CHART_QUALITATIVE[0], whiteSpace: 'nowrap' } }, 'Spese per categoria'),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-end', height: s(BARS_ROW_H), gap: s(COL_GAP) } },
      ...entries.map((e, i) =>
        h(
          'div',
          { key: e.nome, style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', width: s(COL_W) } },
          h('div', { style: { display: 'flex', fontSize: s(12), color: CHART_INK, marginBottom: s(4) } }, `€ ${e.totale.toFixed(0)}`),
          h('div', {
            style: {
              display: 'flex', width: s(34), height: Math.max(s(6), (e.totale / max) * s(BAR_MAX_H)),
              backgroundColor: CHART_QUALITATIVE[i % CHART_QUALITATIVE.length], borderRadius: `${s(5)}px ${s(5)}px 0 0`,
            },
          })
        )
      )
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'row', gap: s(COL_GAP), marginTop: s(8), height: s(LABEL_ROW_H) } },
      ...entries.map(e =>
        h(
          'div',
          { key: e.nome, style: { display: 'flex', width: s(COL_W), fontSize: s(10), color: CHART_MUTED, textAlign: 'center', justifyContent: 'center' } },
          truncate(e.nome)
        )
      )
    )
  )

  const buffer = await renderChartPng(el, s(WIDTH), s(HEIGHT))
  return { buffer, width: WIDTH, height: HEIGHT }
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

  // Palette "Ledger" del design system Cassa invece del navy generico.
  const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF266044' } }
  const HEADER_FONT = { bold: true, color: { argb: 'FFF6F4EE' } }
  const TITLE_FONT = { bold: true, size: 14, color: { argb: 'FF266044' } }

  const title = sheet.addRow([`Chiusura Cassa — ${restaurantName} — ${dataLabel}`])
  title.font = TITLE_FONT
  sheet.mergeCells(1, 1, 1, 3)
  sheet.addRow([])

  // Campi divisi in 3 gruppi (invece di un unico elenco indistinto):
  // Entrate → Cassa (apertura/chiusura fondo, spese, quadratura) →
  // Statistiche di servizio. Banca Teorica e Stato non compaiono più:
  // il primo era un dato tecnico intermedio, il secondo ridondante col
  // nome del file/contesto dell'export.
  function sectionHeader(label: string) {
    const r = sheet.addRow([label])
    r.font = HEADER_FONT
    r.fill = HEADER_FILL
    sheet.mergeCells(r.number, 1, r.number, 2)
  }
  function fieldRow(label: string, value: string | number, opts: { bold?: boolean } = {}) {
    const r = sheet.addRow([label, value])
    if (opts.bold) r.font = { bold: true }
  }

  sectionHeader('Entrate')
  fieldRow('Entrate Contanti', chiusura.entrate_contanti)
  fieldRow('Entrate POS', chiusura.entrate_pos)
  fieldRow('Entrate Bonifico', chiusura.entrate_bonifico)
  fieldRow('Totale Entrate', chiusura.totale_entrate, { bold: true })

  sheet.addRow([])
  sectionHeader('Cassa')
  fieldRow('Fondo Cassa Iniziale', chiusura.fondo_cassa_iniziale)
  fieldRow('Fondo Cassa Finale', chiusura.fondo_cassa_finale)
  fieldRow('Totale Spese Giornaliere', chiusura.totale_spese_giornaliere)
  fieldRow('Contanti per Banca', chiusura.contanti_per_banca, { bold: true })
  fieldRow('Differenza', chiusura.differenza)

  sheet.addRow([])
  sectionHeader('Statistiche')
  fieldRow('Coperti', chiusura.coperti)
  fieldRow('Incasso Asporto', chiusura.incasso_asporto)
  fieldRow('Media Scontrino', chiusura.coperti === 0 ? '—' : chiusura.media_scontrino)

  sheet.addRow([])
  const speseHeader = sheet.addRow(['Spesa', 'Categoria', 'Importo'])
  speseHeader.font = HEADER_FONT
  speseHeader.fill = HEADER_FILL

  if (spese.length === 0) {
    sheet.addRow(['Nessuna spesa registrata', '', ''])
  } else {
    for (const s of spese) sheet.addRow([s.nome_spesa, s.categoria?.nome ?? '', s.importo])
  }

  // Grafici: non solo tabelle. ExcelJS non supporta oggetti grafico nativi
  // (vedi nota sopra), quindi incorporiamo le due immagini generate via
  // next/og come immagini del foglio, ciascuna sotto un proprio titolo. La
  // dimensione di embed è SEMPRE quella "di visualizzazione" restituita dal
  // builder (width/height di ChartAsset, non il buffer sovracampionato) —
  // cosi' l'aspect ratio incorporato coincide sempre con quello reale del
  // grafico, invece di deformarlo con un box fisso indipendente dal
  // contenuto (bug precedente: il grafico a barre risultava schiacciato).
  const ROW_PX = 20 // altezza approssimativa di una riga con stile di default
  let imageRow = sheet.rowCount + 2

  function addChartImage(heading: string, asset: ChartAsset) {
    const headingCell = sheet.getRow(imageRow)
    headingCell.getCell(1).value = heading
    headingCell.getCell(1).font = { bold: true, color: { argb: 'FF266044' } }
    const imageId = workbook.addImage({ buffer: asset.buffer, extension: 'png' } as unknown as ExcelJS.Image)
    sheet.addImage(imageId, { tl: { col: 0, row: imageRow }, ext: { width: asset.width, height: asset.height } })
    imageRow += Math.ceil(asset.height / ROW_PX) + 2
  }

  const paymentPng = await buildPaymentChartPng(chiusura.entrate_contanti, chiusura.entrate_pos, chiusura.entrate_bonifico)
  if (paymentPng) addChartImage('Pagamento (contanti / POS / bonifico)', paymentPng)

  const categoryPng = await buildCategoryChartPng(spese)
  if (categoryPng) addChartImage('Spese per categoria', categoryPng)

  return workbook.xlsx.writeBuffer()
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

  // Un'immagine PNG incorporata nella pagina, con titolo di sezione sopra —
  // usa la stessa dimensione "di visualizzazione" (asset.width/height)
  // restituita dai builder dei grafici, che è già sovracampionata
  // internamente (RENDER_SCALE) per restare nitida anche stampata.
  async function drawChartImage(title: string, asset: ChartAsset) {
    const img = await doc.embedPng(asset.buffer)
    // Il grafico "Spese per categoria" cresce in larghezza con il numero di
    // categorie (fino a 8) e può superare lo spazio utile della pagina:
    // ridimensionare in proporzione invece di lasciarlo tagliare dal bordo.
    const scale = Math.min(1, CONTENT_W / asset.width)
    const drawW = asset.width * scale
    const drawH = asset.height * scale
    ensureSpace(30 + drawH)
    sectionTitle(title)
    page.drawImage(img, { x: MARGIN, y: y - drawH, width: drawW, height: drawH })
    y -= drawH + 16
  }

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

  const paymentChart = await buildPaymentChartPng(chiusura.entrate_contanti, chiusura.entrate_pos, chiusura.entrate_bonifico)
  if (paymentChart) await drawChartImage('Pagamento', paymentChart)

  const categoryChart = await buildCategoryChartPng(spese)
  if (categoryChart) await drawChartImage('Spese per categoria', categoryChart)

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
