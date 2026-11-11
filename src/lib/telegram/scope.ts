import { scopeStaffQuery as scopeStaffBase, scopeTurnsQuery as scopeTurnsBase, type ScopeProfile } from '@/lib/turniScope'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { TelegramProfile } from './auth'

// ── RBAC helpers per i comandi Telegram ──────────────────────────────
// Stessa gerarchia dell'app web (turniScope.ts), riapplicata qui perché
// il bot opera con il client admin (service role) e bypassa la RLS:
// tutta l'autorizzazione deve essere fatta in questo livello applicativo.
//
//  - manager                       → GLOBALE (tutti i ristoranti/reparti),
//                                    ma solo sui locali visibili: gli attivi,
//                                    mai i nascosti (vedi locali_visibili)
//  - capo_servizio + is_direttore  → tutti i reparti del proprio ristorante
//  - capo_servizio (non direttore) → solo proprio ristorante + reparto

// ── Locali nascosti (restaurants.nascosto) ───────────────────────────
// Un locale chiuso o stagionale non deve entrare nei dati che il manager
// legge o scrive dal bot e dall'assistente. Il bot non ha cookie, quindi
// niente archivio: vale sempre "solo gli attivi". L'assistente in pagina
// (api/hub/assistente) ha invece la sessione e imposta da sé l'elenco,
// seguendo l'archivio aperto. Chi è legato a un solo locale (direttore,
// capo servizio) continua a operare sul proprio anche se nascosto.

type ScopeProfileTg = ScopeProfile & { locali_visibili?: string[] | null }
type QueryConIn<T> = { eq: (column: string, value: unknown) => T; in: (column: string, values: readonly unknown[]) => T }

/** Id dei locali attivi (non nascosti): l'ambito del manager nei processi senza cookie. */
export async function idLocaliAttivi(admin: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const { data } = await admin.from('restaurants').select('id').eq('nascosto', false)
  return (data ?? []).map((r: { id: string }) => r.id)
}

/** Locali su cui opera il manager; null = nessun vincolo in più (ruoli legati a un locale). */
export function localiManager(profile: { role: string; locali_visibili?: string[] | null }): string[] | null {
  return profile.role === 'manager' ? profile.locali_visibili ?? null : null
}

/**
 * Restringe ai locali visibili una query del manager (colonna
 * restaurant_id, o `id` per la tabella restaurants). Per gli altri ruoli
 * non fa nulla: il loro filtro per locale è già nelle query. Con un
 * elenco vuoto `.in(col, [])` non dà errore, solo nessuna riga.
 */
export function soloLocaliManager<T>(query: T, profile: { role: string; locali_visibili?: string[] | null }, colonna = 'restaurant_id'): T {
  const ids = localiManager(profile)
  // Senza vincolo generico: i tipi del costruttore di query di Supabase
  // sono troppo profondi (TS2589). Basta sapere che ha `.in`.
  return ids ? (query as unknown as { in(c: string, v: string[]): T }).in(colonna, ids) : query
}

export function toScopeProfile(profile: TelegramProfile): ScopeProfileTg {
  return {
    role:          profile.role,
    restaurant_id: profile.restaurant_id,
    department:    profile.department,
    is_direttore:  profile.is_direttore,
    locali_visibili: profile.locali_visibili ?? null,
  }
}

export function isManager(profile: TelegramProfile): boolean {
  return profile.role === 'manager'
}

export function isDirettore(profile: TelegramProfile): boolean {
  return profile.role === 'capo_servizio' && profile.is_direttore === true
}

export function isCapoServizio(profile: TelegramProfile): boolean {
  return profile.role === 'capo_servizio'
}

// Presenze: solo manager e direttori possono modificarle/crearle da Telegram.
export function canManagePresenze(profile: TelegramProfile): boolean {
  return isManager(profile) || isDirettore(profile)
}

// Dati finanziari (Cassa/Acquisti, Task 4 dell'assistente): stesso
// perimetro di chi ha accesso ad Analisi nell'app web — manager e
// direttore, non il cassiere (che in Acquisti/Cassa ha solo accesso in
// lettura alle proprie pagine, non ai dati aggregati di Analisi) né il
// capo_servizio non direttore.
export function canViewFinanze(profile: TelegramProfile): boolean {
  return isManager(profile) || isDirettore(profile)
}

// Turni e ODS: manager, direttori e capi servizio (nel proprio scope).
export function canManageTurni(profile: TelegramProfile): boolean {
  return isManager(profile) || isCapoServizio(profile)
}

export function canManageOds(profile: TelegramProfile): boolean {
  return isManager(profile) || isCapoServizio(profile)
}

// Stesse regole di turniScope.ts, più i locali visibili per il manager.
export function scopeTurnsQuery<T extends QueryConIn<T>>(query: T, profile: ScopeProfileTg, userId: string): T {
  return soloLocaliManager(scopeTurnsBase(query, profile, userId), profile)
}

export function scopeStaffQuery<T extends QueryConIn<T>>(query: T, profile: ScopeProfileTg): T {
  return soloLocaliManager(scopeStaffBase(query, profile), profile)
}

// Verifica che un dipendente target sia nello scope del chiamante
// (stesso ristorante, e se non direttore anche stesso reparto).
export function assigneeInScope(profile: TelegramProfile, assignee: { restaurant_id: string | null; department: string | null }): boolean {
  if (isManager(profile)) {
    // Il manager non assegna nulla a chi lavora in un locale nascosto.
    const ids = localiManager(profile)
    return !ids || (!!assignee.restaurant_id && ids.includes(assignee.restaurant_id))
  }
  if (profile.restaurant_id !== assignee.restaurant_id) return false
  if (isDirettore(profile)) return true
  return profile.department === assignee.department
}
