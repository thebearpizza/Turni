'use client'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { PushNotificationBanner } from '@/components/shared/PushNotificationBanner'

// Wrapper client per usare il banner di attivazione push da pagine server
// component (es. la dashboard manager) senza dover spostare l'intera pagina
// lato client solo per questo.
export function PushNotificationPrompt() {
  const { permission, subscribe } = usePushNotifications()
  return <PushNotificationBanner permission={permission} onSubscribe={subscribe} />
}
