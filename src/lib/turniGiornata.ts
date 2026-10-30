import type { Turn } from '@/types'

// Turni raggruppati per giornata (un turno spezzato = più fasce nello
// stesso giorno lavorativo; quelli oltre mezzanotte restano del giorno in
// cui iniziano) e durata in minuti, per le viste del dipendente.

export interface Giornata {
  date: string
  turni: Turn[]
  riposo: boolean
  straordinario: boolean
  spezzato: boolean
  reparto: string | null
  fasce: string[]
  minuti: number
  note: string
}

function minutiTurno(t: Turn): number {
  const [h1, m1] = t.start_time.split(':').map(Number)
  const [h2, m2] = t.end_time.split(':').map(Number)
  let d = h2 * 60 + m2 - (h1 * 60 + m1)
  if (d <= 0) d += 24 * 60
  return d
}

export function raggruppaPerGiornata(turns: Turn[]): Giornata[] {
  const ord = [...turns].sort((a, b) => (a.date === b.date ? a.start_time.localeCompare(b.start_time) : a.date.localeCompare(b.date)))
  const mappa = new Map<string, Turn[]>()
  for (const t of ord) mappa.set(t.date, [...(mappa.get(t.date) ?? []), t])
  return Array.from(mappa, ([date, turni]) => {
    const lavoro = turni.filter(t => !t.is_rest_day)
    const riposo = turni.some(t => t.is_rest_day) && lavoro.length === 0
    return {
      date,
      turni,
      riposo,
      straordinario: !riposo && lavoro.some(t => t.is_extraordinary),
      spezzato: lavoro.length > 1,
      reparto: lavoro.find(t => t.department)?.department ?? null,
      fasce: lavoro.map(t => `${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)}`),
      minuti: lavoro.reduce((s, t) => s + minutiTurno(t), 0),
      note: Array.from(new Set(turni.map(t => t.notes).filter(Boolean))).join(' · '),
    }
  })
}

export function formatOre(minuti: number): string {
  const h = Math.floor(minuti / 60), m = minuti % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}
