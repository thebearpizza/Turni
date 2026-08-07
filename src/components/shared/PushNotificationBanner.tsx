'use client'
import { BellRing, BellOff, X, Loader2 } from 'lucide-react'
import { useState } from 'react'
import type { PushPermission } from '@/hooks/usePushNotifications'

interface Props {
  permission: PushPermission
  subscribed:  boolean | null
  onSubscribe: () => Promise<void>
}

export function PushNotificationBanner({ permission, subscribed, onSubscribe }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(false)

  // Due situazioni da mostrare, non una sola:
  //  - 'default'  → non è mai stato chiesto il permesso;
  //  - 'granted' ma subscribed === false → il permesso c'è ma questo
  //    dispositivo NON è raggiungibile (endpoint ruotato, registrazione
  //    persa lato server). Prima questo caso non compariva da nessuna
  //    parte: il banner si nascondeva appena il permesso era concesso, e
  //    le notifiche restavano spente in silenzio.
  const daAttivare  = permission === 'default'
  const daRiattivare = permission === 'granted' && subscribed === false
  if ((!daAttivare && !daRiattivare) || dismissed) return null

  async function handleSubscribe() {
    setLoading(true)
    await onSubscribe()
    setLoading(false)
  }

  const Icona = daRiattivare ? BellOff : BellRing

  return (
    <div className="mx-4 mb-3 flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
      <Icona className="w-4 h-4 text-primary shrink-0" />
      <p className="flex-1 text-xs text-muted-foreground leading-snug">
        {daRiattivare
          ? 'Le notifiche non arrivano più su questo dispositivo'
          : 'Ricevi notifiche push su questo dispositivo'}
      </p>
      <button
        onClick={handleSubscribe}
        disabled={loading}
        className="shrink-0 flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
      >
        {loading && <Loader2 className="w-3 h-3 animate-spin" />}
        {loading ? 'Attivazione' : daRiattivare ? 'Riattiva' : 'Attiva'}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Chiudi"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
