// ── Gestione Turni: Query Scoping (RBAC) ────────────────────────────
// Regole ferree, applicate sia in lettura che in scrittura:
//  - manager                         → GLOBALE   (nessun vincolo)
//  - capo_servizio + is_direttore    → LOCALE    (solo restaurant_id proprio)
//  - capo_servizio (non direttore)   → DIPARTIM. (restaurant_id + department propri)
//  - dipendente                      → PERSONALE (solo user_id proprio, sola lettura)

export interface ScopeProfile {
  role:          string
  restaurant_id: string | null
  department:    string | null
  is_direttore:  boolean
}

type ScopableQuery<T> = {
  eq: (column: string, value: unknown) => T
}

export function scopeTurnsQuery<T extends ScopableQuery<T>>(
  query: T,
  profile: ScopeProfile,
  userId: string,
): T {
  if (profile.role === 'manager') {
    // Manager: visibilità e modifica GLOBALE su tutti i ristoranti/reparti
    return query
  } else if (profile.role === 'capo_servizio' && profile.is_direttore) {
    // Direttore: visibilità e modifica LOCALE — tutti i reparti del proprio ristorante
    return query.eq('restaurant_id', profile.restaurant_id)
  } else if (profile.role === 'capo_servizio') {
    // Capo Servizio: visibilità e modifica DIPARTIMENTALE — solo proprio ristorante + reparto
    return query.eq('restaurant_id', profile.restaurant_id).eq('department', profile.department)
  } else {
    // Dipendente: visibilità PERSONALE, sola lettura — solo i propri turni
    return query.eq('user_id', userId)
  }
}

export function scopeStaffQuery<T extends ScopableQuery<T>>(
  query: T,
  profile: ScopeProfile,
): T {
  if (profile.role === 'manager') {
    return query
  } else if (profile.role === 'capo_servizio' && profile.is_direttore) {
    return query.eq('restaurant_id', profile.restaurant_id)
  } else if (profile.role === 'capo_servizio') {
    return query.eq('restaurant_id', profile.restaurant_id).eq('department', profile.department)
  }
  return query
}
