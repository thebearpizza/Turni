'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, ClipboardList } from 'lucide-react'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/home',     icon: Home,          label: 'Home' },
  { href: '/home/ods', icon: ClipboardList, label: 'ODS'  },
]

export function BottomNav() {
  const pathname = usePathname()
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-border flex h-14">
      {TABS.map(({ href, icon: Icon, label }) => {
        const active = pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium tracking-wide transition-colors',
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="w-5 h-5" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
