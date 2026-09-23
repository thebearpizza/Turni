import { google } from '@ai-sdk/google'
import { mistral } from '@ai-sdk/mistral'

// Modelli usati per la LETTURA di documenti (fatture, report di chiusura)
// e per l'abbinamento articoli che ne segue. Variabili dedicate, separate
// dalle GEMINI_* usate altrove (prenotazioni, Telegram, Analisi), perché
// possono puntare anche a un fornitore diverso da Google — quelle altre
// funzioni parlano solo con Gemini e si romperebbero.
//
// Formato: "fornitore:modello", es. "mistral:mistral-medium-latest" o
// "google:gemini-3.7-flash". Senza prefisso si intende Google. Se non
// impostate, valgono le GEMINI_* di sempre: comportamento invariato.
export const MODELLO_LETTURA = process.env.AI_MODELLO_LETTURA || process.env.GEMINI_MODEL_ESTRAZIONE || 'gemini-3.7-flash'
export const MODELLO_LETTURA_RISERVA = process.env.AI_MODELLO_LETTURA_RISERVA || process.env.GEMINI_FALLBACK_MODEL_ESTRAZIONE || 'gemini-3.5-flash-lite'
export const MODELLO_ABBINAMENTO = process.env.AI_MODELLO_LETTURA || process.env.GEMINI_MODEL || 'gemini-3.7-flash'
export const MODELLO_ABBINAMENTO_RISERVA = process.env.AI_MODELLO_LETTURA_RISERVA || process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite'

export function risolviModello(id: string) {
  const separatore = id.indexOf(':')
  if (separatore > 0) {
    const fornitore = id.slice(0, separatore)
    const nome = id.slice(separatore + 1)
    if (fornitore === 'mistral') return mistral(nome)
    if (fornitore === 'google') return google(nome)
  }
  return google(id)
}
