import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient } from '@/lib/supabase/server'
import { interpretaImport, aiConfigurata } from '@/lib/cassa/prenotazioniParsing'
import { type Insegna } from '@/lib/cassa/prenotazioniLocali'
import { preparaImport, type PrenotazioneEsistente, type VoceCoda } from '@/lib/cassa/prenotazioniImport'
import type { DatiParziali } from '@/lib/cassa/prenotazioniEmailProcessing'

// Import "una tantum" delle prenotazioni già presenti nei libri visite:
// il manager esporta da TheFork/Restoo e carica qui il file. La route
// si limita a LEGGERE e restituire l'anteprima — l'inserimento avviene
// dal client solo dopo conferma, così una lettura sbagliata non finisce
// in agenda senza che nessuno l'abbia vista.
export const maxDuration = 60

const TIPI_TABELLARI = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/plain',
]

// Excel/CSV vengono convertiti qui in testo tabellare: il modello deve
// occuparsi solo di capire quale colonna è quale, non di decomprimere
// un formato binario.
async function foglioInTesto(file: File): Promise<string> {
  if (file.type === 'text/csv' || file.type === 'text/plain' || /\.csv$/i.test(file.name)) {
    return (await file.text()).slice(0, 60_000)
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())

  const righe: string[] = []
  workbook.eachSheet(sheet => {
    righe.push(`# Foglio: ${sheet.name}`)
    sheet.eachRow(row => {
      const celle: string[] = []
      row.eachCell({ includeEmpty: true }, cell => {
        const v = cell.value
        if (v == null) celle.push('')
        else if (v instanceof Date) celle.push(v.toISOString().slice(0, 16).replace('T', ' '))
        else if (typeof v === 'object' && 'text' in v) celle.push(String(v.text))
        else if (typeof v === 'object' && 'result' in v) celle.push(String(v.result ?? ''))
        else celle.push(String(v))
      })
      righe.push(celle.join('\t'))
    })
  })

  return righe.join('\n').slice(0, 60_000)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'manager') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  if (!aiConfigurata()) {
    return NextResponse.json({ error: 'Lettura file non disponibile: chiave AI non configurata' }, { status: 503 })
  }

  const form = await request.formData()
  const file = form.get('file')
  const restaurantId = form.get('restaurant_id')

  if (!(file instanceof File)) return NextResponse.json({ error: 'File mancante' }, { status: 400 })
  if (typeof restaurantId !== 'string' || !restaurantId) {
    return NextResponse.json({ error: 'Ristorante mancante' }, { status: 400 })
  }

  // Il SELECT passa da RLS: se il manager non gestisce questo locale non
  // trova la riga e la richiesta si ferma qui.
  const { data: insegne } = await supabase
    .from('prenotazioni_insegne')
    .select('restaurant_id, codice, termini, priorita, principale')
    .eq('restaurant_id', restaurantId)

  const { data: locale } = await supabase
    .from('restaurants')
    .select('id')
    .eq('id', restaurantId)
    .maybeSingle()
  if (!locale) return NextResponse.json({ error: 'Ristorante non gestito' }, { status: 403 })

  const tabellare = TIPI_TABELLARI.includes(file.type) || /\.(xlsx|xls|csv|txt)$/i.test(file.name)

  let letto
  try {
    letto = tabellare
      ? await interpretaImport({
          testo: await foglioInTesto(file),
          nomeFile: file.name,
          annoDiRiferimento: new Date().getFullYear(),
        })
      : await interpretaImport({
          documento: { buffer: await file.arrayBuffer(), mediaType: file.type || 'application/pdf' },
          nomeFile: file.name,
          annoDiRiferimento: new Date().getFullYear(),
        })
  } catch (err) {
    console.error('[cassa/prenotazioni] Import fallito:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Impossibile leggere il file' },
      { status: 502 }
    )
  }

  // Il giorno lo si conosce solo dopo la lettura: si interrogano le
  // prenotazioni già in agenda per quelle date, così l'anteprima può
  // segnalare i doppioni invece di crearli.
  const giorni = [...new Set(letto.prenotazioni.map(r => r.data).filter(Boolean))] as string[]
  const { data: esistenti } = giorni.length
    ? await supabase
        .from('prenotazioni')
        .select('data, orario, nome, cognome')
        .eq('restaurant_id', restaurantId)
        .in('data', giorni)
        .neq('stato', 'eliminata')
    : { data: [] }

  // Prenotazioni in coda (mail arrivate senza orario) dello stesso
  // locale: se l'export appena caricato contiene la stessa prenotazione,
  // ora completa di orario, la si usa per chiudere quella voce invece di
  // lasciarla in attesa di un completamento manuale.
  const { data: righeCoda } = await supabase
    .from('prenotazioni_email_log')
    .select('id, payload')
    .eq('esito', 'incompleta')
    .eq('payload->parziale->>restaurant_id', restaurantId)

  const coda: VoceCoda[] = (righeCoda ?? [])
    .map(r => {
      const parziale = (r.payload as { parziale?: DatiParziali } | null)?.parziale
      return parziale ? { logId: r.id as string, parziale } : null
    })
    .filter((v): v is VoceCoda => v !== null)

  return NextResponse.json(
    preparaImport({
      righe:           letto.prenotazioni,
      paxDichiarati:   letto.totale_pax_dichiarato,
      righeDichiarate: letto.totale_prenotazioni_dichiarato,
      restaurantId,
      // A differenza delle mail, qui il locale l'ha scelto il manager nel
      // selettore: un export riguarda un locale solo, quindi le righe che
      // non nominano l'insegna ereditano quella di default.
      insegne:         (insegne ?? []) as Insegna[],
      esistenti:       (esistenti ?? []) as PrenotazioneEsistente[],
      coda,
    })
  )
}
