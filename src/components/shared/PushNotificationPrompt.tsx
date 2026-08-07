'use client'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { PushNotificationBanner } from '@/components/shared/PushNotificationBanner'

// Wrapper client per usare il banner di attivazione push da pagine server
// component (es. la dashboard manager) senza dover spostare l'intera pagina
// lato client solo per questo.
//
// Montarlo NON serve solo a mostrare il banner: il hook riallinea a ogni
// apertura la subscription col server, quindi va montato su tutte le aree in
// cui si lavora davvero. Finché stava solo sulla dashboard, chi passava le
// giornate in Cassa non rinnovava mai la registrazione e smetteva di
// ricevere notifiche senza accorgersene.
export function PushNotificationPrompt() {
  const { permission, subscribed, subscribe } = usePushNotifications()
  return <PushNotificationBanner permission={permission} subscribed={subscribed} onSubscribe={subscribe} />
}
