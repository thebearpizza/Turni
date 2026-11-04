// Calcolo condiviso del Report (MTReport.dc.html): lo usano sia la griglia a
// schermo (ReportClient, consulente) sia l'export Excel del server, così il
// file scaricato contiene esattamente ciò che si vede. Modulo puro: niente
// import lato server, si può caricare anche nel browser.
import { formatInTimeZone } from 'date-fns-tz'
import type { AbsenceType } from '@/types'

export const TZ_REPORT = 'Europe/Rome'

// Codici del design: F M R I (non più "AI" per l'ingiustificata).
export type CodiceAssenza = 'F' | 'M' | 'R' | 'I'
export const CODICE_DA_TIPO: Record<AbsenceType, CodiceAssenza> = {
  ferie: 'F', malattia: 'M', riposo: 'R', assenza_ingiustificata: 'I',
}
export const TIPO_DA_CODICE: Record<CodiceAssenza, AbsenceType> = {
  F: 'ferie', M: 'malattia', R: 'riposo', I: 'assenza_ingiustificata',
}
export const CODICI_ASSENZA: CodiceAssenza[] = ['F', 'M', 'R', 'I']
export const NOME_ASSENZA: Record<CodiceAssenza, string> = { F: 'Ferie', M: 'Malattia', R: 'Riposo', I: 'Ingiustificata' }

export type DipendenteRep = { id: string; full_name: string; restaurant_id: string | null; role?: string | null; department?: string | null }
export type PresenzaRep = { id: string; user_id: string; restaurant_id: string | null; check_in: string; check_out: string | null }
export type AssenzaRep = { id: string; user_id: string; restaurant_id: string | null; type: AbsenceType; start_date: string; end_date: string; certificate_code?: string | null; notes?: string | null }

export type Giorno =
  | { tipo: 'lavoro'; fasce: PresenzaRep[]; minuti: number; aperta: boolean }
  | { tipo: 'assenza'; codice: CodiceAssenza; assenza: AssenzaRep }
  | null

export function giorniDelMese(mese: string): number {
  const [y, m] = mese.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function dataDelGiorno(mese: string, g: number): string {
  return `${mese}-${String(g).padStart(2, '0')}`
}

/** Giorno lavorativo (Roma) di una timbratura: quello dell'ingresso, anche se l'uscita va oltre mezzanotte. */
export function giornoPresenza(p: PresenzaRep): string {
  return formatInTimeZone(new Date(p.check_in), TZ_REPORT, 'yyyy-MM-dd')
}

export function minutiPresenza(p: PresenzaRep): number {
  if (!p.check_out) return 0
  return Math.max(0, Math.round((new Date(p.check_out).getTime() - new Date(p.check_in).getTime()) / 60000))
}

/**
 * Griglia dipendente × giorno. Le timbrature vincono su un'eventuale assenza
 * approvata (un riposo registrato non deve far sparire ore davvero
 * lavorate): l'assenza vale solo quando nel giorno non c'è nessuna timbratura.
 */
export function calcolaGriglia(mese: string, dip: DipendenteRep[], pres: PresenzaRep[], ass: AssenzaRep[]): Map<string, Giorno[]> {
  const nd = giorniDelMese(mese)
  const perChiave = new Map<string, PresenzaRep[]>()
  for (const p of pres) {
    const k = p.user_id + '|' + giornoPresenza(p)
    const l = perChiave.get(k)
    if (l) l.push(p); else perChiave.set(k, [p])
  }
  const out = new Map<string, Giorno[]>()
  for (const e of dip) {
    const mie = ass.filter(a => a.user_id === e.id)
    const riga: Giorno[] = []
    for (let g = 1; g <= nd; g++) {
      const d = dataDelGiorno(mese, g)
      const fasce = (perChiave.get(e.id + '|' + d) ?? []).slice().sort((a, b) => a.check_in.localeCompare(b.check_in))
      if (fasce.length) {
        riga.push({ tipo: 'lavoro', fasce, minuti: fasce.reduce((s, p) => s + minutiPresenza(p), 0), aperta: fasce.some(p => !p.check_out) })
        continue
      }
      const a = mie.find(x => x.start_date <= d && x.end_date >= d)
      riga.push(a ? { tipo: 'assenza', codice: CODICE_DA_TIPO[a.type], assenza: a } : null)
    }
    out.set(e.id, riga)
  }
  return out
}

/** Ore come nel design: intere senza decimali, altrimenti una cifra con la virgola (7,5). */
export function oreBrevi(minuti: number): string {
  const h = minuti / 60
  return Number.isInteger(h) ? String(h) : h.toFixed(1).replace('.', ',')
}
