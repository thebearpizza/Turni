import { formatInTimeZone } from 'date-fns-tz'
import type { VerificaSospetta } from '@/types'

const TZ = 'Europe/Rome'

// Soglie regolabili (Task 2) — cambiarle qui aggiorna sia l'evidenziazione
// nella revisione (Task 1/FatturaCapture) sia il salvataggio (Task 3).
export const SOGLIA_GIORNI_PASSATO = 60
export const TOLLERANZA_QUADRATURA = 0.02
export const SOGLIA_SCOSTAMENTO_PREZZO = 0.20

// Data fuori da un intervallo plausibile: futura, o troppo nel passato.
export function verificaData(data: string, sogliaGiorniPassato = SOGLIA_GIORNI_PASSATO): VerificaSospetta | null {
  const oggi = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  if (data > oggi) {
    return { campo: 'data', messaggio: 'La data è nel futuro.' }
  }
  const limiteInf = formatInTimeZone(new Date(Date.now() - sogliaGiorniPassato * 86_400_000), TZ, 'yyyy-MM-dd')
  if (data < limiteInf) {
    return { campo: 'data', messaggio: `La data è più di ${sogliaGiorniPassato} giorni nel passato.` }
  }
  return null
}

// Netto + IVA deve tornare al lordo, oltre una tolleranza di arrotondamento.
export function verificaQuadratura(netto: number, iva: number, lordo: number, tolleranza = TOLLERANZA_QUADRATURA): VerificaSospetta | null {
  const scarto = Math.abs(netto + iva - lordo)
  if (scarto > tolleranza) {
    return { campo: 'totale_lordo', messaggio: `Netto + IVA (€ ${(netto + iva).toFixed(2)}) non torna con il lordo (€ ${lordo.toFixed(2)}).` }
  }
  return null
}

// Riepilogo IVA non estratto nonostante la fattura abbia articoli veri:
// Netto/IVA/Lordo (tutti derivati da iva_dettaglio, mai dagli articoli)
// restano silenziosamente a zero. verificaQuadratura non lo cattura,
// perché netto=iva=lordo=0 "torna" per definizione (0+0=0) — serve un
// controllo dedicato per non lasciare un totale a zero senza spiegazione.
export function verificaIvaMancante(numRigheIva: number, haArticoli: boolean, numArticoli: number): VerificaSospetta | null {
  if (haArticoli && numArticoli > 0 && numRigheIva === 0) {
    return {
      campo: 'totale_lordo',
      messaggio: 'Riepilogo IVA non trovato in fattura: Netto/IVA/Lordo sono a zero, vanno corretti a mano prima di salvare.',
    }
  }
  return null
}

// Prezzo unitario di un articolo che si scosta oltre una soglia
// dall'ultimo prezzo noto per lo stesso articolo+fornitore.
export function verificaPrezzoArticolo(
  testoEstratto: string,
  prezzoUnitarioNuovo: number,
  prezzoUnitarioUltimoNoto: number | null,
  sogliaPercentuale = SOGLIA_SCOSTAMENTO_PREZZO
): VerificaSospetta | null {
  if (prezzoUnitarioUltimoNoto == null || prezzoUnitarioUltimoNoto === 0) return null
  const scostamento = (prezzoUnitarioNuovo - prezzoUnitarioUltimoNoto) / prezzoUnitarioUltimoNoto
  if (Math.abs(scostamento) > sogliaPercentuale) {
    const segno = scostamento > 0 ? '+' : ''
    return {
      campo: `articolo:${testoEstratto}`,
      messaggio: `Prezzo unitario € ${prezzoUnitarioNuovo.toFixed(2)} (${segno}${(scostamento * 100).toFixed(0)}% rispetto a € ${prezzoUnitarioUltimoNoto.toFixed(2)} dell'ultimo acquisto).`,
    }
  }
  return null
}
