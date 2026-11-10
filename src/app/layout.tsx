import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ThemeProvider } from '@/components/shared/ThemeProvider'
import { OfflineSyncProvider } from '@/components/shared/OfflineSyncProvider'
import { SessionGuardian } from '@/components/shared/SessionGuardian'
import { Toaster } from '@/components/shared/Toaster'
import { ConfermaHost } from '@/components/shared/Conferma'
import { SplashApertura } from '@/components/shared/SplashApertura'
import './globals.css'

const geist = Geist({ subsets: ['latin'] })

// Geist Mono per importi, totali e intestazioni di colonna (design
// Acciaio): esposto come variabile e usato da font-mono / .cassa-numeric.
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: 'inTurno – Gestione Turni, Presenze e ODS',
  description: 'Piattaforma aziendale per la gestione ottimizzata di turni, presenze e ordini di servizio',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'inTurno',
    startupImage: '/icon-512.png',
  },
  icons: {
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0f1011',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body className={`${geist.className} ${geistMono.variable} antialiased overflow-x-hidden w-full max-w-full`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <SplashApertura />
          <SessionGuardian />
          <OfflineSyncProvider>
            {children}
          </OfflineSyncProvider>
          <Toaster />
          <ConfermaHost />
          {/* Telefono in orizzontale (Safari ignora l'orientamento del
              manifest): l'app è pensata solo in verticale. */}
          <div className="avviso-orientamento" role="alert">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>
            <span className="text-[17px] font-semibold">Ruota il telefono</span>
            <span className="text-sm text-muted-foreground">inTurno si usa in verticale.</span>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
