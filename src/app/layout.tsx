import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'inTurno',
  description: 'Applicazione aziendale per la gestione di turni, presenze e ordini di servizio',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'inTurno',
    startupImage: '/icon-512.png',
  },
  icons: {
    apple: [{ url: '/icon-192.png', sizes: '192x192' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f172a',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body className={`${geist.className} antialiased`}>
        {children}
      </body>
    </html>
  )
}
