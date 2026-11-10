'use client'
import { useSyncExternalStore } from 'react'

// Telefono = viewport sotto i 640px (breakpoint `sm` di Tailwind), come
// nei prototipi: 390×844 per lo smartphone, 1366×1024 per il tablet.
// useSyncExternalStore e non useState+useEffect: niente setState
// sincrono in un effect e nessun doppio render al montaggio. Sul server
// (e al primo render dell'idratazione) vale "tablet": le parti che
// cambiano davvero struttura fra i due usano comunque le classi `sm:`.
const QUERY = '(max-width: 639.98px)'

function iscrivi(cb: () => void) {
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

export function useTelefono(): boolean {
  return useSyncExternalStore(iscrivi, () => window.matchMedia(QUERY).matches, () => false)
}
