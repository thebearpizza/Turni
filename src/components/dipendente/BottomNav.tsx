'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, ClipboardList } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useBadging } from '@/hooks/useBadging'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/home',     icon: Home,          label: 'Home' },
  { href: '/home/ods', icon: ClipboardList, label: 'ODS'  },
]

export function BottomNav() {
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)
  useBadging(unread)

  useEffect(() => {
    const supabase = createClient()

    async function fetchUnread() {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null)
      setUnread(count ?? 0)
    }

    fetchUnread()

    // Realtime: re-count on any INSERT or UPDATE to notifications
    const channel = supabase
      .channel('bottom_nav_notifications')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        fetchUnread,
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // When the user lands on the ODS page the badge will auto-clear
  // because OdsClient marks notifications as read (which fires UPDATE →
  // realtime triggers fetchUnread → count drops to 0)

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-border flex h-14">
      {TABS.map(({ href, icon: Icon, label }) => {
        const active = href === '/home' ? pathname === '/home' : pathname === href || pathname.startsWith(href + '/')
        const showBadge = href === '/home/ods' && unread > 0

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium tracking-wide transition-colors relative',
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <div className="relative">
              <Icon className="w-5 h-5" />
              {showBadge && (
                <span className="absolute -top-1 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </div>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
