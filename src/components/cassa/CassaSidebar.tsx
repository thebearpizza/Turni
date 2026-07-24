'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Home, Wallet, FileText, ShieldCheck, LogOut, Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Sidebar minimale sul modello di ManagerSidebar — solo navigazione,
// nessuna logica di business (niente badge, niente realtime).
const navItems = [
  { href: '/hub',              icon: Home,        label: 'Home',         roles: ['manager', 'cassiere'] },
  { href: '/cassa/chiusura',   icon: Wallet,       label: 'Chiusura Cassa', roles: ['manager', 'cassiere'] },
  { href: '/cassa/prima-nota', icon: FileText,     label: 'Prima Nota',   roles: ['manager', 'cassiere'] },
  { href: '/cassa/approvazioni', icon: ShieldCheck, label: 'Approvazioni', roles: ['manager'] },
]

interface SidebarContentProps {
  pathname: string
  items: typeof navItems
  onNavigate: () => void
  onLogout: () => void
}

// Componente a livello di modulo (non ricreato ad ogni render) condiviso
// tra la sidebar desktop e il drawer mobile.
function SidebarContent({ pathname, items, onNavigate, onLogout }: SidebarContentProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-border">
        <h1 className="text-xl font-bold">Cassa</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Chiusura e prima nota</p>
      </div>

      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {items.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              pathname === href || pathname.startsWith(href + '/')
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1">{label}</span>
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-border">
        <button
          onClick={onLogout}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Esci
        </button>
      </div>
    </div>
  )
}

interface Props {
  role: 'manager' | 'cassiere'
}

export function CassaSidebar({ role }: Props) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const closeDrawer = () => setOpen(false)
  const items = navItems.filter(item => item.roles.includes(role))

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 h-full flex-col border-r border-border bg-card shrink-0">
        <SidebarContent pathname={pathname} items={items} onNavigate={closeDrawer} onLogout={handleLogout} />
      </aside>

      {/* Mobile header + drawer */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center h-14 px-4 border-b border-border bg-background">
        <button
          onClick={() => setOpen(true)}
          className="p-2 rounded-md hover:bg-accent"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="ml-3 font-semibold flex-1">
          {items.find(item => pathname === item.href || pathname.startsWith(item.href + '/'))?.label ?? 'Cassa'}
        </span>
      </div>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={closeDrawer} />
          <aside
            className="relative w-72 bg-card border-r border-border flex flex-col"
            onTouchMove={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeDrawer}
              className="absolute top-4 right-4 p-1 rounded hover:bg-accent"
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent pathname={pathname} items={items} onNavigate={closeDrawer} onLogout={handleLogout} />
          </aside>
        </div>
      )}
    </>
  )
}
