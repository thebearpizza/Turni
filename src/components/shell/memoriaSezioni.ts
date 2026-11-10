'use client'
import { useSyncExternalStore } from 'react'

// Ultima sezione aperta di ogni area (prototipi: state.secs). Toccando
// "Turni" nel dock si torna a Presenze se era lì che si stava lavorando.
// In sessionStorage: sopravvive a un ricaricamento ma non a una nuova
// apertura dell'app.

const CHIAVE = 'inturno-sezioni'
type Memoria = Record<string, string>
let memoria: Memoria | null = null
const ascoltatori = new Set<() => void>()
const VUOTA: Memoria = {}

function leggi(): Memoria {
  if (memoria) return memoria
  try { memoria = JSON.parse(sessionStorage.getItem(CHIAVE) ?? '{}') as Memoria } catch { memoria = {} }
  return memoria
}

export function ricordaSezione(area: string, href: string) {
  const m = leggi()
  if (m[area] === href) return
  memoria = { ...m, [area]: href }
  try { sessionStorage.setItem(CHIAVE, JSON.stringify(memoria)) } catch {}
  ascoltatori.forEach(l => l())
}

export function useMemoriaSezioni(): Memoria {
  return useSyncExternalStore(
    l => { ascoltatori.add(l); return () => { ascoltatori.delete(l) } },
    leggi,
    () => VUOTA
  )
}
