'use client'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface CustomLoaderProps {
  fullScreen?: boolean
  size?: number
  className?: string
}

export function CustomLoader({ fullScreen = true, size = 140, className }: CustomLoaderProps) {
  const loader = (
    <div className={cn('relative', className)} style={{ width: size, height: size }} aria-label="Caricamento">
      {/* Layer 1 — Rotating light (conic-gradient) */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'conic-gradient(from 0deg, transparent 0deg, transparent 200deg, hsl(var(--primary) / 0.35) 300deg, hsl(var(--primary)) 360deg)',
        }}
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
        aria-hidden
      />

      {/* Layer 2 — Glass + static brand logo */}
      <div
        className={cn(
          'absolute inset-[6%] rounded-full overflow-hidden',
          'backdrop-blur-md bg-white/20 dark:bg-zinc-900/40',
          'border border-white/30 dark:border-white/10',
          'shadow-[0_8px_32px_rgba(0,0,0,0.18)]',
          'flex items-center justify-center'
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-branding.png"
          alt=""
          aria-hidden
          draggable={false}
          className="w-[68%] h-[68%] object-contain select-none dark:invert dark:brightness-110"
        />
      </div>

      {/* Layer 3 — Rotating lancetta (synthetic arc), synced with Layer 1 */}
      <motion.svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 100 100"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
        aria-hidden
      >
        <defs>
          <linearGradient id="lancetta-grad" gradientUnits="userSpaceOnUse" x1="50" y1="4" x2="92" y2="38">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="1" />
          </linearGradient>
        </defs>
        <path
          d="M 50 4 A 46 46 0 0 1 92 38"
          fill="none"
          stroke="url(#lancetta-grad)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx="92" cy="38" r="2.6" fill="hsl(var(--primary))" />
      </motion.svg>
    </div>
  )

  if (!fullScreen) return loader

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center w-full h-[100dvh] bg-background/80 backdrop-blur-sm"
    >
      {loader}
      <span className="sr-only">Caricamento in corso…</span>
    </div>
  )
}

export default CustomLoader
