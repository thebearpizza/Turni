'use client'
import { cn } from '@/lib/utils'
import { etichettaBucket } from '@/lib/analisi'
import type { Ctx } from '@/components/cassa/analisi/tipi'

export const TEAL = 'oklch(0.58 0.12 180)'

export function Card({ titolo, sotto, destra, children, ritardo = 0, className, piena }: { titolo: React.ReactNode; sotto?: string; destra?: React.ReactNode; children: React.ReactNode; ritardo?: number; className?: string; piena?: boolean }) {
  return (
    <section className={cn('anim-swapin flex min-w-0 flex-col gap-3 overflow-hidden rounded-[12px] border border-border bg-card py-4 sm:py-[18px]', !piena && 'px-4 sm:px-5', className)} style={{ animationDelay: `${ritardo}ms` }}>
      <div className={cn('flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5', piena && 'px-4 sm:px-5')}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="text-[17px] font-semibold">{titolo}</span>
          {sotto && <span className="text-[13px] text-muted-foreground">{sotto}</span>}
        </div>
        {destra}
      </div>
      {children}
    </section>
  )
}

export const ORD = [1, 2, 3, 4, 5, 6, 0]
export const tap = 'cursor-pointer transition-transform active:scale-[0.98]'
export const COLORI_PAG = { pos: TEAL, con: 'oklch(0.72 0.12 75)', bon: 'oklch(0.6 0.11 250)' }
export const COLORI_FAT = { fo: TEAL, be: 'oklch(0.6 0.11 250)', nf: 'oklch(0.72 0.12 75)' }

export function etichetteSerie(c: Ctx) { return c.v.bk.map(k => etichettaBucket(k, c.v.mensile)) }

