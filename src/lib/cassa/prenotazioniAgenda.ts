import type { Prenotazione, PrenotazioneServizio } from '@/types'

// Fasce di servizio del locale. La cena parte alle 19:30 e chiude alle
// 23:30, il pranzo dalle 12:30 alle 15:30 — gli stessi orari del libro
// visite, così le due agende restano confrontabili riga per riga.
export const FASCE: Record<PrenotazioneServizio, { inizio: string; fine: string }> = {
  pranzo: { inizio: '12:30', fine: '15:30' },
  cena:   { inizio: '19:30', fine: '23:30' },
}

export const PASSO_MINUTI = 15

// Confine fra i due servizi: una prenotazione a mezzogiorno o alle 16
// resta "pranzo", una alle 18 è già "cena". Serve sia lato client
// (form manuale) sia lato server (mail e import), quindi vive qui.
const CONFINE_PRANZO_CENA = '17:00'

export function servizioDaOrario(orario: string): PrenotazioneServizio {
  return normalizzaOrario(orario) < CONFINE_PRANZO_CENA ? 'pranzo' : 'cena'
}

// Normalizza in "HH:mm" qualunque forma ragionevole: Postgres restituisce
// "20:00:00", l'AI può produrre "20:00" o "8:00", un input HTML "20:00".
export function normalizzaOrario(orario: string): string {
  const m = /^(\d{1,2})[:.](\d{2})/.exec(orario.trim())
  if (!m) return orario
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function minutiDa(hhmm: string): number {
  const [h, m] = normalizzaOrario(hhmm).split(':').map(Number)
  return h * 60 + m
}

function daMinuti(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export interface FasciaOraria {
  orario:       string       // HH:mm
  prenotazioni: Prenotazione[]
  coperti:      number
  fuoriFascia:  boolean      // orario non previsto dal servizio
}

// Costruisce le righe orario del servizio: gli slot fissi ogni 15
// minuti (che restano visibili anche vuoti, come nel libro visite, per
// dare il colpo d'occhio su quanto è pieno il servizio) più eventuali
// orari fuori fascia che hanno davvero una prenotazione — un tavolo
// prenotato alle 19:00 non deve sparire solo perché la fascia standard
// parte alle 19:30.
export function costruisciFasce(
  servizio: PrenotazioneServizio,
  prenotazioni: Prenotazione[]
): FasciaOraria[] {
  const { inizio, fine } = FASCE[servizio]
  const standard = new Set<string>()
  for (let m = minutiDa(inizio); m <= minutiDa(fine); m += PASSO_MINUTI) {
    standard.add(daMinuti(m))
  }

  const perOrario = new Map<string, Prenotazione[]>()
  for (const p of prenotazioni) {
    const orario = normalizzaOrario(p.orario)
    const lista = perOrario.get(orario)
    if (lista) lista.push(p)
    else perOrario.set(orario, [p])
  }

  const orari = [...new Set([...standard, ...perOrario.keys()])].sort(
    (a, b) => minutiDa(a) - minutiDa(b)
  )

  return orari.map(orario => {
    const lista = perOrario.get(orario) ?? []
    return {
      orario,
      prenotazioni: lista,
      coperti: lista.reduce((tot, p) => tot + p.persone + p.bambini, 0),
      fuoriFascia: !standard.has(orario),
    }
  })
}

export function contaCoperti(prenotazioni: Prenotazione[]): number {
  return prenotazioni.reduce((tot, p) => tot + p.persone + p.bambini, 0)
}

export function nomeCompleto(p: Pick<Prenotazione, 'nome' | 'cognome'>): string {
  return [p.nome, p.cognome].filter(Boolean).join(' ').trim()
}

// "3/1" quando ci sono bambini, "3" quando non ce ne sono — la stessa
// notazione del libro visite.
export function formatPax(p: Pick<Prenotazione, 'persone' | 'bambini'>): string {
  return p.bambini > 0 ? `${p.persone}/${p.bambini}` : String(p.persone)
}

export const ORIGINE_LABEL: Record<string, string> = {
  thefork: 'TheFork',
  restoo:  'Restoo',
  manuale: 'Inserita a mano',
  import:  'Importata da file',
}
