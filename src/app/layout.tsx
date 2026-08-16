import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Fraunces } from 'next/font/google'
import { ThemeProvider } from '@/components/shared/ThemeProvider'
import { OfflineSyncProvider } from '@/components/shared/OfflineSyncProvider'
import { SessionGuardian } from '@/components/shared/SessionGuardian'
import { Toaster } from '@/components/shared/Toaster'
import './globals.css'

const geist = Geist({ subsets: ['latin'] })

// Cassa-only typographic voice ("Ledger" design system, see globals.css
// .cassa-display / .cassa-numeric) — loaded once here as CSS variables so
// the fonts are only ever *applied* inside the .cassa-scoped subtree, never
// changing Turni's default sans rendering elsewhere.
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
const fraunces = Fraunces({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-fraunces' })

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
      { url: '/logo-branding.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#18181b',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body className={`${geist.className} ${geistMono.variable} ${fraunces.variable} antialiased overflow-x-hidden w-full max-w-full`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <SessionGuardian />
          <OfflineSyncProvider>
            {children}
          </OfflineSyncProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
