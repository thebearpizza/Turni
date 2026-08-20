import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { generateText, tool, stepCountIs, type ModelMessage } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import { formatInTimeZone } from 'date-fns-tz'
import { getDaysInMonth, isLeapYear } from 'date-fns'

const TZ = 'Europe/Rome'

function round2(n: number): number {
  return Math.round(n * 100) / 100
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

interface ChiusuraRiga {
  data: string
  restaurant_name: string
  totale_entrate: number
  totale_spese_giornaliere: number
  differenza: number
  coperti: number
  incasso_asporto: number
}

// Tutti i numeri che l'AI cita vengono da qui, mai calcolati da lei:
// un LLM non è affidabile per sommare decine di righe a mente, quindi gli
// strumenti fanno l'aritmetica in TypeScript e l'AI si limita a scegliere
// quale chiamare e a spiegare il risultato in linguaggio naturale.
function buildTools(chiusure: ChiusuraRiga[]) {
  return {
    dati_periodo: tool({
      description: 'Somma entrate, spese, margine, coperti e incasso asporto in un intervallo di date (estremi inclusi). Usa questo strumento per qualsiasi domanda su un mese, una settimana o un range di giorni.',
      inputSchema: z.object({
        inizio: z.string().describe('Data di inizio, formato yyyy-MM-dd'),
        fine: z.string().describe('Data di fine, formato yyyy-MM-dd (inclusa)'),
      }),
      execute: async ({ inizio, fine }) => {
        const righe = chiusure.filter(c => c.data >= inizio && c.data <= fine)
        if (righe.length === 0) {
          return { giorni_con_dati: 0, messaggio: 'Nessuna chiusura confermata in questo intervallo di date.' }
        }
        const entrate = righe.reduce((s, r) => s + r.totale_entrate, 0)
        const spese = righe.reduce((s, r) => s + r.totale_spese_giornaliere, 0)
        const giorni = new Set(righe.map(r => r.data)).size
        return {
          giorni_con_dati: giorni,
          totale_entrate: round2(entrate),
          totale_spese: round2(spese),
          margine_operativo: round2(entrate - spese),
          coperti_totali: righe.reduce((s, r) => s + r.coperti, 0),
          incasso_asporto: round2(righe.reduce((s, r) => s + r.incasso_asporto, 0)),
          media_entrate_giornaliera: round2(entrate / giorni),
        }
      },
    }),
    dati_giorno: tool({
      description: 'Dettaglio di un singolo giorno, un elemento per locale se ne sono selezionati più di uno.',
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
            spese: r.totale_spese_giornaliere,
            differenza_cassa: r.differenza,
            coperti: r.coperti,
            incasso_asporto: r.incasso_asporto,
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

        return {
          da: inizioPeriodo,
          a_oggi: oggi,
          entrate_finora: round2(entrateFinora),
          giorni_con_dati: giorniConDati,
          giorni_totali_nel_periodo: giorniTotali,
          media_giornaliera: round2(mediaGiornaliera),
          proiezione: round2(mediaGiornaliera * giorniTotali),
          nota: 'Stima lineare: proietta in avanti la media giornaliera osservata finora, senza tenere conto di stagionalità (weekend, festività, alta/bassa stagione). Tanto più incerta quanto meno giorni di storico sono disponibili.',
        }
      },
    }),
  }
}

function buildSystemPrompt(scopeLabel: string, oggi: string, primaData: string | null, ultimaData: string | null): string {
  return `Sei l'assistente AI della pagina Analisi di "Turni" (gestione cassa di ristoranti italiani) — rispondi a domande sull'andamento economico dei locali.

Ambito attuale: ${scopeLabel}.
Data di oggi: ${oggi}.
${primaData && ultimaData ? `Dati disponibili dal ${primaData} al ${ultimaData}.` : 'Non risultano ancora chiusure confermate in questo ambito.'}

ISTRUZIONI:
- Rispondi sempre in italiano, tono professionale ma colloquiale, conciso: vai dritto ai numeri, senza premesse lunghe.
- Usa SEMPRE uno strumento per ottenere i numeri prima di rispondere. Non sommare né calcolare medie a mente, non inventare MAI un numero: se lo strumento non te lo dà, non esiste.
- Domanda su un mese/settimana/intervallo → dati_periodo. Domanda su un giorno preciso → dati_giorno. Domanda su un andamento futuro (fine mese, fine anno, "quanto incasseremo") → previsione.
- Se la domanda non specifica un periodo (es. "come stiamo andando?"), usa il mese in corso.
- In una proiezione, riporta sempre la nota sulla stima lineare che ricevi dallo strumento: l'utente deve capire che è una stima, non un dato certo.
- Se uno strumento segnala che non ci sono dati per il periodo richiesto, dillo chiaramente invece di inventare qualcosa.
- Non menzionare mai ID interni o dettagli tecnici: solo numeri, date e nomi dei locali.`
}

// POST /api/cassa/analisi/ai
// Body: { restaurant_ids: string[], messages: { role: 'user'|'assistant', content: string }[] }
//
// Chat testuale sopra i dati già visibili in Analisi (stessa tabella
// cassa_chiusure, stesso filtro stato='confermata'), con tool-calling
// invece di un'unica risposta libera: ogni numero che l'AI cita viene da
// un calcolo fatto qui in TypeScript sulle righe già caricate, non da
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
  const { data, error } = await supabase
    .from('cassa_chiusure')
    .select('data, totale_entrate, totale_spese_giornaliere, differenza, coperti, incasso_asporto, restaurant:restaurants(name)')
    .in('restaurant_id', restaurantIds)
    .eq('stato', 'confermata')
    .order('data', { ascending: true })

  if (error) return NextResponse.json({ error: 'Errore nel recupero dei dati: ' + error.message }, { status: 500 })

  const chiusure: ChiusuraRiga[] = ((data ?? []) as unknown as Array<{
    data: string; totale_entrate: number; totale_spese_giornaliere: number; differenza: number
    coperti: number; incasso_asporto: number; restaurant: { name: string } | null
  }>).map(r => ({
    data: r.data,
    restaurant_name: r.restaurant?.name ?? '—',
    totale_entrate: r.totale_entrate,
    totale_spese_giornaliere: r.totale_spese_giornaliere,
    differenza: r.differenza,
    coperti: r.coperti,
    incasso_asporto: r.incasso_asporto,
  }))

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
  const tools = buildTools(chiusure)
  const messages: ModelMessage[] = clientMessages.map(m => ({ role: m.role, content: m.content }))

  const generate = (model: string) => generateText({ model: google(model), system, messages, tools, stopWhen: stepCountIs(6) })

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
