'use client'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LogOut } from 'lucide-react'
import { ThemeToggle } from '@/components/shared/ThemeToggle'

// Layout minimale per /hub: nessuna sidebar, solo un header leggero.
// L'autenticazione e lo scope per ruolo sono verificati in hub/page.tsx.
export default function HubLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between h-14 px-4 sm:px-6 border-b border-border">
        <span className="text-lg font-bold">inTurno</span>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            onClick={handleLogout}
            className="w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Esci"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>
      {children}
    </div>
  )
}
