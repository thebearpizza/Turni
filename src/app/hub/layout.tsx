import { PushNotificationPrompt } from '@/components/shared/PushNotificationPrompt'

// Layout minimale per /hub: nessuna sidebar. L'intestazione (logo,
// wordmark, tema, logout) la monta HubTopBar dentro hub/page.tsx — prima
// c'era anche qui un header di testo semplice ("inTurno" + tema +
// logout), che affiancato a HubTopBar produceva due intestazioni
// identiche una sopra l'altra. L'autenticazione e lo scope per ruolo
// sono verificati in hub/page.tsx.
export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="pt-3">
        <PushNotificationPrompt />
      </div>
      {children}
    </div>
  )
}
