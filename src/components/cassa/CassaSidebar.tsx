'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Wallet, ShieldCheck, BarChart3, ListChecks, Banknote, CalendarDays } from 'lucide-react'
import { NotificationBell } from '@/components/shared/NotificationBell'
import { DockNav, type DockNavItem, type DockNavAreaLink } from '@/components/nav/DockNav'

// "Home" non è una voce: DockNav la gestisce a parte (pulsante flottante
// + piede del foglio), e solo per il manager (cassiere/hostess non hanno
// una Home a cui tornare).
const MANAGER_ITEMS = [
  { key: 'analisi',        href: '/cassa/analisi',           icon: BarChart3,   label: 'Analisi' },
  { key: 'lista-chiusure', href: '/cassa/lista-chiusure',     icon: ListChecks,  label: 'Lista Chiusure' },
  { key: 'chiusura',       href: '/cassa/chiusura',           icon: Wallet,      label: 'Chiusura Cassa' },
  { key: 'prenotazioni',   href: '/cassa/prenotazioni',       icon: CalendarDays, label: 'Prenotazioni' },
  { key: 'progressivo-buste', href: '/cassa/progressivo-buste', icon: Banknote, label: 'Progressivo Buste' },
  { key: 'approvazioni',   href: '/cassa/approvazioni',       icon: ShieldCheck, label: 'Approvazioni' },
] as const

const CASSIERE_ITEMS = [
  { key: 'chiusura',       href: '/cassa/chiusura',       icon: Wallet,     label: 'Chiusura Cassa' },
  { key: 'lista-chiusure', href: '/cassa/lista-chiusure', icon: ListChecks, label: 'Lista Chiusure' },
] as const

const HOSTESS_ITEMS = [
  { key: 'prenotazioni', href: '/cassa/prenotazioni', icon: CalendarDays, label: 'Prenotazioni' },
] as const

const AREA_LINKS: DockNavAreaLink[] = [
  { key: 'turni', label: 'Turni', href: '/dashboard' },
  { key: 'cassa', label: 'Cassa', href: '/cassa' },
  { key: 'acquisti', label: 'Acquisti', href: '/acquisti/fatture' },
]

interface Props {
  role: 'manager' | 'cassiere' | 'hostess'
  userId: string
}

export function CassaSidebar({ role, userId }: Props) {
  const router = useRouter()
  const [modificheInAttesa, setModificheInAttesa] = useState(0)

  // Richieste di modifica chiusura in attesa (Approvazioni) — solo
  // manager, con realtime. La RLS di cassa_chiusure_modifiche_select
  // restituisce solo le richieste dei locali che il manager gestisce.
  useEffect(() => {
    if (role !== 'manager') return
    const supabase = createClient()
    async function fetchCount() {
      const { count } = await supabase.from('cassa_chiusure_modifiche').select('id', { count: 'exact', head: true }).eq('stato', 'in_attesa')
      setModificheInAttesa(count ?? 0)
    }
    fetchCount()
    const channel = supabase
      .channel('sidebar_modifiche_in_attesa')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cassa_chiusure_modifiche' }, fetchCount)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [role])

  const baseItems = role === 'manager' ? MANAGER_ITEMS : role === 'cassiere' ? CASSIERE_ITEMS : HOSTESS_ITEMS
  const items: DockNavItem[] = baseItems.map(item => ({
    ...item,
    badge: item.key === 'approvazioni' ? modificheInAttesa : undefined,
  }))

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Non è una voce di navigazione, resta un piccolo pulsante
          flottante a parte — stesso trattamento del pulsante Home. */}
      {role === 'cassiere' && (
        <div className="fixed left-3 top-3 z-40">
          <NotificationBell />
        </div>
      )}
      <DockNav
        area="cassa"
        items={items}
        userId={userId}
        homeHref={role === 'manager' ? '/hub' : undefined}
        areaLinks={role === 'manager' ? AREA_LINKS : undefined}
        onLogout={handleLogout}
      />
    </>
  )
}
