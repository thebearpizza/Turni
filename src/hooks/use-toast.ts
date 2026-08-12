"use client"
import { useSyncExternalStore } from "react"

// Canale di notifica non bloccante condiviso da tutta l'app — sostituisce i
// vari alert() nativi e gli errori silenziosi sparsi nei singoli componenti.
// Stato a modulo (non un context): toast() è chiamabile anche fuori da un
// componente React (es. da un handler async) senza dover passare un
// dispatcher in giro.

export interface ToastItem {
  id: string
  title: string
  description?: string
  variant?: "default" | "destructive"
}

const DURATION_MS = 5000

let toasts: ToastItem[] = []
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(l => l())
}

function dismiss(id: string) {
  toasts = toasts.filter(t => t.id !== id)
  emit()
}

export function toast(item: Omit<ToastItem, "id">) {
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
