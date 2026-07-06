import { fromZonedTime } from 'date-fns-tz'
import { addDays, format, parseISO } from 'date-fns'

// Calcola i timestamp ISO di ingresso/uscita di una presenza. Se l'uscita è
// numericamente "prima" dell'ingresso (es. 15:00 → 01:00) si tratta di un
// turno notturno che scavalca la mezzanotte, non di un errore di battitura:
// l'uscita viene automaticamente spostata al giorno successivo.
export function computeAttendanceIso(
  tz: string,
  date: string,
  checkIn: string,
  checkOut?: string | null,
): { checkInIso: string; checkOutIso: string | null } {
  const checkInIso = fromZonedTime(`${date}T${checkIn}:00`, tz).toISOString()
  if (!checkOut) return { checkInIso, checkOutIso: null }

  let checkOutIso = fromZonedTime(`${date}T${checkOut}:00`, tz).toISOString()
  if (checkOutIso <= checkInIso) {
    const nextDay = format(addDays(parseISO(`${date}T00:00:00`), 1), 'yyyy-MM-dd')
    checkOutIso = fromZonedTime(`${nextDay}T${checkOut}:00`, tz).toISOString()
  }
  return { checkInIso, checkOutIso }
}
