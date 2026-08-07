// Attribuzione di una prenotazione al locale giusto.
//
// Alla stessa casella arrivano le notifiche di tutti i locali del gruppo,
// ma questa agenda è solo di Porto Rotondo. Regola di fondo: si importa
// SOLO ciò che corrisponde a un'insegna configurata — nessuna euristica,
// nessun ripiego su un locale "probabile". Nel dubbio la prenotazione
// resta fuori: un buco in agenda si vede e si recupera, una prenotazione
// di Talenti finita fra quelle di Porto Rotondo no.

export interface Insegna {
  restaurant_id: string
  codice:        string
  termini:       string[]
  priorita:      number
}

export interface LocaleIgnorato {
  termine: string
  motivo:  string | null
}

function normalizza(testo: string): string {
  return testo.toLowerCase().replace(/\s+/g, ' ').trim()
}

// Veto esplicito: la notifica riguarda un locale che ha un suo libro
// visite. Si guardano il nome del locale e l'oggetto della mail — testi
// brevi e specifici — e non il corpo intero, dove un piè di pagina che
// elenca tutti i locali del gruppo farebbe scartare qualunque cosa.
export function localeDaIgnorare(
  ignorati: LocaleIgnorato[],
  campi: Array<string | null | undefined>
): LocaleIgnorato | null {
  const testo = normalizza(campi.filter(Boolean).join(' | '))
  if (!testo) return null
  return ignorati.find(i => testo.includes(normalizza(i.termine))) ?? null
}

// Corrisponde solo l'insegna di cui compaiono TUTTI i termini: quella di
// Porto Rotondo richiede sia "crunch" sia "porto rotondo", così
// "Crunch! - Talenti" non può corrispondere. A parità, vince la priorità
// più bassa (Benthos prima di Crunch).
export function abbinaInsegna(insegne: Insegna[], locale: string | null): Insegna | null {
  if (!locale) return null
  const testo = normalizza(locale)
  if (!testo) return null

  return (
    [...insegne]
      .sort((a, b) => a.priorita - b.priorita)
      .find(i => i.termini.length > 0 && i.termini.every(t => testo.includes(normalizza(t)))) ?? null
  )
}
