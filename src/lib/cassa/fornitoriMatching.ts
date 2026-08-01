// Riconoscimento fornitore già a catalogo anche quando il nome non è
// identico carattere per carattere (es. "Pregis S.p.A." vs "Pregis SpA")
// o quando la partita IVA letta da una fattura non coincide con quella
// già a sistema per lo stesso fornitore — capita, es. un errore di
// lettura OCR su una singola cifra — e senza un fallback sul nome questo
// crea un fornitore duplicato invece di riconoscere quello esistente.

// Rimuove i punti PRIMA di normalizzare gli altri caratteri: "S.p.A."
// deve diventare "spa" (lettere adiacenti), non "s p a" (spezzata dagli
// spazi che sostituirebbero i punti) — la sigla della forma societaria è
// il caso di variazione più comune fra due letture della stessa fattura.
const FORME_SOCIETARIE = /\b(spa|srl|srls|sas|snc|sapa|scarl|soc coop|coop)\b/g

export function normalizzaNomeFornitore(nome: string): string {
  return nome
    .replace(/\./g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(FORME_SOCIETARIE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function bigrammi(s: string): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return set
}

// Coefficiente di Dice sui bigrammi — 1 se identiche, 0 se non hanno
// nulla in comune. Semplice ma efficace per varianti di battitura/OCR a
// parità di forma societaria già rimossa dalla normalizzazione sopra.
export function similaritaNomi(a: string, b: string): number {
  if (a === b) return 1
  const ba = bigrammi(a)
  const bb = bigrammi(b)
  if (ba.size === 0 || bb.size === 0) return 0
  let comuni = 0
  for (const g of ba) if (bb.has(g)) comuni++
  return (2 * comuni) / (ba.size + bb.size)
}

// Soglia scelta per catturare varianti di punteggiatura/OCR restando
// prudenti sui falsi positivi: due fornitori realmente diversi con nomi
// brevi e simili (es. "Pregis" vs "Prealpi") non devono finire fusi.
const SOGLIA_DUPLICATO = 0.85

// Punteggio assegnato quando un nome è il prefisso esatto dell'altro
// (vedi unoEPrefissoDellAltro) — sopra soglia, ma sotto il match esatto.
const PUNTEGGIO_PREFISSO = 0.9

// Il coefficiente di Dice sui bigrammi cattura bene le varianti di
// battitura/OCR a parità di lunghezza, ma penalizza troppo un'intera
// parola aggiunta in coda: "Leroy Merlin" vs "Leroy Merlin Italia
// S.r.l.", o "Castelli Carta Srl" vs "Castelli Carta Srl Print" (magari
// letto da un'insegna/slogan), scendono sotto SOGLIA_DUPLICATO pur
// essendo quasi certamente lo stesso fornitore con una dicitura più o
// meno estesa. Un nome che è ESATTAMENTE il prefisso dell'altro (fino a
// un confine di parola, non a metà parola) è un segnale forte e
// indipendente dalla lunghezza aggiunta. Richiede almeno 2 parole sul
// nome più corto per evitare falsi positivi su un'unica parola generica
// (es. "Roma" non deve fondersi con "Roma Trasporti").
function unoEPrefissoDellAltro(a: string, b: string): boolean {
  const corto = a.length <= b.length ? a : b
  const lungo = a.length <= b.length ? b : a
  if (!corto || corto.split(' ').length < 2) return false
  return lungo === corto || lungo.startsWith(corto + ' ')
}

export interface CandidatoFornitore {
  id: string
  nome: string
  partita_iva: string | null
}

// Miglior candidato per nome fra quelli esistenti, oltre la soglia di
// somiglianza — null se nessuno è abbastanza vicino. Il chiamante prova
// prima il match esatto per partita IVA quando disponibile; questo è il
// fallback (o l'unica via se la partita IVA letta non coincide con
// nessuna esistente, ma il nome sì).
export function trovaFornitoreSimile(nome: string, candidati: CandidatoFornitore[]): CandidatoFornitore | null {
  const normalizzato = normalizzaNomeFornitore(nome)
  if (!normalizzato) return null

  let migliore: { candidato: CandidatoFornitore; punteggio: number } | null = null
  for (const c of candidati) {
    const normC = normalizzaNomeFornitore(c.nome)
    const punteggio = normC === normalizzato
      ? 1
      : unoEPrefissoDellAltro(normalizzato, normC)
        ? PUNTEGGIO_PREFISSO
        : similaritaNomi(normalizzato, normC)
    if (punteggio >= SOGLIA_DUPLICATO && (!migliore || punteggio > migliore.punteggio)) {
      migliore = { candidato: c, punteggio }
    }
  }
  return migliore?.candidato ?? null
}
