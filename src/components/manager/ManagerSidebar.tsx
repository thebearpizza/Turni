'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard, Store, Users, Clock, CalendarX,
  CheckSquare, MessageSquare, FileSpreadsheet, ClipboardList, CalendarClock, UserCheck,
} from 'lucide-react'
import { useBadging } from '@/hooks/useBadging'
import { DockNav, type DockNavItem, type DockNavAreaLink } from '@/components/nav/DockNav'
import type { Profile } from '@/types'

// `direttoreOnly: true` → visibile anche a capo_servizio con is_direttore === true,
// oltre ai ruoli elencati in `roles`. "Home" non è una voce: DockNav la
// gestisce a parte (pulsante flottante + piede del foglio).
const NAV_ITEMS = [
  { key: 'dashboard',    href: '/dashboard',        icon: LayoutDashboard, label: 'Dashboard',    roles: ['manager', 'capo_servizio'] },
  { key: 'turni',        href: '/turni',             icon: CalendarClock,   label: 'Turni',         roles: ['manager', 'capo_servizio'] },
  { key: 'presenze',     href: '/presenze',          icon: Clock,           label: 'Presenze',      roles: ['manager'] },
  { key: 'report',       href: '/report',            icon: FileSpreadsheet, label: 'Report',        roles: ['manager', 'capo_servizio'] },
  { key: 'ristoranti',   href: '/ristoranti',        icon: Store,           label: 'Ristoranti',    roles: ['manager'] },
  { key: 'dipendenti',   href: '/dipendenti',        icon: Users,           label: 'Dipendenti',    roles: ['manager'], direttoreOnly: true },
  { key: 'assenze',      href: '/assenze',           icon: CalendarX,       label: 'Assenze',       roles: ['manager'], direttoreOnly: true },
  { key: 'approvazioni', href: '/approvazioni',      icon: CheckSquare,     label: 'Approvazioni',  roles: ['manager'], direttoreOnly: true },
  { key: 'bacheca',      href: '/bacheca',           icon: MessageSquare,   label: 'Bacheca',       roles: ['manager', 'capo_servizio'] },
  { key: 'ods',          href: '/ods',               icon: ClipboardList,   label: 'ODS',           roles: ['manager', 'capo_servizio'] },
  { key: 'account-pendenti', href: '/account-pendenti', icon: UserCheck,    label: 'Account Pendenti', roles: ['manager'], platformOwnerOnly: true },
] as const

interface Props {
  profile: Profile & { restaurant?: { id: string; name: string } | null }
}

export function ManagerSidebar({ profile }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [unreadBulletins, setUnreadBulletins] = useState(0)
  const [unreadOds, setUnreadOds] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [richiesteAssenza, setRichiesteAssenza] = useState(0)
  useBadging(unreadOds)

  const isDirettore = profile.role === 'capo_servizio' && profile.is_direttore === true
  const isPlatformOwner = profile.role === 'manager' && profile.managed_restaurant_ids === null

  // Conteggio comunicati non letti (solo capo_servizio) — nessuna
  // realtime, si aggiorna alla visita di /bacheca (watermark in
  // localStorage), stesso comportamento di prima.
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

  useEffect(() => {
    if (profile.role !== 'capo_servizio') return
    if (pathname !== '/bacheca') return
    localStorage.setItem('bulletins_last_seen', new Date().toISOString())
    setUnreadBulletins(0)
  }, [pathname, profile.role])

  // Notifiche ODS non lette (solo capo_servizio) con realtime.
  useEffect(() => {
    if (profile.role !== 'capo_servizio') return
    const supabase = createClient()
    async function fetchUnread() {
      const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
      setUnreadOds(count ?? 0)
    }
    fetchUnread()
    const channel = supabase
      .channel('sidebar_ods_notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, fetchUnread)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile.role])

  // Account pendenti (solo proprietario di piattaforma).
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

  // Richieste di assenza in attesa (Approvazioni) — manager e direttore,
  // con realtime: badge nuovo, prima la voce non ne aveva uno.
  useEffect(() => {
    if (profile.role !== 'manager' && !isDirettore) return
    const supabase = createClient()
    async function fetchCount() {
      const { count } = await supabase.from('absences').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      setRichiesteAssenza(count ?? 0)
    }
    fetchCount()
    const channel = supabase
      .channel('dock_richieste_assenza')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absences' }, fetchCount)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile.role, isDirettore])

  const badgeByKey: Record<string, number> = {
    bacheca: unreadBulletins,
    ods: unreadOds,
    'account-pendenti': pendingCount,
    approvazioni: richiesteAssenza,
  }

  const items: DockNavItem[] = NAV_ITEMS
    .filter(item =>
      ((item.roles as readonly string[]).includes(profile.role) || ('direttoreOnly' in item && item.direttoreOnly === true && isDirettore)) &&
      (!('platformOwnerOnly' in item) || (item.platformOwnerOnly === true && isPlatformOwner))
    )
    .map(item => ({ key: item.key, href: item.href, icon: item.icon, label: item.label, badge: badgeByKey[item.key] }))

  // Selettore macroaree: solo per chi ne vede più di una (manager tutte e
  // tre, direttore Turni+Acquisti) — DockNav lo nasconde da sé se riceve
  // un solo elemento o undefined.
  const areaLinks: DockNavAreaLink[] | undefined =
    profile.role === 'manager'
      ? [
          { key: 'turni', label: 'Turni', href: '/dashboard' },
          { key: 'cassa', label: 'Cassa', href: '/cassa' },
          { key: 'acquisti', label: 'Acquisti', href: '/acquisti/fatture' },
        ]
      : isDirettore
        ? [
            { key: 'turni', label: 'Turni', href: '/dashboard' },
            { key: 'acquisti', label: 'Acquisti', href: '/acquisti/fatture' },
          ]
        : undefined

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <DockNav
      area="turni"
      items={items}
      userId={profile.id}
      homeHref="/hub"
      areaLinks={areaLinks}
      onLogout={handleLogout}
    />
  )
}
