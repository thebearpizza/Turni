'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  LayoutDashboard, Store, Users, Clock, CalendarX,
  CheckSquare, MessageSquare, FileSpreadsheet, LogOut,
  Menu, X, Bell, ClipboardList, CalendarClock, UserCheck
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { useBadging } from '@/hooks/useBadging'
import type { Profile } from '@/types'
import { ROLE_LABELS } from '@/types'

// `direttoreOnly: true` → visibile anche a capo_servizio con is_direttore === true,
// oltre ai ruoli elencati in `roles`.
const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['manager', 'capo_servizio'] },
  { href: '/turni', icon: CalendarClock, label: 'Turni', roles: ['manager', 'capo_servizio'] },
  { href: '/ristoranti', icon: Store, label: 'Ristoranti', roles: ['manager'] },
  { href: '/dipendenti', icon: Users, label: 'Dipendenti', roles: ['manager'], direttoreOnly: true },
  { href: '/presenze', icon: Clock, label: 'Presenze', roles: ['manager'] },
  { href: '/assenze', icon: CalendarX, label: 'Assenze', roles: ['manager'], direttoreOnly: true },
  { href: '/approvazioni', icon: CheckSquare, label: 'Approvazioni', roles: ['manager'], direttoreOnly: true },
  { href: '/bacheca', icon: MessageSquare,   label: 'Bacheca', roles: ['manager', 'capo_servizio'] },
  { href: '/ods',     icon: ClipboardList,  label: 'ODS',     roles: ['manager', 'capo_servizio'] },
  { href: '/report',           icon: FileSpreadsheet, label: 'Report',           roles: ['manager', 'capo_servizio'] },
  { href: '/account-pendenti', icon: UserCheck,       label: 'Account Pendenti', roles: ['manager'], platformOwnerOnly: true },
]

interface Props {
  profile: Profile & { restaurant?: { id: string; name: string } | null }
}

export function ManagerSidebar({ profile }: Props) {
  const [open, setOpen] = useState(false)
  const [unreadBulletins, setUnreadBulletins] = useState(0)
  const [unreadOds, setUnreadOds]             = useState(0)
  const [pendingCount, setPendingCount]       = useState(0)
  const pathname = usePathname()
  const router = useRouter()
  useBadging(unreadOds)

  // Conteggio comunicati non letti (solo capo_servizio)
  useEffect(() => {
    if (profile.role !== 'capo_servizio') return
    const lastSeen = localStorage.getItem('bulletins_last_seen') ?? '1970-01-01T00:00:00Z'
    const supabase = createClient()
    supabase
      .from('bulletins')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', lastSeen)
      .then(({ count }) => setUnreadBulletins(count ?? 0))
  }, [profile.role])

  // Azzera il badge quando si visita /bacheca
  useEffect(() => {
    if (profile.role !== 'capo_servizio') return
    if (pathname !== '/bacheca') return
    localStorage.setItem('bulletins_last_seen', new Date().toISOString())
    setUnreadBulletins(0)
  }, [pathname, profile.role])

  // Notifiche ODS non lette (solo capo_servizio) con realtime
  useEffect(() => {
    if (profile.role !== 'capo_servizio') return
    const supabase = createClient()

    async function fetchUnread() {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null)
      setUnreadOds(count ?? 0)
    }

    fetchUnread()

    const channel = supabase
      .channel('sidebar_ods_notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, fetchUnread)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [profile.role])

  // Conta account pendenti (solo platform owner)
  useEffect(() => {
    if (profile.role !== 'manager' || profile.managed_restaurant_ids !== null) return
    const supabase = createClient()
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'manager')
      .eq('account_status', 'pending')
      .then(({ count }) => setPendingCount(count ?? 0))
  }, [profile.role, profile.managed_restaurant_ids])

  // Lock body scroll while mobile drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  const isDirettore = profile.role === 'capo_servizio' && profile.is_direttore === true
  const isPlatformOwner = profile.role === 'manager' && profile.managed_restaurant_ids === null
  const visibleItems = navItems.filter(item =>
    (item.roles.includes(profile.role) || (item.direttoreOnly === true && isDirettore)) &&
    (!('platformOwnerOnly' in item) || (item.platformOwnerOnly === true && isPlatformOwner))
  )

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-border">
        <h1 className="text-xl font-bold">inTurno</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Turni, Presenze e ODS</p>
      </div>

      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
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
            <span className="flex-1">{label}</span>
            {href === '/bacheca' && profile.role === 'capo_servizio' && unreadBulletins > 0 && (
              <span className="ml-auto w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {unreadBulletins > 9 ? '9+' : unreadBulletins}
              </span>
            )}
            {href === '/ods' && profile.role === 'capo_servizio' && unreadOds > 0 && (
              <span className="ml-auto w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {unreadOds > 9 ? '9+' : unreadOds}
              </span>
            )}
            {href === '/account-pendenti' && isPlatformOwner && pendingCount > 0 && (
              <span className="ml-auto w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
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
        <div className="flex items-center justify-between">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Esci
          </button>
          <ThemeToggle />
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 h-full flex-col border-r border-border bg-card shrink-0">
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
        <span className="ml-3 font-semibold flex-1">
          {navItems.find(item => pathname === item.href || pathname.startsWith(item.href + '/'))?.label ?? 'inTurno'}
        </span>
        {profile.role === 'capo_servizio' && (
          <Link href="/bacheca" className="relative p-2 rounded-md hover:bg-accent text-muted-foreground">
            <Bell className="w-5 h-5" />
            {unreadBulletins > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {unreadBulletins > 9 ? '9+' : unreadBulletins}
              </span>
            )}
          </Link>
        )}
      </div>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside
              className="relative w-72 bg-card border-r border-border flex flex-col"
              onTouchMove={(e) => e.stopPropagation()}
            >
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

    </>
  )
}
