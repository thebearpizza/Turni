// Parametri della lettura casella, condivisi da sincronizzazione e
// diagnostica. Stanno insieme perché devono restare identici: se la
// diagnostica cercasse con criteri diversi da quelli della
// sincronizzazione direbbe "trovo le mail" mentre l'agenda resta vuota —
// cioè risponderebbe alla domanda sbagliata.

// Mittenti da cui possono arrivare notifiche di prenotazione. Volutamente
// larga: il filtro fine (è davvero una prenotazione?) lo fa l'AI, qui si
// vuole solo evitare di dare in pasto al modello l'intera casella.
export const MITTENTI = [
  'thefork.com',
  'theforkmanager.com',
  'restaurant-information.com',
  'lafourchette.com',
  'restoo.me',
  'restoo.it',
]

// Finestra di sicurezza: si rileggono sempre gli ultimi giorni e si
// scartano per gmail_message_id le mail già lavorate. Nessuno stato di
// avanzamento da mantenere, e un fermo dello scheduler di qualche ora si
// recupera da solo al primo giro utile.
export const GIORNI_FINESTRA = 3
export const MAX_MESSAGGI = 60

export function queryMittenti(giorni: number = GIORNI_FINESTRA): string {
  return `(${MITTENTI.map(m => `from:${m}`).join(' OR ')}) newer_than:${giorni}d`
}
