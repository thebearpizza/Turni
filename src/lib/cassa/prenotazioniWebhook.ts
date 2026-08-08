import { createHash } from 'crypto'
import { sceglieCorpoMail } from '@/lib/stripHtml'
import type { MessaggioPrenotazione } from '@/lib/cassa/prenotazioniEmailProcessing'

// Traduce il payload JSON che CloudMailin invia al webhook nello stesso
// formato (mittente/oggetto/testo/ricevutaAt) già usato per le mail lette
// da Gmail — a valle, lavoraMail() non deve sapere da dove è arrivata la
// mail. Funzione pura, senza I/O: è la parte più delicata di questa via
// d'ingresso (un payload malformato non deve mai far cadere il webhook,
// solo produrre un esito "non riconosciuto"), quindi va testata con dati
// finti prima di collegarla a un endpoint vero.
//
// Formato atteso: CloudMailin configurato con "HTTP Post Format: JSON".
// headers arriva come oggetto con chiavi in minuscolo; un header ripetuto
// (es. Received) può comparire come array — qui interessano solo header
// che compaiono una volta sola, quindi si prende sempre il primo valore.

interface PayloadCloudMailin {
  envelope?: { to?: string; from?: string; recipients?: string[] }
  headers?: Record<string, unknown>
  plain?: string
  html?: string
}

function headerValue(headers: Record<string, unknown> | undefined, nome: string): string {
  if (!headers) return ''
  const chiave = Object.keys(headers).find(k => k.toLowerCase() === nome.toLowerCase())
  if (chiave === undefined) return ''
  const v = headers[chiave]
  if (Array.isArray(v)) return v.length ? String(v[0]) : ''
  return v == null ? '' : String(v)
}

function dataValida(testo: string): string | null {
  if (!testo) return null
  const d = new Date(testo)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export interface MessaggioWebhook {
  messageId: string
  msg: MessaggioPrenotazione
}

export function estraiMessaggioCloudMailin(payload: unknown): MessaggioWebhook | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as PayloadCloudMailin

  const headers = p.headers
  const mittente = headerValue(headers, 'from') || p.envelope?.from || ''
  const oggetto  = headerValue(headers, 'subject')
  const dataHeader = headerValue(headers, 'date')
  const ricevutaAt = dataValida(dataHeader)

  const plain = typeof p.plain === 'string' ? p.plain : ''
  const html  = typeof p.html  === 'string' ? p.html  : ''
  // Stesso taglio usato per Gmail: al parser AI bastano le prime migliaia
  // di caratteri, dove stanno sempre i dati della prenotazione.
  const testo = sceglieCorpoMail(plain, html).slice(0, 12_000)

  // Un payload senza nessuno di questi tre campi non è una mail utile:
  // o non è CloudMailin, o è un evento vuoto di test.
  if (!mittente && !oggetto && !testo) return null

  // Message-ID è la chiave ideale per l'idempotenza: stabile, univoca a
  // livello di protocollo SMTP. Quando manca (capita) si ricostruisce un
  // identificativo stabile dagli stessi campi che il webhook potrebbe
  // rimandare in una consegna ripetuta, così un doppio invio non genera
  // due prenotazioni.
  const messageIdHeader = headerValue(headers, 'message-id').replace(/^<|>$/g, '').trim()
  const messageId = messageIdHeader || createHash('sha256')
    .update([mittente, oggetto, dataHeader, plain.slice(0, 300)].filter(Boolean).join('|') || JSON.stringify(p).slice(0, 500))
    .digest('hex')

  return {
    messageId,
    // debug: plain/html grezzi, non passati al parser AI — servono solo
    // se un giorno il testo scelto risulta di nuovo sbagliato, per
    // vedere subito cosa conteneva davvero ciascuna parte invece di
    // doverlo dedurre dalla lunghezza del risultato finale (così è
    // stato scoperto questo bug: il testo salvato coincideva esatto con
    // l'oggetto, e senza le parti grezze c'era da indovinare il perché).
    msg: { mittente, oggetto, testo, ricevutaAt, debug: { plain, html } },
  }
}
