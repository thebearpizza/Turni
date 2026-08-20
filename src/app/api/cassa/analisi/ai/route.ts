import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { generateText, tool, stepCountIs, type ModelMessage } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import { formatInTimeZone } from 'date-fns-tz'
import { getDaysInMonth, isLeapYear } from 'date-fns'

const TZ = 'Europe/Rome'

// Con centinaia di chiusure l'elenco di id in querystring (.in(...)) supera
// i limiti di URI del gateway Supabase — stesso limite/motivo di fetchSpese
// in AnalisiClient.tsx.
const CHUNK_SIZE = 150

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Raggruppa un array per una chiave testuale — usato per il breakdown per
// locale (in più strumenti) e per categoria di spesa/fornitore, evitando
// di ripetere la stessa costruzione di Map più volte.
function raggruppaPer<T>(righe: T[], chiave: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of righe) {
    const k = chiave(r)
    m.set(k, [...(m.get(k) ?? []), r])
  }
  return m
}

// Stessa coppia "estrazione" di fatture/prenotazioni: qui il modello deve
// ragionare su più chiamate di strumenti in sequenza (periodo → confronto
// → previsione), non solo trascrivere un documento, quindi conviene lo
// stesso tier "pesante" invece di quello leggero di Telegram/dedup.
const GEMINI_MODEL = process.env.GEMINI_MODEL_ESTRAZIONE || 'gemini-3.7-flash'
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL_ESTRAZIONE || 'gemini-3.5-flash-lite'

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /429|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(message)
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

interface ChiusuraRiga {
  id: string
  data: string
  restaurant_name: string
  totale_entrate: number
  totale_spese_giornaliere: number
  differenza: number
  coperti: number
  incasso_asporto: number
  entrate_contanti: number
  entrate_pos: number
  entrate_bonifico: number
  fondo_cassa_iniziale: number
  fondo_cassa_finale: number
  contanti_per_banca: number
  banca_teorica: number
  media_scontrino: number
}

interface SpesaRiga {
  data: string
  restaurant_name: string
  categoria_nome: string | null
  nome_spesa: string
  importo: number
}

async function fetchSpese(supabase: SupabaseServerClient, chiusure: ChiusuraRiga[]): Promise<SpesaRiga[]> {
  if (chiusure.length === 0) return []
  const infoById = new Map(chiusure.map(c => [c.id, c]))
  const ids = chiusure.map(c => c.id)
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) chunks.push(ids.slice(i, i + CHUNK_SIZE))

  const risposte = await Promise.all(chunks.map(chunk => supabase
    .from('cassa_spese')
    .select('importo, nome_spesa, chiusura_id, categoria:cassa_categorie(nome)')
    .in('chiusura_id', chunk)
  ))

  const data = risposte.flatMap(r => r.data ?? [])
  return (data as unknown as Array<{ importo: number; nome_spesa: string; chiusura_id: string; categoria: { nome: string } | null }>).map(s => {
    const info = infoById.get(s.chiusura_id)
    return {
      data: info?.data ?? '',
      restaurant_name: info?.restaurant_name ?? '—',
      categoria_nome: s.categoria?.nome ?? null,
      nome_spesa: s.nome_spesa,
      importo: s.importo,
    }
  })
}

// Tutti i numeri che l'AI cita vengono da qui, mai calcolati da lei:
// un LLM non è affidabile per sommare decine di righe a mente, quindi gli
// strumenti fanno l'aritmetica in TypeScript e l'AI si limita a scegliere
// quale chiamare e a spiegare il risultato in linguaggio naturale.
//
// Nessuno strumento accetta un locale come filtro: quando l'ambito
// comprende più di un ristorante, la risposta include SEMPRE anche
// per_locale con lo stesso calcolo spezzato per nome — così una domanda
// su uno o più locali specifici (es. "quanto ha fatto Dazio?") si
// risolve leggendo il breakdown già restituito, senza che il modello
// debba inventare un parametro che non esiste (causa di un errore reale
// osservato: il modello tentava di filtrare per nome e la chiamata falliva).
function buildTools(
  supabase: SupabaseServerClient,
  restaurantIds: string[],
  ownerId: string | null,
  chiusure: ChiusuraRiga[],
  spese: SpesaRiga[]
) {
  return {
    dati_periodo: tool({
      description: 'Somma entrate (totali e per metodo di pagamento), spese, margine, coperti, incasso asporto e media scontrino in un intervallo di date (estremi inclusi). Usa questo strumento per qualsiasi domanda su un mese, una settimana o un range di giorni.',
      inputSchema: z.object({
        inizio: z.string().describe('Data di inizio, formato yyyy-MM-dd'),
        fine: z.string().describe('Data di fine, formato yyyy-MM-dd (inclusa)'),
      }),
      execute: async ({ inizio, fine }) => {
        const righe = chiusure.filter(c => c.data >= inizio && c.data <= fine)
        if (righe.length === 0) {
          return { giorni_con_dati: 0, messaggio: 'Nessuna chiusura confermata in questo intervallo di date.' }
        }

        function aggrega(voci: ChiusuraRiga[]) {
          const entrate = voci.reduce((s, r) => s + r.totale_entrate, 0)
          const totaleSpese = voci.reduce((s, r) => s + r.totale_spese_giornaliere, 0)
          const coperti = voci.reduce((s, r) => s + r.coperti, 0)
          return {
            giorni_con_dati: new Set(voci.map(v => v.data)).size,
            totale_entrate: round2(entrate),
            entrate_contanti: round2(voci.reduce((s, r) => s + r.entrate_contanti, 0)),
            entrate_pos: round2(voci.reduce((s, r) => s + r.entrate_pos, 0)),
            entrate_bonifico: round2(voci.reduce((s, r) => s + r.entrate_bonifico, 0)),
            totale_spese: round2(totaleSpese),
            margine_operativo: round2(entrate - totaleSpese),
            coperti_totali: coperti,
            incasso_asporto: round2(voci.reduce((s, r) => s + r.incasso_asporto, 0)),
            media_entrate_giornaliera: round2(entrate / new Set(voci.map(v => v.data)).size),
            media_scontrino_periodo: coperti > 0 ? round2(entrate / coperti) : null,
            contanti_da_versare_in_banca_totale: round2(voci.reduce((s, r) => s + r.contanti_per_banca, 0)),
          }
        }

        const locali = new Set(righe.map(r => r.restaurant_name))
        return {
          ...aggrega(righe),
          ...(locali.size > 1 && {
            per_locale: Array.from(raggruppaPer(righe, r => r.restaurant_name).entries())
              .map(([locale, voci]) => ({ locale, ...aggrega(voci) })),
          }),
        }
      },
    }),
    dati_giorno: tool({
      description: 'Dettaglio completo di un singolo giorno (entrate per metodo di pagamento, fondo cassa iniziale/finale, contanti da versare in banca, banca teorica, media scontrino), un elemento per locale se ne sono selezionati più di uno.',
      inputSchema: z.object({ data: z.string().describe('yyyy-MM-dd') }),
      execute: async ({ data }) => {
        const righe = chiusure.filter(c => c.data === data)
        if (righe.length === 0) {
          return { messaggio: 'Nessuna chiusura confermata in questa data (giorno di chiusura del locale, oppure dati non ancora inseriti/confermati).' }
        }
        return {
          locali: righe.map(r => ({
            locale: r.restaurant_name,
            entrate: r.totale_entrate,
            entrate_contanti: r.entrate_contanti,
            entrate_pos: r.entrate_pos,
            entrate_bonifico: r.entrate_bonifico,
            spese: r.totale_spese_giornaliere,
            differenza_cassa: r.differenza,
            coperti: r.coperti,
            incasso_asporto: r.incasso_asporto,
            media_scontrino: r.media_scontrino,
            fondo_cassa_iniziale: r.fondo_cassa_iniziale,
            fondo_cassa_finale: r.fondo_cassa_finale,
            contanti_da_versare_in_banca: r.contanti_per_banca,
            banca_teorica: r.banca_teorica,
          })),
        }
      },
    }),
    previsione: tool({
      description: 'Proiezione di fine mese o fine anno per le entrate, basata sulla media giornaliera osservata nel periodo già trascorso. È una stima lineare (nessuna stagionalità), da presentare sempre come tale.',
      inputSchema: z.object({ orizzonte: z.enum(['fine_mese', 'fine_anno']) }),
      execute: async ({ orizzonte }) => {
        const oggi = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
        const anno = parseInt(oggi.slice(0, 4), 10)
        const mese = parseInt(oggi.slice(5, 7), 10)
        const inizioPeriodo = orizzonte === 'fine_mese' ? `${oggi.slice(0, 7)}-01` : `${oggi.slice(0, 4)}-01-01`
        const giorniTotali = orizzonte === 'fine_mese'
          ? getDaysInMonth(new Date(anno, mese - 1))
          : (isLeapYear(new Date(anno, 0)) ? 366 : 365)

        const righe = chiusure.filter(c => c.data >= inizioPeriodo && c.data <= oggi)
        if (righe.length === 0) {
          return { messaggio: `Nessun dato ancora nel periodo di riferimento (da ${inizioPeriodo}) per calcolare una proiezione.` }
        }
        const entrateFinora = righe.reduce((s, r) => s + r.totale_entrate, 0)
        const giorniConDati = new Set(righe.map(r => r.data)).size
        const mediaGiornaliera = entrateFinora / giorniConDati
        const locali = new Set(righe.map(r => r.restaurant_name))

        return {
          da: inizioPeriodo,
          a_oggi: oggi,
          entrate_finora: round2(entrateFinora),
          giorni_con_dati: giorniConDati,
          giorni_totali_nel_periodo: giorniTotali,
          media_giornaliera: round2(mediaGiornaliera),
          proiezione: round2(mediaGiornaliera * giorniTotali),
          nota: 'Stima lineare: proietta in avanti la media giornaliera osservata finora, senza tenere conto di stagionalità (weekend, festività, alta/bassa stagione). Tanto più incerta quanto meno giorni di storico sono disponibili.',
          ...(locali.size > 1 && {
            per_locale: Array.from(raggruppaPer(righe, r => r.restaurant_name).entries()).map(([locale, voci]) => {
              const e = voci.reduce((s, r) => s + r.totale_entrate, 0)
              const giorni = new Set(voci.map(v => v.data)).size
              const media = e / giorni
              return {
                locale,
                entrate_finora: round2(e),
                giorni_con_dati: giorni,
                media_giornaliera: round2(media),
                proiezione: round2(media * giorniTotali),
              }
            }),
          }),
        }
      },
    }),
    spese_per_categoria: tool({
      description: 'Elenco delle categorie di SPESA DI CASSA (uscite giornaliere manuali, non fatture fornitori) con importo totale in un intervallo di date, dalla più alta alla più bassa. Usa questo strumento per domande su quali sono le spese principali o quanto si è speso in una categoria.',
      inputSchema: z.object({
        inizio: z.string().describe('Data di inizio, formato yyyy-MM-dd'),
        fine: z.string().describe('Data di fine, formato yyyy-MM-dd (inclusa)'),
      }),
      execute: async ({ inizio, fine }) => {
        const righe = spese.filter(s => s.data >= inizio && s.data <= fine)
        if (righe.length === 0) return { messaggio: 'Nessuna voce di spesa di cassa registrata in questo intervallo di date.' }

        const categorie = Array.from(raggruppaPer(righe, r => r.categoria_nome ?? 'Senza categoria').entries())
          .map(([categoria, voci]) => ({
            categoria,
            importo_totale: round2(voci.reduce((s, v) => s + v.importo, 0)),
            numero_voci: voci.length,
          }))
          .sort((a, b) => b.importo_totale - a.importo_totale)

        const locali = new Set(righe.map(r => r.restaurant_name))
        return {
          totale_spese: round2(righe.reduce((s, r) => s + r.importo, 0)),
          categorie,
          ...(locali.size > 1 && {
            per_locale: Array.from(raggruppaPer(righe, r => r.restaurant_name).entries()).map(([locale, voci]) => ({
              locale,
              totale_spese: round2(voci.reduce((s, v) => s + v.importo, 0)),
            })),
          }),
        }
      },
    }),
    spesa_fatture: tool({
      description: 'Totale delle FATTURE FORNITORI (acquisti di merce/servizi, non spese di cassa) ricevute in un intervallo di date, con i fornitori principali per spesa. Usa questo per domande su quanto si è speso in fatture, acquisti o un fornitore specifico.',
      inputSchema: z.object({
        inizio: z.string().describe('Data di inizio, formato yyyy-MM-dd'),
        fine: z.string().describe('Data di fine, formato yyyy-MM-dd (inclusa)'),
      }),
      execute: async ({ inizio, fine }) => {
        const { data, error } = await supabase
          .from('fatture')
          .select('data, totale_netto, totale_iva, totale_lordo, fornitore:fornitori(nome), restaurant:restaurants(name)')
          .in('restaurant_id', restaurantIds)
          .gte('data', inizio)
          .lte('data', fine)

        if (error) return { messaggio: 'Errore nel recupero delle fatture: ' + error.message }
        const righe = (data ?? []) as unknown as Array<{
          data: string; totale_netto: number; totale_iva: number; totale_lordo: number
          fornitore: { nome: string } | null; restaurant: { name: string } | null
        }>
        if (righe.length === 0) return { messaggio: 'Nessuna fattura fornitore registrata in questo intervallo di date.' }

        const fornitori = Array.from(raggruppaPer(righe, r => r.fornitore?.nome ?? 'Fornitore sconosciuto').entries())
          .map(([fornitore, voci]) => ({
            fornitore,
            totale_netto: round2(voci.reduce((s, v) => s + v.totale_netto, 0)),
            numero_fatture: voci.length,
          }))
          .sort((a, b) => b.totale_netto - a.totale_netto)

        const locali = new Set(righe.map(r => r.restaurant?.name ?? '—'))
        return {
          numero_fatture: righe.length,
          totale_netto: round2(righe.reduce((s, r) => s + r.totale_netto, 0)),
          totale_iva: round2(righe.reduce((s, r) => s + r.totale_iva, 0)),
          totale_lordo: round2(righe.reduce((s, r) => s + r.totale_lordo, 0)),
          fornitori,
          ...(locali.size > 1 && {
            per_locale: Array.from(raggruppaPer(righe, r => r.restaurant?.name ?? '—').entries()).map(([locale, voci]) => ({
              locale,
              totale_lordo: round2(voci.reduce((s, v) => s + v.totale_lordo, 0)),
              numero_fatture: voci.length,
            })),
          }),
        }
      },
    }),
    prezzo_articolo: tool({
      description: 'Cerca un articolo di catalogo per nome (anche parziale, es. "farina" o "mozzarella") e restituisce fornitore, prezzo più recente noto e i prezzi degli ultimi acquisti. Usa questo per domande sul prezzo o l\'andamento del costo di un prodotto.',
      inputSchema: z.object({ nome: z.string().describe('Nome o parte del nome del prodotto da cercare') }),
      execute: async ({ nome }) => {
        if (!ownerId) return { messaggio: 'Catalogo articoli non disponibile per questo ambito.' }

        const { data: candidati, error } = await supabase
          .from('catalogo_articoli')
          .select('id, nome_articolo, unita_misura, fornitore:fornitori(nome)')
          .eq('owner_id', ownerId)
          .ilike('nome_articolo', `%${nome}%`)
          .limit(8)

        if (error) return { messaggio: 'Errore nella ricerca articoli: ' + error.message }
        if (!candidati || candidati.length === 0) return { messaggio: `Nessun articolo di catalogo trovato per "${nome}".` }

        const righe = candidati as unknown as Array<{ id: string; nome_articolo: string; unita_misura: string | null; fornitore: { nome: string } | null }>
        const risultati = await Promise.all(righe.map(async art => {
          const { data: storico } = await supabase
            .from('fatture_articoli')
            .select('prezzo_unitario, fattura:fatture!inner(data)')
            .eq('catalogo_articolo_id', art.id)
            .order('data', { foreignTable: 'fatture', ascending: false })
            .limit(5)

          const prezzi = (storico ?? []) as unknown as Array<{ prezzo_unitario: number; fattura: { data: string } | null }>
          return {
            nome: art.nome_articolo,
            fornitore: art.fornitore?.nome ?? null,
            unita_misura: art.unita_misura,
            prezzo_piu_recente: prezzi[0] ? round2(prezzi[0].prezzo_unitario) : null,
            data_ultimo_acquisto: prezzi[0]?.fattura?.data ?? null,
            ultimi_prezzi: prezzi.map(p => ({ data: p.fattura?.data ?? null, prezzo: round2(p.prezzo_unitario) })),
          }
        }))

        return { risultati }
      },
    }),
  }
}

function buildSystemPrompt(scopeLabel: string, oggi: string, primaData: string | null, ultimaData: string | null): string {
  return `Sei l'assistente AI della pagina Analisi di "Turni" (gestione cassa di ristoranti italiani) — rispondi a domande sull'andamento economico dei locali usando i dati di chiusure cassa, spese, fatture fornitori e catalogo articoli.

Ambito attuale: ${scopeLabel}.
Data di oggi: ${oggi}.
${primaData && ultimaData ? `Dati di cassa disponibili dal ${primaData} al ${ultimaData}.` : 'Non risultano ancora chiusure confermate in questo ambito.'}

ISTRUZIONI:
- Rispondi sempre in italiano, tono professionale ma colloquiale, conciso: vai dritto ai numeri, senza premesse lunghe.
- Usa SEMPRE uno strumento per ottenere i numeri prima di rispondere. Non sommare né calcolare medie a mente, non inventare MAI un numero: se lo strumento non te lo dà, non esiste.
- Domanda su un mese/settimana/intervallo di entrate-spese-margine → dati_periodo. Domanda su un giorno preciso (incluso fondo cassa, banca, contanti da versare) → dati_giorno. Domanda su un andamento futuro (fine mese, fine anno) → previsione. Domanda su categorie di SPESA DI CASSA (uscite giornaliere) → spese_per_categoria. Domanda su FATTURE FORNITORI/acquisti/quanto speso con un fornitore → spesa_fatture. Domanda sul prezzo o costo di un prodotto/articolo → prezzo_articolo.
- "Spese" può significare due cose diverse: le uscite di cassa giornaliere (spese_per_categoria, incluse già nel margine di dati_periodo) oppure gli acquisti fatturati dai fornitori (spesa_fatture, un dato SEPARATO che non è incluso nel margine operativo di dati_periodo). Se la domanda è ambigua, rispondi con entrambe oppure chiedi di specificare.
- Nessuno strumento accetta il nome di un locale come filtro. Quando in ambito c'è più di un locale, ogni strumento restituisce ANCHE per_locale con lo stesso calcolo diviso per nome: se la domanda riguarda uno o più locali specifici, chiama comunque lo strumento sull'intero periodo e leggi la voce corrispondente in per_locale, invece di provare a passare un parametro locale/nome/ristorante che non esiste.
- Se la domanda non specifica un periodo (es. "come stiamo andando?"), usa il mese in corso. Puoi chiamare lo stesso strumento più volte con periodi diversi per rispondere a un confronto (es. "luglio vs agosto").
- In una proiezione, riporta sempre la nota sulla stima lineare che ricevi dallo strumento: l'utente deve capire che è una stima, non un dato certo.
- Se uno strumento segnala che non ci sono dati per il periodo/nome richiesto, dillo chiaramente invece di inventare qualcosa.
- Puoi usare markdown (grassetto, elenchi puntati) per rendere i numeri più leggibili, senza esagerare.
- Non menzionare mai ID interni o dettagli tecnici: solo numeri, date e nomi dei locali/fornitori/articoli.`
}

// POST /api/cassa/analisi/ai
// Body: { restaurant_ids: string[], messages: { role: 'user'|'assistant', content: string }[] }
//
// Chat testuale sopra i dati di Cassa — chiusure/spese (stesso ambito già
// visibile in Analisi), più fatture fornitori e catalogo articoli/prezzi
// (le altre tab Cassa) — con tool-calling invece di un'unica risposta
// libera: ogni numero che l'AI cita viene da un calcolo fatto qui in
// TypeScript sulle righe già caricate o da una query mirata, non da
// aritmetica del modello. Nessuna cronologia salvata lato server: il
// client rimanda l'intera conversazione a ogni domanda (vedi
// AnalisiAiDialog.tsx), coerente con un widget "fai una domanda rapida"
// piuttosto che un assistente persistente.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json({ error: 'Assistente AI non configurato.' }, { status: 503 })
  }

  const body = await request.json()
  const restaurantIds = body?.restaurant_ids as string[] | undefined
  const clientMessages = body?.messages as Array<{ role: 'user' | 'assistant'; content: string }> | undefined

  if (!restaurantIds?.length) return NextResponse.json({ error: 'Nessun locale selezionato' }, { status: 400 })
  if (!clientMessages?.length || clientMessages[clientMessages.length - 1]?.role !== 'user') {
    return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 })
  }
  // Limite di sicurezza: una conversazione che continua a crescere
  // gonfierebbe inutilmente il contesto a ogni scambio successivo.
  if (clientMessages.length > 40) {
    return NextResponse.json({ error: 'Conversazione troppo lunga: chiudi e riapri per fare una nuova domanda.' }, { status: 400 })
  }

  // RLS di cassa_chiusure applica già lo stesso confine per ruolo del
  // fetch che fa il browser in AnalisiClient — nessun controllo extra sui
  // restaurant_ids necessario, un id fuori ambito restituisce solo righe
  // in meno, non un errore.
  const [{ data, error }, { data: restaurantRow }] = await Promise.all([
    supabase
      .from('cassa_chiusure')
      .select(`
        id, data, totale_entrate, totale_spese_giornaliere, differenza, coperti, incasso_asporto,
        entrate_contanti, entrate_pos, entrate_bonifico, fondo_cassa_iniziale, fondo_cassa_finale,
        contanti_per_banca, banca_teorica, media_scontrino, restaurant:restaurants(name)
      `)
      .in('restaurant_id', restaurantIds)
      .eq('stato', 'confermata')
      .order('data', { ascending: true }),
    // owner_id per lo strumento prezzo_articolo: il catalogo è condiviso
    // per owner, non per singolo ristorante (stesso modello dati della
    // tab Articoli) — basta risolverlo da uno qualsiasi dei ristoranti in
    // ambito, RLS impedisce comunque di leggerne uno non autorizzato.
    supabase.from('restaurants').select('owner_id').eq('id', restaurantIds[0]).maybeSingle(),
  ])

  if (error) return NextResponse.json({ error: 'Errore nel recupero dei dati: ' + error.message }, { status: 500 })

  const chiusure: ChiusuraRiga[] = ((data ?? []) as unknown as Array<{
    id: string; data: string; totale_entrate: number; totale_spese_giornaliere: number; differenza: number
    coperti: number; incasso_asporto: number; entrate_contanti: number; entrate_pos: number; entrate_bonifico: number
    fondo_cassa_iniziale: number; fondo_cassa_finale: number; contanti_per_banca: number; banca_teorica: number
    media_scontrino: number; restaurant: { name: string } | null
  }>).map(r => ({
    id: r.id,
    data: r.data,
    restaurant_name: r.restaurant?.name ?? '—',
    totale_entrate: r.totale_entrate,
    totale_spese_giornaliere: r.totale_spese_giornaliere,
    differenza: r.differenza,
    coperti: r.coperti,
    incasso_asporto: r.incasso_asporto,
    entrate_contanti: r.entrate_contanti,
    entrate_pos: r.entrate_pos,
    entrate_bonifico: r.entrate_bonifico,
    fondo_cassa_iniziale: r.fondo_cassa_iniziale,
    fondo_cassa_finale: r.fondo_cassa_finale,
    contanti_per_banca: r.contanti_per_banca,
    banca_teorica: r.banca_teorica,
    media_scontrino: r.media_scontrino,
  }))

  const spese = await fetchSpese(supabase, chiusure)
  const ownerId = restaurantRow?.owner_id ?? null

  const nomiLocali = Array.from(new Set(chiusure.map(c => c.restaurant_name)))
  const scopeLabel = nomiLocali.length === 0
    ? 'nessun locale con dati disponibili'
    : nomiLocali.length === 1 ? nomiLocali[0] : `${nomiLocali.length} locali (${nomiLocali.join(', ')})`

  const system = buildSystemPrompt(
    scopeLabel,
    formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'),
    chiusure[0]?.data ?? null,
    chiusure[chiusure.length - 1]?.data ?? null
  )
  const tools = buildTools(supabase, restaurantIds, ownerId, chiusure, spese)
  const messages: ModelMessage[] = clientMessages.map(m => ({ role: m.role, content: m.content }))

  const generate = (model: string) => generateText({ model: google(model), system, messages, tools, stopWhen: stepCountIs(8) })

  try {
    let result
    try {
      result = await generate(GEMINI_MODEL)
    } catch (err) {
      if (!isRateLimitError(err) || GEMINI_FALLBACK_MODEL === GEMINI_MODEL) throw err
      console.warn(`[analisi/ai] Quota esaurita per ${GEMINI_MODEL}, passo a ${GEMINI_FALLBACK_MODEL}`)
      result = await generate(GEMINI_FALLBACK_MODEL)
    }

    const text = result.text?.trim()
    if (!text) return NextResponse.json({ error: 'Non sono riuscito a generare una risposta. Riprova.' }, { status: 502 })
    return NextResponse.json({ risposta: text })
  } catch (err) {
    console.error('Errore AI Analisi:', err instanceof Error ? err.stack ?? err.message : err)
    if (isRateLimitError(err)) {
      return NextResponse.json({ error: 'Troppe richieste all\'assistente AI in questo momento, riprova tra poco.' }, { status: 429 })
    }
    return NextResponse.json({ error: 'Errore nella risposta dell\'assistente AI, riprova.' }, { status: 502 })
  }
}
