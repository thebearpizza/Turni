import { MODIFICA_ALLOWED_FIELDS, type ModificaField } from '@/lib/cassa/modificaFields'

// Payload di una richiesta di modifica a una chiusura già inviata
// (cassa_chiusure_modifiche.payload). Oltre ai campi numerici della
// chiusura, il design manda in revisione al manager anche le spese
// (modificate, eliminate, aggiunte) e il motivo della modifica, mostrato
// tra virgolette nel dettaglio di Approvazioni. Le chiavi extra stanno
// nello stesso JSON con il prefisso "_": nessuna colonna nuova, e i
// lettori che conoscono solo i campi numerici (Home del manager) le
// ignorano. Modulo puro: lo usano sia le route sia i componenti client.

export interface SpesaNuova { nome_spesa: string; categoria_id: string | null; importo: number }
export interface ModificheSpese {
  modifica: { id: string; importo: number }[]
  elimina: string[]
  aggiungi: SpesaNuova[]
}
export interface ModificaLetta {
  campi: Partial<Record<ModificaField, number>>
  spese: ModificheSpese
  motivo: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const importoValido = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e7

/** Legge (e ripulisce) un payload: null se non è valido o non cambia nulla. */
export function leggiModifica(input: unknown): ModificaLetta | null {
  if (!input || typeof input !== 'object') return null
  const src = input as Record<string, unknown>
  const campi: Partial<Record<ModificaField, number>> = {}
  for (const k of MODIFICA_ALLOWED_FIELDS) {
    if (!(k in src)) continue
    const v = src[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
    campi[k] = v
  }

  const spese: ModificheSpese = { modifica: [], elimina: [], aggiungi: [] }
  const s = src._spese as Record<string, unknown> | undefined
  if (s && typeof s === 'object') {
    for (const x of Array.isArray(s.modifica) ? s.modifica : []) {
      const r = x as { id?: unknown; importo?: unknown }
      if (typeof r.id !== 'string' || !UUID.test(r.id) || !importoValido(r.importo)) return null
      spese.modifica.push({ id: r.id, importo: r.importo })
    }
    for (const id of Array.isArray(s.elimina) ? s.elimina : []) {
      if (typeof id !== 'string' || !UUID.test(id)) return null
      spese.elimina.push(id)
    }
    for (const x of Array.isArray(s.aggiungi) ? s.aggiungi : []) {
      const r = x as { nome_spesa?: unknown; categoria_id?: unknown; importo?: unknown }
      const nome = typeof r.nome_spesa === 'string' ? r.nome_spesa.trim().slice(0, 120) : ''
      const cat = r.categoria_id == null || r.categoria_id === '' ? null : r.categoria_id
      if (!nome || !importoValido(r.importo) || (cat !== null && (typeof cat !== 'string' || !UUID.test(cat)))) return null
      spese.aggiungi.push({ nome_spesa: nome, categoria_id: cat as string | null, importo: r.importo })
    }
    // Una spesa eliminata non può anche essere modificata.
    spese.modifica = spese.modifica.filter(m => !spese.elimina.includes(m.id))
  }

  const motivo = typeof src._motivo === 'string' && src._motivo.trim() ? src._motivo.trim().slice(0, 500) : null
  const vuota = Object.keys(campi).length === 0 && !spese.modifica.length && !spese.elimina.length && !spese.aggiungi.length
  return vuota ? null : { campi, spese, motivo }
}

/** Payload da salvare, nella stessa forma letta da leggiModifica. */
export function scriviModifica(m: ModificaLetta): Record<string, unknown> {
  const ha = m.spese.modifica.length || m.spese.elimina.length || m.spese.aggiungi.length
  return { ...m.campi, ...(ha ? { _spese: m.spese } : {}), ...(m.motivo ? { _motivo: m.motivo } : {}) }
}

/** Numero di voci cambiate (per "Invia 3 modifiche al manager"). */
export const contaModifiche = (m: ModificaLetta) =>
  Object.keys(m.campi).length + m.spese.modifica.length + m.spese.elimina.length + m.spese.aggiungi.length
