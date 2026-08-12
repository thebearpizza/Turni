// Colonne di cassa_chiusure che possono essere proposte tramite una
// richiesta di modifica (cassa_chiusure_modifiche.payload). Qualsiasi altra
// chiave viene scartata sia in ingresso (richiesta) sia in applicazione
// (approvazione) — il payload arriva dal client e non va mai fidato
// direttamente per un UPDATE (es. non deve poter toccare stato, id,
// restaurant_id, created_by o i campi calcolati dal trigger).
export const MODIFICA_ALLOWED_FIELDS = [
  'fondo_cassa_iniziale',
  'entrate_contanti',
  'entrate_pos',
  'entrate_bonifico',
  'coperti',
  'incasso_asporto',
  'fondo_cassa_finale',
  'contanti_per_banca',
] as const

export type ModificaField = typeof MODIFICA_ALLOWED_FIELDS[number]

// Solo i campi che il cassiere ha davvero cambiato, non "l'intero form come
// lo vedeva": una richiesta di modifica propone SOLO le chiavi presenti nel
// payload, non deve più contenerle tutte e 8. Applicare in approvazione solo
// i campi presenti evita di sovrascrivere correzioni fatte nel frattempo dal
// manager su campi che il cassiere non intendeva toccare.
export function sanitizeModificaPayload(input: unknown): Partial<Record<ModificaField, number>> | null {
  if (!input || typeof input !== 'object') return null
  const source = input as Record<string, unknown>
  const result: Partial<Record<ModificaField, number>> = {}

  for (const key of MODIFICA_ALLOWED_FIELDS) {
    if (!(key in source)) continue
    const value = source[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    result[key] = value
  }

  if (Object.keys(result).length === 0) return null
  return result
}
