'use client'
import { useState, useSyncExternalStore } from 'react'
import type { PushPermission } from '@/hooks/usePushNotifications'
import { cn } from '@/lib/utils'

interface Props {
  permission: PushPermission
  subscribed: boolean | null
  onSubscribe: () => Promise<void>
  /** Riga sotto "Attiva le notifiche" (cosa arriva ad app chiusa). */
  testo?: string
  /** Chiave di "Dopo" in localStorage (prototipi: mgrPush, dirPush). */
  chiave?: string
  className?: string
}

// Banner "Attiva le notifiche" del design (Manager/Direttore Smartphone e
// Tablet): icona teal, titolo e riga, "Dopo" e "Attiva". "Dopo" lo
// nasconde per sempre su questo dispositivo, con l'uscita swapout.
// Due situazioni da mostrare, non una sola:
//  - 'default'  → non è mai stato chiesto il permesso;
//  - 'granted' ma subscribed === false → il permesso c'è ma questo
//    dispositivo NON è raggiungibile (endpoint ruotato, registrazione
//    persa lato server): senza il banner le notifiche resterebbero spente
//    in silenzio.

const ascoltatori = new Set<() => void>()
function rimandato(chiave: string): boolean {
  try { return localStorage.getItem(chiave) === '1' } catch { return false }
}

export function PushNotificationBanner({
  permission, subscribed, onSubscribe, chiave = 'inturno-push-dopo', className,
  testo = 'Richieste, timbrature con foto e chiusure mancanti anche ad app chiusa.',
}: Props) {
  const dopo = useSyncExternalStore(
    l => { ascoltatori.add(l); return () => { ascoltatori.delete(l) } },
    () => rimandato(chiave),
    () => true
  )
  const [uscita, setUscita] = useState(false)
  const [nascosto, setNascosto] = useState(false)
  const [attesa, setAttesa] = useState(false)

  const daAttivare = permission === 'default' && !dopo
  const daRiattivare = permission === 'granted' && subscribed === false
  if ((!daAttivare && !daRiattivare) || nascosto) return null

  function chiudi(persisti: boolean) {
    setUscita(true)
    if (persisti) { try { localStorage.setItem(chiave, '1') } catch {} }
    setTimeout(() => { setNascosto(true); ascoltatori.forEach(l => l()) }, 320)
  }

  async function attiva() {
    setAttesa(true)
    await onSubscribe()
    setAttesa(false)
    chiudi(true)
  }

  return (
    <div className={cn(
      'relative z-[2] mx-4 mb-2.5 flex flex-none items-center gap-3 rounded-[12px] border border-border bg-card py-2.5 pl-3.5 pr-2.5 shadow-[0_4px_20px_rgba(20,30,50,.06)] sm:mx-8',
      uscita ? 'anim-swapout' : 'anim-swapin',
      className
    )}>
      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[oklch(0.94_0.04_180)] text-[oklch(0.4_0.08_180)] dark:bg-[oklch(0.28_0.04_180)] dark:text-[oklch(0.78_0.08_180)]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" />
        </svg>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-sm font-semibold">{daRiattivare ? 'Le notifiche non arrivano più' : 'Attiva le notifiche'}</span>
        <span className="text-[12.5px] text-muted-foreground text-pretty">
          {daRiattivare ? 'Questo dispositivo non le riceve: riattivale per non perdere gli avvisi.' : testo}
        </span>
      </div>
      <button type="button" onClick={() => chiudi(!daRiattivare)} className="flex h-10 flex-none items-center rounded-[8px] px-2.5 text-[13px] font-medium text-muted-foreground active:scale-[0.97]">
        Dopo
      </button>
      <button type="button" onClick={attiva} disabled={attesa} className="flex h-10 flex-none items-center rounded-[8px] bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground active:scale-[0.97] disabled:opacity-85">
        {daRiattivare ? 'Riattiva' : 'Attiva'}
      </button>
    </div>
  )
}
