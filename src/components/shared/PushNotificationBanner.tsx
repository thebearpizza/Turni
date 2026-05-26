'use client'
import { BellRing, X } from 'lucide-react'
import { useState } from 'react'
import type { PushPermission } from '@/hooks/usePushNotifications'

interface Props {
  permission: PushPermission
  onSubscribe: () => Promise<void>
}

export function PushNotificationBanner({ permission, onSubscribe }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(false)

  if (permission !== 'default' || dismissed) return null

  async function handleSubscribe() {
    setLoading(true)
    await onSubscribe()
    setLoading(false)
  }

  return (
    <div className="mx-4 mb-3 flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
      <BellRing className="w-4 h-4 text-primary shrink-0" />
      <p className="flex-1 text-xs text-muted-foreground leading-snug">
        Ricevi notifiche sui comunicati in bacheca
      </p>
      <button
        onClick={handleSubscribe}
        disabled={loading}
        className="shrink-0 text-xs font-semibold text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
      >
        {loading ? '...' : 'Attiva'}
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
