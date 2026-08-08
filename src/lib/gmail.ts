// Client Gmail minimale (solo lettura) costruito su fetch: serve a
// leggere periodicamente la casella su cui TheFork e Restoo recapitano
// le notifiche di prenotazione. Nessuna libreria googleapis — servono
// due sole chiamate REST e il refresh del token, e la dipendenza
// ufficiale porterebbe dietro decine di MB per niente.
//
// Autenticazione: OAuth2 con refresh token "offline" generato una volta
// sola dal proprietario della casella (vedi README/.env.example). Il
// refresh token non scade finché l'app OAuth è pubblicata in
// produzione: in modalità "Testing" Google lo invalida dopo 7 giorni.

import { sceglieCorpoMail } from '@/lib/stripHtml'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export function gmailConfigurato(): boolean {
  return !!(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN
  )
}

export class GmailNonConfigurato extends Error {
  constructor() {
    super('Gmail non configurato: mancano GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN')
  }
}

// Un access token dura un'ora; la cache a modulo evita di rinnovarlo a
// ogni messaggio letto nello stesso ciclo di sincronizzazione.
let cachedToken: { value: string; scadenza: number } | null = null

async function accessToken(): Promise<string> {
  if (!gmailConfigurato()) throw new GmailNonConfigurato()
  if (cachedToken && cachedToken.scadenza > Date.now() + 60_000) return cachedToken.value

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type:    'refresh_token',
    }),
  })

  if (!res.ok) {
    const testo = await res.text()
    throw new Error(`Rinnovo token Gmail fallito (${res.status}): ${testo}`)
  }

  const json = await res.json() as { access_token: string; expires_in: number }
  cachedToken = { value: json.access_token, scadenza: Date.now() + json.expires_in * 1000 }
  return json.access_token
}

async function apiGet<T>(path: string): Promise<T> {
  const token = await accessToken()
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const testo = await res.text()
    throw new Error(`Gmail ${path} → ${res.status}: ${testo}`)
  }
  return res.json() as Promise<T>
}

interface GmailPart {
  mimeType?: string
  filename?: string
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
  headers?: Array<{ name: string; value: string }>
}

interface GmailMessage {
  id: string
  threadId: string
  internalDate?: string
  payload?: GmailPart
}

export interface MessaggioGmail {
  id:        string
  threadId:  string
  ricevutaAt: string | null
  mittente:  string
  oggetto:   string
  testo:     string
  debug:     { plain: string; html: string }
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

// Le mail dei gestionali sono multipart HTML: quale dei due rami usare
// (sceglieCorpoMail, non semplicemente "plain se c'è") lo decide chi
// chiama, non questa funzione — qui si estraggono entrambi e basta.
function estraiTesto(part: GmailPart | undefined): { plain: string; html: string } {
  if (!part) return { plain: '', html: '' }

  const acc = { plain: '', html: '' }
  const visita = (p: GmailPart) => {
    // Gli allegati hanno un filename: non fanno parte del corpo.
    if (!p.filename && p.body?.data) {
      const testo = decodeBase64Url(p.body.data)
      if (p.mimeType === 'text/plain') acc.plain += (acc.plain ? '\n' : '') + testo
      else if (p.mimeType === 'text/html') acc.html += (acc.html ? '\n' : '') + testo
    }
    p.parts?.forEach(visita)
  }
  visita(part)
  return acc
}

function header(payload: GmailPart | undefined, nome: string): string {
  const h = payload?.headers?.find(x => x.name.toLowerCase() === nome.toLowerCase())
  return h?.value ?? ''
}

// Quale casella si sta effettivamente leggendo. È la verifica che
// nessun'altra risponde: le credenziali possono essere valide ma emesse
// per l'account sbagliato, e in quel caso la sincronizzazione gira senza
// errori e non trova mai niente.
export async function profiloGmail(): Promise<{ emailAddress: string; messagesTotal: number }> {
  return apiGet<{ emailAddress: string; messagesTotal: number }>('/profile')
}

// Cerca i messaggi che soddisfano una query in sintassi Gmail e ne
// restituisce solo gli ID (la lista non porta con sé il corpo).
export async function cercaMessaggi(query: string, max = 50): Promise<string[]> {
  const params = new URLSearchParams({ q: query, maxResults: String(Math.min(max, 100)) })
  const json = await apiGet<{ messages?: Array<{ id: string }> }>(`/messages?${params}`)
  return (json.messages ?? []).map(m => m.id)
}

export async function leggiMessaggio(id: string): Promise<MessaggioGmail> {
  const msg = await apiGet<GmailMessage>(`/messages/${id}?format=full`)
  const { plain, html } = estraiTesto(msg.payload)
  const testo = sceglieCorpoMail(plain, html)

  return {
    id:         msg.id,
    threadId:   msg.threadId,
    ricevutaAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
    mittente:   header(msg.payload, 'From'),
    oggetto:    header(msg.payload, 'Subject'),
    // Il corpo di certe mail marketing è enorme: al parser bastano le
    // prime migliaia di caratteri, dove stanno sempre i dati della
    // prenotazione.
    testo:      testo.slice(0, 12_000),
    debug:      { plain, html },
  }
}
