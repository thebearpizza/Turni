'use client'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { LogOut } from 'lucide-react'

// Barra in cima alla Home Manager (Task 3): logo reale (file statico in
// public/, non base64), wordmark, toggle tema, logout. Il logo ha uno
// sfondo scuro proprio (texture carbonio incisa nel file) — il bordo
// chiaro qui è quello che lo stacca dalla barra, qualunque sia il tema
// attivo attorno, non un dettaglio da adattare al tema.
export function HubTopBar() {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-6 py-3 backdrop-blur lg:px-10">
      <Image
        src="/logo-branding.png"
        alt="inTurno"
        width={36}
        height={36}
        className="shrink-0 rounded-[9px] border border-white/20 shadow-sm"
        priority
      />
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
