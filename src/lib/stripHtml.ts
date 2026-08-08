// Riduzione di un corpo HTML a testo semplice, quando una mail non porta
// una parte text/plain. Condiviso fra tutte le vie d'ingresso delle
// notifiche di prenotazione (lettura Gmail, webhook CloudMailin): non è
// un dettaglio del client Gmail, è una conversione generica.
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

// Sceglie il corpo più sostanzioso fra la parte text/plain e quella HTML
// (ripulita) di una mail multipart.
//
// Non ci si può fidare che "plain se non è vuoto" sia sempre la scelta
// giusta: le notifiche TheFork viste in produzione arrivano con una
// parte text/plain che è solo il testo dell'oggetto ripetuto — non vuota,
// quindi "vince" comunque su un `plain.trim() || html`, ma inutile: il
// nome del cliente, il telefono, i coperti stanno solo nell'HTML. Con
// quella logica ogni mail veniva letta come "senza dati", non per un
// errore di interpretazione ma perché il testo passato al parser non
// conteneva letteralmente nient'altro che il titolo.
//
// Si sceglie sempre la versione più lunga delle due: un corpo reale è
// sempre più ricco di un semplice doppione del subject, qualunque sia il
// mittente.
export function sceglieCorpoMail(plain: string, html: string): string {
  const testoPlain = plain.trim()
  const testoHtml = stripHtml(html)
  return testoHtml.length > testoPlain.length ? testoHtml : testoPlain
}
