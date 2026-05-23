'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  LayoutDashboard, Store, Users, Clock, CalendarX,
  CheckSquare, MessageSquare, FileSpreadsheet, LogOut,
  Menu, X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Profile } from '@/types'
import { ROLE_LABELS } from '@/types'

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['manager', 'capo_servizio'] },
  { href: '/ristoranti', icon: Store, label: 'Ristoranti', roles: ['manager'] },
  { href: '/dipendenti', icon: Users, label: 'Dipendenti', roles: ['manager', 'capo_servizio'] },
  { href: '/presenze', icon: Clock, label: 'Presenze', roles: ['manager', 'capo_servizio'] },
  { href: '/assenze', icon: CalendarX, label: 'Assenze', roles: ['manager', 'capo_servizio'] },
  { href: '/approvazioni', icon: CheckSquare, label: 'Approvazioni', roles: ['manager', 'capo_servizio'] },
  { href: '/bacheca', icon: MessageSquare, label: 'Bacheca', roles: ['manager', 'capo_servizio'] },
  { href: '/report', icon: FileSpreadsheet, label: 'Report', roles: ['manager', 'capo_servizio'] },
]

interface Props {
  profile: Profile & { restaurant?: { id: string; name: string } | null }
}

export function ManagerSidebar({ profile }: Props) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  const visibleItems = navItems.filter(item => item.roles.includes(profile.role))

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-border">
        <h1 className="text-xl font-bold">Turni</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Gestione Presenze</p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {visibleItems.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              pathname === href || pathname.startsWith(href + '/')
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
            {profile.full_name[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{profile.full_name}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[profile.role]}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <LogOut className="w-4 h-4" />
          Esci
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-border bg-card shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile header + drawer */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center h-14 px-4 border-b border-border bg-background">
        <button
          onClick={() => setOpen(true)}
          className="p-2 rounded-md hover:bg-accent"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="ml-3 font-semibold">Turni</span>
      </div>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="relative w-72 bg-card border-r border-border flex flex-col">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 p-1 rounded hover:bg-accent"
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Spacer per il fixed header mobile */}
      <div className="lg:hidden h-14 shrink-0" />
    </>
  )
}
