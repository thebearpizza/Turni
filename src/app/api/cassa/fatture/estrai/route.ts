import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { estraiFatture, matchArticoli, EstrazioneTimeoutError, type CandidatoArticolo, type FatturaEstratta } from '@/lib/cassa/fattureExtraction'
import { verificaData, verificaIvaStimata, verificaTotaleDaFallback, verificaPrezzoArticolo, TOLLERANZA_QUADRATURA } from '@/lib/cassa/fattureVerifica'
import { ultimoPrezzoNoto } from '@/lib/cassa/fatturePrezzi'
import { trovaFornitoreSimile } from '@/lib/cassa/fornitoriMatching'
import type { VerificaSospetta, ArticoloTipologia } from '@/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

const BUCKET = 'fatture_foto'

// La lettura AI di più pagine supera comodamente i 10s di default di
// molte piattaforme serverless. Il budget interno dell'estrazione
// (BUDGET_ESTRAZIONE_MS) sta sotto questo limite di proposito: vogliamo
// rispondere noi con un errore leggibile, non essere terminati a metà.
export const maxDuration = 60

interface ArticoloRisolto {
  testo_estratto: string
  quantita: number
  prezzo_riga: number
  unita_misura: string | null
  tipologia_suggerita: ArticoloTipologia
  esito: 'auto_mappato' | 'chiaro' | 'ambiguo' | 'nuovo'
  catalogo_articolo_id: string | null
  candidato_nome: string | null
  sospetto: VerificaSospetta | null
}

// Risolve UNA fattura già estratta (fornitore, doppione, matching
// articoli) — usata una volta per ogni fattura individuata nel
// caricamento (Task: batch multi-fattura). Un caricamento può
// contenere più fatture distinte, anche di fornitori diversi:
// estraiFatture le ha già separate a monte, qui si tratta ciascuna
// esattamente come prima quando ce n'era una sola.
async function risolviFattura(
  supabase: SupabaseServerClient,
  restaurant: { id: string; owner_id: string },
  estratta: FatturaEstratta,
  fotoPathsGruppo: string[]
) {
  // ── Risoluzione fornitore: match su partita IVA, poi su nome (anche solo
  // simile — trovaFornitoreSimile normalizza forma societaria/punteggiatura
  // e tollera piccole variazioni), altrimenti crea ──
  const piva = estratta.fornitore_partita_iva?.trim()
  let fornitore: { id: string; nome: string; partita_iva: string | null } | null = null

  if (piva) {
    const { data } = await supabase.from('fornitori').select('id, nome, partita_iva').eq('owner_id', restaurant.owner_id).eq('partita_iva', piva).limit(1)
    fornitore = data?.[0] ?? null
  }

  if (!fornitore) {
    // Nessun match esatto per partita IVA (assente sulla fattura, o
    // diversa da quella già registrata per lo stesso fornitore — capita,
    // es. un errore di lettura OCR su una singola cifra): un nome anche
    // solo simile a un fornitore esistente resta un segnale valido per
    // non crearne uno duplicato.
    const { data: candidati } = await supabase.from('fornitori').select('id, nome, partita_iva').eq('owner_id', restaurant.owner_id)
    fornitore = trovaFornitoreSimile(estratta.fornitore_nome, candidati ?? [])

    // Trovato per nome ma senza partita IVA già a sistema: la si registra
    // ora che è stata letta, invece di lasciarla vuota per sempre.
    if (fornitore && !fornitore.partita_iva && piva) {
      await supabase.from('fornitori').update({ partita_iva: piva }).eq('id', fornitore.id)
      fornitore = { ...fornitore, partita_iva: piva }
    }
  }

  let fornitoreNuovo = false
  if (!fornitore) {
    const { data: inserted, error: fornErr } = await supabase
      .from('fornitori')
      .insert({ owner_id: restaurant.owner_id, nome: estratta.fornitore_nome.trim(), partita_iva: piva || null })
      .select('id, nome, partita_iva')
      .single()
    if (fornErr || !inserted) {
      throw new Error('Errore nella registrazione del fornitore: ' + (fornErr?.message ?? 'sconosciuto'))
    }
    fornitore = inserted
    fornitoreNuovo = true
  }

  // ── Blocco doppione: stesso fornitore + stesso numero documento già a sistema ──
  const { data: doppione } = await supabase
    .from('fatture')
    .select('id, restaurant_id, data')
    .eq('fornitore_id', fornitore.id)
    .eq('numero_documento', estratta.numero_documento.trim())
    .maybeSingle()

  if (doppione) {
    return {
      duplicato: true,
      fornitore: { ...fornitore, nuovo: fornitoreNuovo },
      fattura_esistente_id: doppione.id,
      foto_paths: fotoPathsGruppo,
    }
  }

  const totaleNetto = estratta.iva_dettaglio.reduce((s, r) => s + r.imponibile, 0)
  const totaleIva = estratta.iva_dettaglio.reduce((s, r) => s + r.iva, 0)
  const totaleLordo = totaleNetto + totaleIva

  // Quando il riepilogo IVA è stato letto direttamente in fattura (non
  // stimato dagli articoli — in quel caso coincidono per costruzione) e
  // c'è anche una tabella articoli, le due basi DEVONO combaciare: il
  // trigger fatture_recompute_totali scrive come netto la somma delle
  // righe articolo, non l'imponibile del riepilogo mostrato in revisione
  // — una riga saltata dall'OCR, uno sconto non a riga o un prezzo
  // corretto a mano farebbero salvare un totale diverso da quello appena
  // confermato dall'utente, senza alcun avviso.
  const sommaArticoli = estratta.articoli.reduce((s, a) => s + a.prezzo_riga, 0)
  const quadraturaArticoli: VerificaSospetta | null =
    estratta.ha_articoli && !estratta.iva_stimata && Math.abs(sommaArticoli - totaleNetto) > TOLLERANZA_QUADRATURA
      ? {
          campo: 'totale_lordo',
          messaggio: `La somma delle righe articolo (€ ${sommaArticoli.toFixed(2)}) non torna con l'imponibile del riepilogo IVA (€ ${totaleNetto.toFixed(2)}): il totale salvato rifletterà la somma degli articoli.`,
        }
      : null

  // ── Verifiche sui campi sospetti (Task 2) — solo segnalazione, non bloccano ──
  const verificheFattura: VerificaSospetta[] = [
    verificaData(estratta.data),
    quadraturaArticoli,
    verificaIvaStimata(estratta.iva_stimata),
    verificaTotaleDaFallback(estratta.totale_da_fallback),
  ].filter((v): v is VerificaSospetta => v !== null)

  // ── Matching articoli (solo se ha_articoli) ──
  let articoliRisolti: ArticoloRisolto[] = []

  if (estratta.ha_articoli && estratta.articoli.length > 0) {
    const { data: mappatureEsistenti } = await supabase
      .from('articoli_mappature_testo')
      .select('testo_estratto, catalogo_articolo_id')
      .eq('owner_id', restaurant.owner_id)
      .eq('fornitore_id', fornitore.id)
      .in('testo_estratto', estratta.articoli.map(a => a.nome))

    const mappaturaByTesto = new Map((mappatureEsistenti ?? []).map(m => [m.testo_estratto, m.catalogo_articolo_id]))

    const daAbbinare = estratta.articoli.filter(a => !mappaturaByTesto.has(a.nome))

    // Nomi del catalogo per il fornitore — servono non solo al matching ma
    // anche per mostrare in revisione A QUALE articolo un match ('chiaro',
    // 'auto_mappato' o 'ambiguo') è stato abbinato, quindi si recuperano
    // sempre, non solo quando c'è qualcosa da abbinare ex novo.
    const { data: catalogo } = await supabase
      .from('catalogo_articoli')
      .select('id, nome_articolo')
      .eq('owner_id', restaurant.owner_id)
      .eq('fornitore_id', fornitore.id)
    const nomeById = new Map((catalogo ?? []).map(c => [c.id, c.nome_articolo]))

    let esitiMatch: Awaited<ReturnType<typeof matchArticoli>> = []
    if (daAbbinare.length > 0) {
      const candidati: CandidatoArticolo[] = (catalogo ?? []).map(c => ({ id: c.id, nome_articolo: c.nome_articolo }))
      esitiMatch = await matchArticoli(daAbbinare.map(a => a.nome), candidati)

      // I match "chiaro" si ricordano subito — non serve chiedere di nuovo
      // per la stessa identica dicitura in futuro (la conferma esplicita
      // dell'utente serve solo per i casi ambigui/nuovi, gestita a parte).
      // Restano comunque correggibili in revisione ("Non è questo"): se
      // l'utente la smentisce, il salvataggio la sovrascrive con quella
      // giusta (stessa upsert, stessa chiave testo_estratto+fornitore).
      const daMemorizzare = esitiMatch.filter(e => e.esito === 'chiaro' && e.catalogo_articolo_id)
      if (daMemorizzare.length > 0) {
        await supabase.from('articoli_mappature_testo').upsert(
          daMemorizzare.map(e => ({
            owner_id: restaurant.owner_id,
            fornitore_id: fornitore.id,
            testo_estratto: e.testo_estratto,
            catalogo_articolo_id: e.catalogo_articolo_id as string,
          })),
          { onConflict: 'owner_id,fornitore_id,testo_estratto' }
        )
      }
    }

    const esitoByTesto = new Map(esitiMatch.map(e => [e.testo_estratto, e]))
    // Il controllo di scostamento prezzo (Task 2) richiede l'ultimo prezzo a
    // sistema per l'articolo — possibile solo per gli articoli già risolti a
    // questo punto (auto_mappato/chiaro); per ambigui/nuovi verrà rifatto
    // dopo la conferma dell'utente (endpoint conferma-articolo).
    articoliRisolti = await Promise.all(estratta.articoli.map(async a => {
      const mappato = mappaturaByTesto.get(a.nome)
      const prezzoUnitario = a.quantita !== 0 ? a.prezzo_riga / a.quantita : a.prezzo_riga

      if (mappato) {
        const ultimoPrezzo = await ultimoPrezzoNoto(supabase, mappato)
        return {
          testo_estratto: a.nome, quantita: a.quantita, prezzo_riga: a.prezzo_riga,
          unita_misura: a.unita_misura, tipologia_suggerita: a.tipologia_suggerita,
          esito: 'auto_mappato' as const, catalogo_articolo_id: mappato, candidato_nome: nomeById.get(mappato) ?? null,
          sospetto: verificaPrezzoArticolo(a.nome, prezzoUnitario, ultimoPrezzo),
        }
      }
      const match = esitoByTesto.get(a.nome)
      const sospetto = match?.catalogo_articolo_id
        ? verificaPrezzoArticolo(a.nome, prezzoUnitario, await ultimoPrezzoNoto(supabase, match.catalogo_articolo_id))
        : null
      return {
        testo_estratto: a.nome,
        quantita: a.quantita,
        prezzo_riga: a.prezzo_riga,
        unita_misura: a.unita_misura,
        tipologia_suggerita: a.tipologia_suggerita,
        esito: match?.esito ?? 'nuovo',
        catalogo_articolo_id: match?.catalogo_articolo_id ?? null,
        // Nome dell'articolo di catalogo abbinato ('chiaro'/'ambiguo'), da
        // mostrare in revisione — per 'ambiguo' è anche il testo della
        // domanda di conferma ("È lo stesso articolo di 'X'?").
        candidato_nome: (match?.esito === 'ambiguo' || match?.esito === 'chiaro') && match.catalogo_articolo_id ? nomeById.get(match.catalogo_articolo_id) ?? null : null,
        sospetto,
      }
    }))
  }

  return {
    duplicato: false,
    foto_paths: fotoPathsGruppo,
    fornitore: { ...fornitore, nuovo: fornitoreNuovo },
    fattura: {
      data: estratta.data,
      numero_documento: estratta.numero_documento,
      ha_articoli: estratta.ha_articoli,
      iva_dettaglio: estratta.iva_dettaglio,
      totale_netto: totaleNetto,
      totale_iva: totaleIva,
      totale_lordo: totaleLordo,
      verifiche_sospette: verificheFattura,
    },
    articoli: articoliRisolti,
  }
}

// POST /api/cassa/fatture/estrai
// Body JSON: { restaurant_id: string, foto_paths: string[] }
//
// Le foto le ha già caricate il client direttamente su Supabase Storage
// (vedi FatturaCapture.tsx) — qui arrivano solo i percorsi, non i byte:
// il corpo di una richiesta a una funzione serverless Vercel è limitato
// a 4.5 MB, e con più pagine ad alta risoluzione (l'OCR deve leggere
// testo piccolo) lo si supera facilmente passando i file nella richiesta
// stessa. Questa route scarica le foto da storage lato server, estrae i
// dati via Gemini (che può individuare più fatture distinte nello stesso
// caricamento — vedi estraiFatture), risolve il fornitore (trova o crea)
// e — se ha_articoli — abbina ogni articolo estratto al catalogo
// esistente per quel fornitore, per OGNUNA delle fatture trovate. Non
// salva ancora nulla: restituisce i dati risolti perché l'utente li
// riveda (Task 2) fattura per fattura prima del salvataggio definitivo
// (Task 3).
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json({ error: "Estrazione automatica non disponibile: l'assistente AI non è configurato." }, { status: 503 })
  }

  const body = await request.json()
  const restaurantId = body?.restaurant_id as string | undefined
  const fotoPaths = body?.foto_paths as string[] | undefined
  if (!restaurantId) return NextResponse.json({ error: 'Locale mancante' }, { status: 400 })
  if (!fotoPaths?.length) return NextResponse.json({ error: 'Nessuna foto ricevuta' }, { status: 400 })
  // Ogni percorso deve appartenere al locale dichiarato — altrimenti un
  // utente potrebbe passare percorsi di un altro locale (il download
  // sotto è comunque filtrato da RLS, ma qui evitiamo pure il tentativo).
  if (fotoPaths.some(p => !p.startsWith(`${restaurantId}/`))) {
    return NextResponse.json({ error: 'Percorso foto non valido' }, { status: 400 })
  }

  // Il locale deve esistere ed essere leggibile (RLS) dall'utente corrente
  // — da qui ricaviamo owner_id per lo scope di fornitori/catalogo.
  const { data: restaurant } = await supabase.from('restaurants').select('id, owner_id').eq('id', restaurantId).single()
  if (!restaurant) return NextResponse.json({ error: 'Locale non trovato o non autorizzato' }, { status: 403 })

  const fotoBuffers: { buffer: ArrayBuffer; mediaType: string }[] = []
  for (const path of fotoPaths) {
    const { data: fileBlob, error: downloadErr } = await supabase.storage.from(BUCKET).download(path)
    if (downloadErr || !fileBlob) {
      return NextResponse.json({ error: 'Errore nel recupero delle foto caricate: ' + (downloadErr?.message ?? 'file non trovato') }, { status: 500 })
    }
    fotoBuffers.push({ buffer: await fileBlob.arrayBuffer(), mediaType: fileBlob.type || 'image/jpeg' })
  }

  let fatture
  try {
    fatture = await estraiFatture(fotoBuffers)
  } catch (err) {
    await supabase.storage.from(BUCKET).remove(fotoPaths)
    console.error('Errore estrazione fattura:', err instanceof Error ? err.message : err)

    if (err instanceof EstrazioneTimeoutError) {
      return NextResponse.json(
        { error: 'La lettura ha superato il tempo massimo. Riprova con meno pagine per volta, oppure compila i dati a mano.' },
        { status: 504 }
      )
    }

    const rateLimited = /429|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(err instanceof Error ? err.message : String(err))
    return NextResponse.json(
      { error: rateLimited ? 'Troppe richieste all\'assistente AI in questo momento, riprova tra poco.' : 'Errore nella lettura della fattura, riprova o compila i dati a mano.' },
      { status: rateLimited ? 429 : 502 }
    )
  }

  // Un doppione in un gruppo (fattura già a sistema) è un esito
  // normale per QUELLA fattura, non un errore di richiesta: le altre
  // fatture del batch vanno comunque risolte e restituite. Un errore
  // vero (es. insert fornitore fallito) invece abortisce tutto il
  // batch, con pulizia di TUTTE le foto caricate — non solo quelle del
  // gruppo che ha fallito, perché senza un risultato per ogni gruppo il
  // client non ha modo di sapere quali foto tenere.
  //
  // In sequenza, non in parallelo: fornitori non ha un vincolo di
  // unicità su nome/partita_iva, quindi due fatture dello stesso
  // fornitore MAI VISTO PRIMA nello stesso batch risolte in parallelo
  // creerebbero due righe fornitori duplicate invece che la seconda
  // trovi quella appena creata dalla prima.
  try {
    const risultati = []
    for (const { fattura: estratta, indiciFoto } of fatture) {
      risultati.push(await risolviFattura(supabase, restaurant, estratta, indiciFoto.map(i => fotoPaths[i])))
    }
    return NextResponse.json({ fatture: risultati })
  } catch (err) {
    await supabase.storage.from(BUCKET).remove(fotoPaths)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Errore nella registrazione della fattura' }, { status: 500 })
  }
}
