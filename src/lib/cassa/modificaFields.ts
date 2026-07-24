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

export function sanitizeModificaPayload(input: unknown): Record<ModificaField, number> | null {
  if (!input || typeof input !== 'object') return null
  const source = input as Record<string, unknown>
  const result = {} as Record<ModificaField, number>

  for (const key of MODIFICA_ALLOWED_FIELDS) {
    const value = source[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    result[key] = value
  }

  return result
}
