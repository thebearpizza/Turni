import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { estraiFattura, matchArticoli, type CandidatoArticolo } from '@/lib/cassa/fattureExtraction'
import { verificaData, verificaQuadratura, verificaPrezzoArticolo } from '@/lib/cassa/fattureVerifica'
import { ultimoPrezzoNoto } from '@/lib/cassa/fatturePrezzi'
import type { VerificaSospetta, ArticoloTipologia } from '@/types'

const BUCKET = 'fatture_foto'

// L'estrazione ora usa un modello più lento ma più accurato (Gemini Pro
// invece di Flash, vedi fattureExtraction.ts) — su una fattura di più
// pagine può superare comodamente i 10s di default di molte piattaforme
// serverless. Alza il limite per questa singola route.
export const maxDuration = 60

// POST /api/cassa/fatture/estrai
// Multipart FormData: restaurant_id (string) + photo_0, photo_1, ... (File, in ordine di pagina)
//
// Carica le foto, estrae i dati della fattura via Gemini, risolve il
// fornitore (trova o crea) e — se ha_articoli — abbina ogni articolo
// estratto al catalogo esistente per quel fornitore. Non salva ancora la
// fattura: restituisce i dati risolti perché l'utente li riveda (Task 2)
// prima del salvataggio definitivo (Task 3).
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json({ error: "Estrazione automatica non disponibile: l'assistente AI non è configurato." }, { status: 503 })
  }

  const formData = await request.formData()
  const restaurantId = formData.get('restaurant_id') as string | null
  if (!restaurantId) return NextResponse.json({ error: 'Locale mancante' }, { status: 400 })

  const photos: File[] = []
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('photo_') && value instanceof File) photos.push(value)
  }
  if (photos.length === 0) return NextResponse.json({ error: 'Nessuna foto ricevuta' }, { status: 400 })
  if (photos.some(p => p.size > 10 * 1024 * 1024)) {
    return NextResponse.json({ error: 'Ogni foto può arrivare al massimo a 10 MB' }, { status: 413 })
  }

  // Il locale deve esistere ed essere leggibile (RLS) dall'utente corrente
  // — da qui ricaviamo owner_id per lo scope di fornitori/catalogo.
  const { data: restaurant } = await supabase.from('restaurants').select('id, owner_id').eq('id', restaurantId).single()
  if (!restaurant) return NextResponse.json({ error: 'Locale non trovato o non autorizzato' }, { status: 403 })

  // Upload foto — path {restaurant_id}/{timestamp}-{indice}.{ext}, RLS su
  // storage.objects verifica manager/direttore sul locale.
  const fotoPaths: string[] = []
  const fotoBuffers: { buffer: ArrayBuffer; mediaType: string }[] = []
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i]
    const buffer = await photo.arrayBuffer()
    fotoBuffers.push({ buffer, mediaType: photo.type || 'image/jpeg' })

    const ext = photo.name.split('.').pop() ?? 'jpg'
    const path = `${restaurantId}/${Date.now()}-${i}.${ext}`
    const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: photo.type || 'image/jpeg',
      upsert: false,
    })
    if (uploadErr) {
      await supabase.storage.from(BUCKET).remove(fotoPaths)
      return NextResponse.json({ error: 'Errore upload foto: ' + uploadErr.message }, { status: 500 })
    }
    fotoPaths.push(path)
  }

  let estratta
  try {
    estratta = await estraiFattura(fotoBuffers)
  } catch (err) {
    await supabase.storage.from(BUCKET).remove(fotoPaths)
    console.error('Errore estrazione fattura:', err instanceof Error ? err.message : err)
    const rateLimited = /429|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(err instanceof Error ? err.message : String(err))
    return NextResponse.json(
      { error: rateLimited ? 'Troppe richieste all\'assistente AI in questo momento, riprova tra poco.' : 'Errore nella lettura della fattura, riprova o compila i dati a mano.' },
      { status: rateLimited ? 429 : 502 }
    )
  }

  // ── Risoluzione fornitore: match su partita IVA, poi su nome, altrimenti crea ──
  const fornitoreQuery = supabase.from('fornitori').select('id, nome, partita_iva').eq('owner_id', restaurant.owner_id)
  const piva = estratta.fornitore_partita_iva?.trim()
  const { data: fornitoriEsistenti } = piva
    ? await fornitoreQuery.eq('partita_iva', piva)
    : await fornitoreQuery.ilike('nome', estratta.fornitore_nome.trim())

  let fornitore = fornitoriEsistenti?.[0] ?? null
  let fornitoreNuovo = false
  if (!fornitore) {
    const { data: inserted, error: fornErr } = await supabase
      .from('fornitori')
      .insert({ owner_id: restaurant.owner_id, nome: estratta.fornitore_nome.trim(), partita_iva: piva || null })
      .select('id, nome, partita_iva')
      .single()
    if (fornErr || !inserted) {
      await supabase.storage.from(BUCKET).remove(fotoPaths)
      return NextResponse.json({ error: 'Errore nella registrazione del fornitore: ' + (fornErr?.message ?? 'sconosciuto') }, { status: 500 })
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
    return NextResponse.json({
      duplicato: true,
      fornitore: { ...fornitore, nuovo: fornitoreNuovo },
      fattura_esistente_id: doppione.id,
      foto_paths: fotoPaths,
    })
  }

  const totaleNetto = estratta.iva_dettaglio.reduce((s, r) => s + r.imponibile, 0)
  const totaleIva = estratta.iva_dettaglio.reduce((s, r) => s + r.iva, 0)
  const totaleLordo = totaleNetto + totaleIva

  // ── Verifiche sui campi sospetti (Task 2) — solo segnalazione, non bloccano ──
  const verificheFattura: VerificaSospetta[] = [
    verificaData(estratta.data),
    verificaQuadratura(totaleNetto, totaleIva, totaleLordo),
  ].filter((v): v is VerificaSospetta => v !== null)

  // ── Matching articoli (solo se ha_articoli) ──
  let articoliRisolti: Array<{
    testo_estratto: string
    quantita: number
    prezzo_riga: number
    unita_misura: string | null
    tipologia_suggerita: ArticoloTipologia
    esito: 'auto_mappato' | 'chiaro' | 'ambiguo' | 'nuovo'
    catalogo_articolo_id: string | null
    candidato_nome: string | null
    sospetto: VerificaSospetta | null
  }> = []

  if (estratta.ha_articoli && estratta.articoli.length > 0) {
    const { data: mappatureEsistenti } = await supabase
      .from('articoli_mappature_testo')
      .select('testo_estratto, catalogo_articolo_id')
      .eq('owner_id', restaurant.owner_id)
      .eq('fornitore_id', fornitore.id)
      .in('testo_estratto', estratta.articoli.map(a => a.nome))

    const mappaturaByTesto = new Map((mappatureEsistenti ?? []).map(m => [m.testo_estratto, m.catalogo_articolo_id]))

    const daAbbinare = estratta.articoli.filter(a => !mappaturaByTesto.has(a.nome))

    let esitiMatch: Awaited<ReturnType<typeof matchArticoli>> = []
    let nomeById = new Map<string, string>()
    if (daAbbinare.length > 0) {
      const { data: catalogo } = await supabase
        .from('catalogo_articoli')
        .select('id, nome_articolo')
        .eq('owner_id', restaurant.owner_id)
        .eq('fornitore_id', fornitore.id)

      const candidati: CandidatoArticolo[] = (catalogo ?? []).map(c => ({ id: c.id, nome_articolo: c.nome_articolo }))
      nomeById = new Map(candidati.map(c => [c.id, c.nome_articolo]))
      esitiMatch = await matchArticoli(daAbbinare.map(a => a.nome), candidati)

      // I match "chiaro" si ricordano subito — non serve chiedere di nuovo
      // per la stessa identica dicitura in futuro (la conferma esplicita
      // dell'utente serve solo per i casi ambigui/nuovi, gestita a parte).
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
          esito: 'auto_mappato' as const, catalogo_articolo_id: mappato, candidato_nome: null,
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
        // Solo per 'ambiguo': il nome del candidato suggerito, da mostrare
        // nella conferma ("È lo stesso articolo di 'X'?").
        candidato_nome: match?.esito === 'ambiguo' && match.catalogo_articolo_id ? nomeById.get(match.catalogo_articolo_id) ?? null : null,
        sospetto,
      }
    }))
  }

  return NextResponse.json({
    duplicato: false,
    foto_paths: fotoPaths,
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
  })
}
