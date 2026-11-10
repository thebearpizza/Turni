'use client'
import { createElement, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Una pagina può sostituire il sottotitolo dell'intestazione del guscio e
// l'azione della scintilla dell'assistente (Analisi: il periodo filtrato e
// l'assistente sui dati filtrati, come nel design), e mettere qualcosa al
// centro dell'intestazione (Chiusura Tablet v2: le fasi a pillole fra il
// titolo e "Esci · Nome"). Valori a livello di modulo: una sola pagina
// alla volta è montata nel guscio.

interface Stato { sottotitolo: string | null; assistente: (() => void) | null; centro: HTMLElement | null }
let stato: Stato = { sottotitolo: null, assistente: null, centro: null }
const ascoltatori = new Set<() => void>()
const SERVER: Stato = { sottotitolo: null, assistente: null, centro: null }

function imposta(p: Partial<Stato>) {
  stato = { ...stato, ...p }
  ascoltatori.forEach(l => l())
}

const iscrivi = (l: () => void) => { ascoltatori.add(l); return () => { ascoltatori.delete(l) } }

export const impostaSottotitolo = (s: string | null) => { if (stato.sottotitolo !== s) imposta({ sottotitolo: s }) }
export const impostaAssistente = (f: (() => void) | null) => imposta({ assistente: f })
/** Usato solo dal guscio: registra il contenitore al centro dell'intestazione. */
export const registraCentroIntestazione = (el: HTMLElement | null) => { if (stato.centro !== el) imposta({ centro: el }) }

export function useIntestazioneDinamica(): Stato {
  return useSyncExternalStore(iscrivi, () => stato, () => SERVER)
}

/**
 * Mostra i figli al centro dell'intestazione del guscio (solo da tablet in
 * su: sul telefono il centro non c'è e i figli non vengono disegnati, la
 * pagina li mette nel proprio contenuto).
 */
export function IntestazioneCentro({ children }: { children: ReactNode }) {
  const { centro } = useIntestazioneDinamica()
  if (!centro) return null
  return createPortal(createElement('div', { className: 'contents' }, children), centro)
}
