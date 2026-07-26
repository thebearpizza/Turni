'use client'
import { cn } from '@/lib/utils'

interface Props {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}

// Pillola filtro condivisa (ristorante/periodo/granularità…) — unico punto
// che definisce altezza/padding, cosi' tutte le viste Cassa restano
// consistenti invece di ricalcolare la larghezza dal solo contenuto.
export function CassaPill({ active, onClick, children, className }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-full border px-3.5 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-accent',
        className
      )}
    >
      {children}
    </button>
  )
}
