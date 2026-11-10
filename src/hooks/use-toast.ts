"use client"
import { useSyncExternalStore } from "react"

// Toast unico del design (Errori.dc.html): nero, in basso, 4 secondi,
// pallino verde per le conferme e rosso con ✕ per gli errori, con
// un'azione facoltativa (es. "Riprova", "Annulla"). Stato a modulo (non
// un context): toast() è chiamabile anche fuori da un componente React
// (es. da un handler async) senza dover passare un dispatcher in giro.

export interface ToastItem {
  id: string
  title: string
  description?: string
  variant?: "default" | "destructive"
  /** Pulsante a destra del messaggio: "Riprova" dopo un errore, "Annulla". */
  action?: { label: string; onClick: () => void }
  /** In uscita (swapout di 320 ms prima di sparire). */
  uscita?: boolean
}

const DURATION_MS = 4000
const USCITA_MS = 320

let toasts: ToastItem[] = []
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(l => l())
}

function dismiss(id: string) {
  if (!toasts.some(t => t.id === id && !t.uscita)) return
  toasts = toasts.map(t => (t.id === id ? { ...t, uscita: true } : t))
  emit()
  setTimeout(() => { toasts = toasts.filter(t => t.id !== id); emit() }, USCITA_MS)
}

export function toast(item: Omit<ToastItem, "id" | "uscita">) {
  const id = crypto.randomUUID()
  toasts = [...toasts, { ...item, id }]
  emit()
  setTimeout(() => dismiss(id), DURATION_MS)
  return id
}

export function useToast() {
  const snapshot = useSyncExternalStore(
    onChange => { listeners.add(onChange); return () => listeners.delete(onChange) },
    () => toasts,
    () => toasts
  )
  return { toasts: snapshot, toast, dismiss }
}
