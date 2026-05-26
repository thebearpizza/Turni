'use client'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Avoid hydration mismatch — render placeholder until mounted
  if (!mounted) return <div className={cn('w-9 h-9', className)} />

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className={cn(
        'w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground',
        'hover:text-foreground hover:bg-accent transition-colors',
        className,
      )}
      aria-label="Cambia tema"
    >
      {resolvedTheme === 'dark'
        ? <Sun  className="w-4 h-4" />
        : <Moon className="w-4 h-4" />}
    </button>
  )
}
