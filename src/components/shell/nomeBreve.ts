// In un file a sé: lo usa anche il guscio lato client, che non può importare
// datiShell (legge i cookie lato server).

/** "Laura Bianchi" → "Laura B." (pulsante "Esci · Laura B." del cassiere su tablet). */
export function nomeBreve(nome: string): string {
  const parti = nome.trim().split(/\s+/)
  if (parti.length < 2) return parti[0] ?? ''
  return `${parti[0]} ${parti[parti.length - 1].charAt(0).toUpperCase()}.`
}
