// Le notifiche "Nuova prenotazione" di TheFork Manager non scrivono
// data e orario nel corpo del messaggio: quei dati stanno solo dietro il
// tasto "Vedi i dettagli", che porta a manager.thefork.com/booking/<data>.
// Quel link però non è mai in chiaro nel testo — TheFork lo fa passare
// da un redirect di tracciamento (mailjet.lafourchette.com/lnk/.../<b64>)
// il cui ultimo segmento di percorso è l'URL reale codificato in base64.
//
// Decodificarlo è deterministico: niente da indovinare, a differenza
// della data — che nel corpo del messaggio semplicemente non c'è, quindi
// l'AI non potrebbe fare altro che tirarla a indovinare — questo invece
// la legge dal link stesso. L'orario non è recuperabile in nessun modo:
// il link porta alla pagina del GIORNO, non a un orario preciso.

export interface DatiLinkTheFork {
  data:        string | null // yyyy-MM-dd
  riferimento: string | null // reservationId del gestionale
}

const RE_LINK_MAILJET = /https:\/\/mailjet\.lafourchette\.com\/lnk\/[^\s"'<>]+/gi
const RE_BOOKING_DIRETTO = /manager\.thefork\.com\/booking\/(\d{4}-\d{2}-\d{2})[^\s"'<>]*/i
// "reservationId" seguito da un separatore che può essere "=", l'entità
// HTML "&#x3D;" (capita che TheFork la lasci non decodificata dentro il
// link) o la sua forma doppiamente sfuggita "&amp;#x3D;".
const RE_RESERVATION_ID = /reservationId(?:=|&#x3D;|&amp;#x3D;)([0-9a-f-]{36})/i

function base64UrlDecode(segmento: string): string | null {
  try {
    const normalizzato = segmento.replace(/-/g, '+').replace(/_/g, '/')
    const conPadding = normalizzato + '='.repeat((4 - (normalizzato.length % 4)) % 4)
    return Buffer.from(conPadding, 'base64').toString('utf8')
  } catch {
    return null
  }
}

function estraiDaUrlDecodificato(url: string): DatiLinkTheFork | null {
  const dataMatch = RE_BOOKING_DIRETTO.exec(url)
  if (!dataMatch) return null
  const rifMatch = RE_RESERVATION_ID.exec(url)
  return { data: dataMatch[1], riferimento: rifMatch?.[1] ?? null }
}

// Cerca in tutto il testo della mail un link che porti a una prenotazione
// TheFork — diretto o dietro il redirect mailjet — e ne estrae data e
// reservationId. null quando il testo non ne contiene nessuno: capita
// per le mail che non sono "nuova prenotazione" (es. disdette, che a
// volte non includono questo tasto).
export function estraiDaLinkTheFork(testo: string): DatiLinkTheFork | null {
  // Caso diretto: il link non è passato da un redirect (mail vista come
  // testo semplice che riporta l'URL così com'è, o un client che l'ha
  // già seguito).
  const diretto = estraiDaUrlDecodificato(testo)
  if (diretto) return diretto

  // Caso reale: uno o più redirect di tracciamento nel testo. Si prova
  // ogni link finché uno non decodifica in una pagina di prenotazione —
  // la stessa mail può contenerne altri (footer, cancellazione iscrizione)
  // che non c'entrano.
  const link = testo.match(RE_LINK_MAILJET)
  if (!link) return null

  for (const url of link) {
    const senzaFrammento = url.split('#')[0]
    const segmento = senzaFrammento.split('/').pop()
    if (!segmento) continue
    const decodificato = base64UrlDecode(segmento)
    if (!decodificato) continue
    const risultato = estraiDaUrlDecodificato(decodificato)
    if (risultato) return risultato
  }

  return null
}
