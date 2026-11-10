'use client'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { PushNotificationBanner } from '@/components/shared/PushNotificationBanner'

// Wrapper client per montare il banner di attivazione push dal guscio o da
// pagine server component.
//
// Montarlo NON serve solo a mostrare il banner: il hook riallinea a ogni
// apertura la subscription col server, quindi va montato su tutte le aree in
// cui si lavora davvero (chi passava le giornate in Cassa senza montarlo non
// rinnovava mai la registrazione e smetteva di ricevere notifiche). Con
// `mostra={false}` riallinea senza disegnare nulla: nel design il banner
// compare solo nella Home di manager e direttore.
export function PushNotificationPrompt({ mostra = true, testo, chiave }: { mostra?: boolean; testo?: string; chiave?: string }) {
  const { permission, subscribed, subscribe } = usePushNotifications()
  if (!mostra) return null
  return <PushNotificationBanner permission={permission} subscribed={subscribed} onSubscribe={subscribe} testo={testo} chiave={chiave} />
}
