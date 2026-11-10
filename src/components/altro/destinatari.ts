// Destinatari dei comunicati in bacheca: una sola regola usata sia dalla
// scheda (contatore "letti / destinatari", chi non ha ancora letto) sia
// dalle API che inviano le notifiche. Niente import React: la usano anche le
// route del server.

export type TargetBacheca = 'all' | 'restaurant' | 'role' | 'users' | 'department'

export interface PersonaStaff {
  id: string
  full_name: string
  role: string
  is_direttore: boolean | null
  restaurant_id: string | null
  department: string | null
}

export interface BersaglioBacheca {
  target: TargetBacheca
  restaurant_id: string | null
  target_roles: string[] | null
  target_user_ids: string[] | null
  target_department: string | null
}

/** Ruoli che ricevono i comunicati (il prototipo: dipendenti, capi servizio, direttori). */
export const RUOLI_BACHECA = ['dipendente', 'capo_servizio']

/** Chi riceve il comunicato, fra le persone date (già limitate allo scope di chi guarda). */
export function destinatariDi(b: BersaglioBacheca, staff: PersonaStaff[]): PersonaStaff[] {
  const inLoc = (p: PersonaStaff) => !b.restaurant_id || p.restaurant_id === b.restaurant_id
  switch (b.target) {
    case 'all':
    case 'restaurant':
      return staff.filter(inLoc)
    case 'role':
      return staff.filter(p => inLoc(p) && (b.target_roles ?? []).includes(p.role))
    case 'department':
      return staff.filter(p => inLoc(p) && p.department === b.target_department)
    case 'users': {
      const ids = new Set(b.target_user_ids ?? [])
      return staff.filter(p => ids.has(p.id))
    }
  }
}

export type RuoloScelta = 'Dipendenti' | 'Capi servizio' | 'Direttori'

export function ruoloScelta(p: PersonaStaff): RuoloScelta {
  if (p.role === 'capo_servizio') return p.is_direttore ? 'Direttori' : 'Capi servizio'
  return 'Dipendenti'
}

export interface SceltaDestinatari {
  /** null = tutti i locali */
  locale: string | null
  modo: 'Tutti' | 'Per ruolo' | 'Persone'
  ruoli: RuoloScelta[]
  persone: string[]
  reparti: string[]
}

/** Le persone scelte nel foglio "Nuovo comunicato" (stessa regola del prototipo). */
export function personeScelte(s: SceltaDestinatari, staff: PersonaStaff[]): PersonaStaff[] {
  if (s.modo === 'Persone') { const ids = new Set(s.persone); return staff.filter(p => ids.has(p.id)) }
  return staff.filter(p =>
    (s.locale === null || p.restaurant_id === s.locale) &&
    (!s.reparti.length || (p.department != null && s.reparti.includes(p.department))) &&
    (s.modo !== 'Per ruolo' || s.ruoli.includes(ruoloScelta(p))))
}

/**
 * Traduce la scelta nelle colonne di `bulletins`. Quando la combinazione è
 * esprimibile con un bersaglio "aperto" (tutti, un locale, un reparto di un
 * locale, un ruolo) si usa quello, così vale anche per chi verrà assunto
 * dopo; altrimenti si salva l'elenco esatto delle persone scelte.
 */
export function bersaglioDa(s: SceltaDestinatari, scelte: PersonaStaff[]): BersaglioBacheca {
  const vuoto = { restaurant_id: null, target_roles: [] as string[], target_user_ids: [] as string[], target_department: null }
  if (s.modo === 'Tutti') {
    if (!s.reparti.length) return s.locale ? { ...vuoto, target: 'restaurant', restaurant_id: s.locale } : { ...vuoto, target: 'all' }
    if (s.reparti.length === 1 && s.locale) return { ...vuoto, target: 'department', restaurant_id: s.locale, target_department: s.reparti[0] }
  }
  if (s.modo === 'Per ruolo' && !s.locale && !s.reparti.length) {
    // Nel database "direttore" non è un ruolo: è un capo servizio con un
    // flag. Capi e direttori vanno quindi scelti insieme per poter usare il
    // bersaglio per ruolo.
    const capi = s.ruoli.includes('Capi servizio'), dir = s.ruoli.includes('Direttori')
    if (capi === dir) {
      const r = [...(s.ruoli.includes('Dipendenti') ? ['dipendente'] : []), ...(capi ? ['capo_servizio'] : [])]
      if (r.length) return { ...vuoto, target: 'role', target_roles: r }
    }
  }
  // restaurant_id resta vuoto come nei comunicati "a persone" di prima: la
  // visibilità dipende solo dall'elenco.
  return { ...vuoto, target: 'users', target_user_ids: scelte.map(p => p.id) }
}
