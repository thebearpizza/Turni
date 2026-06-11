import { scopeStaffQuery, scopeTurnsQuery, type ScopeProfile } from '@/lib/turniScope'
import type { TelegramProfile } from './auth'

// ── RBAC helpers per i comandi Telegram ──────────────────────────────
// Stessa gerarchia dell'app web (turniScope.ts), riapplicata qui perché
// il bot opera con il client admin (service role) e bypassa la RLS:
// tutta l'autorizzazione deve essere fatta in questo livello applicativo.
//
//  - manager                       → GLOBALE (tutti i ristoranti/reparti)
//  - capo_servizio + is_direttore  → tutti i reparti del proprio ristorante
//  - capo_servizio (non direttore) → solo proprio ristorante + reparto

export function toScopeProfile(profile: TelegramProfile): ScopeProfile {
  return {
    role:          profile.role,
    restaurant_id: profile.restaurant_id,
    department:    profile.department,
    is_direttore:  profile.is_direttore,
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

// Turni e ODS: manager, direttori e capi servizio (nel proprio scope).
export function canManageTurni(profile: TelegramProfile): boolean {
  return isManager(profile) || isCapoServizio(profile)
}

export function canManageOds(profile: TelegramProfile): boolean {
  return isManager(profile) || isCapoServizio(profile)
}

export { scopeStaffQuery, scopeTurnsQuery }

// Verifica che un dipendente target sia nello scope del chiamante
// (stesso ristorante, e se non direttore anche stesso reparto).
export function assigneeInScope(profile: TelegramProfile, assignee: { restaurant_id: string | null; department: string | null }): boolean {
  if (isManager(profile)) return true
  if (profile.restaurant_id !== assignee.restaurant_id) return false
  if (isDirettore(profile)) return true
  return profile.department === assignee.department
}
