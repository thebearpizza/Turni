// Native IndexedDB offline queue — no external dependencies.
// All functions are safe to call from client components only.

const DB_NAME = 'inturno-offline'
const STORE   = 'queue'
const VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no-idb')); return }
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = e => resolve((e.target as IDBOpenDBRequest).result)
    req.onerror  = e => reject((e.target as IDBOpenDBRequest).error)
  })
}

export type OfflineQueueType = 'clock-in' | 'ods-toggle'

export interface ClockInPayload {
  qr_secret: string
  type:      'in' | 'out'
  latitude:  number | null
  longitude: number | null
  accuracy:  number | null
  frozenAt:  string  // ISO — timestamp at the moment the button was pressed
}

export interface OdsTogglePayload {
  task_id:  string
  user_id:  string
  action:   'complete' | 'uncomplete'
  frozenAt: string
}

export interface OfflineQueueItem {
  id:        string
  type:      OfflineQueueType
  payload:   ClockInPayload | OdsTogglePayload
  createdAt: string
}

export async function saveToOfflineQueue(
  type:    OfflineQueueType,
  payload: ClockInPayload | OdsTogglePayload,
): Promise<void> {
  const db   = await openDB()
  const item: OfflineQueueItem = {
    id:        `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    payload,
    createdAt: new Date().toISOString(),
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).add(item)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

export async function getOfflineQueue(): Promise<OfflineQueueItem[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result ?? [])
    req.onerror   = () => reject(req.error)
  })
}

export async function clearOfflineItem(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}
