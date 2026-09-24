'use client'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { LogoAnimato } from '@/components/shared/LogoAnimato'
import { LogOut } from 'lucide-react'

// Barra in cima alla Home Manager (Task 3): logo con gli anelli che
// girano, wordmark, toggle tema, logout.
export function HubTopBar() {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-6 py-3 backdrop-blur lg:px-10">
      <LogoAnimato size={36} className="rounded-[6px] shadow-sm" />
      <span className="flex-1 text-base font-extrabold tracking-tight">inTurno</span>
      <ThemeToggle />
      <button
        type="button"
        onClick={handleLogout}
        aria-label="Esci"
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  )
}
