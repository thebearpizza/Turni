'use client'
import { useSyncExternalStore } from 'react'

// Una pagina può sostituire il sottotitolo dell'intestazione del guscio e
// l'azione della scintilla dell'assistente (Analisi: il periodo filtrato e
// l'assistente sui dati filtrati, come nel design). Valori a livello di
// modulo: una sola pagina alla volta è montata nel guscio.

interface Stato { sottotitolo: string | null; assistente: (() => void) | null }
let stato: Stato = { sottotitolo: null, assistente: null }
const ascoltatori = new Set<() => void>()
const SERVER: Stato = { sottotitolo: null, assistente: null }

function imposta(p: Partial<Stato>) {
  stato = { ...stato, ...p }
  ascoltatori.forEach(l => l())
}

export const impostaSottotitolo = (s: string | null) => { if (stato.sottotitolo !== s) imposta({ sottotitolo: s }) }
export const impostaAssistente = (f: (() => void) | null) => imposta({ assistente: f })

export function useIntestazioneDinamica(): Stato {
  return useSyncExternalStore(
    l => { ascoltatori.add(l); return () => { ascoltatori.delete(l) } },
    () => stato,
    () => SERVER
  )
}
