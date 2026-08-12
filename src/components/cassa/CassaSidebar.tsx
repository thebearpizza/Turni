'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Home, Wallet, ShieldCheck, BarChart3, ListChecks, LogOut, Menu, X, FileText, Package, Banknote, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PushTestButton } from '@/components/shared/PushTestButton'
import { NotificationBell } from '@/components/shared/NotificationBell'

// Sidebar sul modello di ManagerSidebar — stesso pattern di badge/realtime
// dove serve (notifiche, richieste di modifica in attesa).
//
// Due elenchi separati (non un unico navItems filtrato per ruolo): manager
// e cassiere non vogliono solo un sottoinsieme diverso di voci, ma un
// ordine diverso degli stessi due elementi condivisi (Chiusura Cassa e
// Lista Chiusure) — un filtro su un solo array ordinato non può produrre
// entrambe le sequenze richieste.
const managerNavItems = [
  { href: '/hub',                  icon: Home,        label: 'Home' },
  { href: '/cassa/prenotazioni',   icon: CalendarDays, label: 'Prenotazioni' },
  { href: '/cassa/analisi',        icon: BarChart3,   label: 'Analisi' },
  { href: '/cassa/progressivo-buste', icon: Banknote, label: 'Progressivo Buste' },
  { href: '/cassa/lista-chiusure', icon: ListChecks,  label: 'Lista Chiusure' },
  { href: '/cassa/chiusura',       icon: Wallet,      label: 'Chiusura Cassa' },
  { href: '/cassa/fatture',        icon: FileText,    label: 'Fatture' },
  { href: '/cassa/articoli',       icon: Package,     label: 'Articoli' },
  { href: '/cassa/approvazioni',   icon: ShieldCheck, label: 'Approvazioni' },
]

const cassiereNavItems = [
  { href: '/cassa/chiusura',       icon: Wallet,      label: 'Chiusura Cassa' },
  { href: '/cassa/lista-chiusure', icon: ListChecks,  label: 'Lista Chiusure' },
]

// hostess: solo Prenotazioni, nient'altro di Cassa.
const hostessNavItems = [
  { href: '/cassa/prenotazioni', icon: CalendarDays, label: 'Prenotazioni' },
]

// capo_servizio con is_direttore=true: solo Fatture e Articoli, non figura
// con le altre voci (niente Home/Chiusura Cassa/Lista Chiusure/Analisi).
const direttoreNavItems = [
  { href: '/cassa/fatture',  icon: FileText, label: 'Fatture' },
  { href: '/cassa/articoli', icon: Package,  label: 'Articoli' },
]

interface SidebarContentProps {
  pathname: string
  items: typeof managerNavItems
  showNotifiche: boolean
  // Richieste di modifica chiusura in attesa: solo il manager la vede
  // (unico ruolo con la voce Approvazioni), 0 altrimenti.
  modificheInAttesa: number
  onNavigate: () => void
  onLogout: () => void
}

// Componente a livello di modulo (non ricreato ad ogni render) condiviso
// tra la sidebar desktop e il drawer mobile.
function SidebarContent({ pathname, items, showNotifiche, modificheInAttesa, onNavigate, onLogout }: SidebarContentProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="cassa-perforated-top p-6 border-b border-border flex items-start justify-between gap-2">
        <div>
          <h1 className="cassa-display text-2xl">Cassa</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Gestione cassa</p>
        </div>
        {showNotifiche && <NotificationBell />}
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
            {href === '/cassa/approvazioni' && modificheInAttesa > 0 && (
              <span className="ml-auto w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {modificheInAttesa > 9 ? '9+' : modificheInAttesa}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-border space-y-3">
        <PushTestButton />
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
  role: 'manager' | 'cassiere' | 'direttore' | 'hostess'
}

export function CassaSidebar({ role }: Props) {
  const [open, setOpen] = useState(false)
  const [modificheInAttesa, setModificheInAttesa] = useState(0)
  const pathname = usePathname()
  const router = useRouter()
  const closeDrawer = () => setOpen(false)
  const items =
    role === 'manager'  ? managerNavItems :
    role === 'cassiere' ? cassiereNavItems :
    role === 'hostess'  ? hostessNavItems  : direttoreNavItems

  // Richieste di modifica in attesa, con realtime: la voce Approvazioni
  // non aveva finora alcun segnale, il manager doveva andare a
  // controllare a mano (vedi audit) — stesso pattern del badge ODS di
  // ManagerSidebar. La RLS di cassa_chiusure_modifiche_select restituisce
  // solo le richieste dei locali che il manager gestisce.
  useEffect(() => {
    if (role !== 'manager') return
    const supabase = createClient()

    async function fetchCount() {
      const { count } = await supabase
        .from('cassa_chiusure_modifiche')
        .select('id', { count: 'exact', head: true })
        .eq('stato', 'in_attesa')
      setModificheInAttesa(count ?? 0)
    }

    fetchCount()

    const channel = supabase
      .channel('sidebar_modifiche_in_attesa')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cassa_chiusure_modifiche' }, fetchCount)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [role])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 h-full flex-col border-r border-border bg-card shrink-0">
        <SidebarContent pathname={pathname} items={items} showNotifiche={role === 'cassiere'} modificheInAttesa={modificheInAttesa} onNavigate={closeDrawer} onLogout={handleLogout} />
      </aside>

      {/* Mobile header + drawer */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center h-14 px-4 border-b border-border bg-background">
        <button
          onClick={() => setOpen(true)}
          className="-m-1 p-3 rounded-md hover:bg-accent"
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
            <SidebarContent pathname={pathname} items={items} showNotifiche={role === 'cassiere'} modificheInAttesa={modificheInAttesa} onNavigate={closeDrawer} onLogout={handleLogout} />
          </aside>
        </div>
      )}
    </>
  )
}
