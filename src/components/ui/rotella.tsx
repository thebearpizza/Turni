'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

// Rotella degli orari del design Acciaio (Rotella.dc.html): due colonne
// scorrevoli con aggancio, ore 01–24 e minuti 00–59. "24" è la
// mezzanotte e vale "00:mm" nel valore: i turni oltre mezzanotte restano
// dello stesso giorno lavorativo (vedi regole di dominio del design).
const ALTEZZA = 40

function parse(v: string): { hi: number; mi: number } {
  const [h, m] = String(v || '18:00').split(':').map(Number)
  const ora = Number.isFinite(h) ? (h === 0 ? 24 : h) : 18
  return { hi: Math.min(23, Math.max(0, ora - 1)), mi: Math.min(59, Math.max(0, Number.isFinite(m) ? m : 0)) }
}

function format(hi: number, mi: number): string {
  const ora = hi + 1 === 24 ? 0 : hi + 1
  return `${String(ora).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

function Colonna({ n, offset, selezionato, onSelect, etichetta }: {
  n: number; offset: number; selezionato: number; onSelect: (i: number) => void; etichetta: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const iniziale = useRef(selezionato)

  useEffect(() => {
    requestAnimationFrame(() => { if (ref.current) ref.current.scrollTop = iniziale.current * ALTEZZA })
  }, [])

  function onScroll() {
    const el = ref.current
    if (!el) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const t = Math.round(el.scrollTop / ALTEZZA) * ALTEZZA
      if (Math.abs(el.scrollTop - t) > 0.5) el.scrollTo({ top: t, behavior: 'smooth' })
    }, 160)
    const i = Math.max(0, Math.min(n - 1, Math.round(el.scrollTop / ALTEZZA)))
    if (i !== selezionato) onSelect(i)
  }

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      aria-label={etichetta}
      className="relative h-[200px] overflow-y-scroll overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ maskImage: 'linear-gradient(transparent,#000 30%,#000 70%,transparent)', WebkitMaskImage: 'linear-gradient(transparent,#000 30%,#000 70%,transparent)' }}
    >
      <div style={{ height: 80 }} />
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          onClick={() => ref.current?.scrollTo({ top: i * ALTEZZA, behavior: 'smooth' })}
          className={cn(
            'flex h-10 cursor-pointer items-center justify-center font-mono',
            i === selezionato ? 'text-[22px] font-semibold text-foreground' : 'text-lg font-medium text-[oklch(0.6_0.01_250)]'
          )}
        >
          {String(i + offset).padStart(2, '0')}
        </div>
      ))}
      <div style={{ height: 80 }} />
    </div>
  )
}

export function Rotella({ value, onChange, onDone, className }: {
  value: string; onChange: (v: string) => void; onDone: () => void; className?: string
}) {
  const [{ hi, mi }, setSel] = useState(() => parse(value))
  const emitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const aggiorna = useCallback((next: { hi: number; mi: number }) => {
    setSel(next)
    if (emitTimer.current) clearTimeout(emitTimer.current)
    emitTimer.current = setTimeout(() => onChange(format(next.hi, next.mi)), 120)
  }, [onChange])

  return (
    <div className={cn('flex w-[240px] flex-col gap-2.5 rounded-[10px] border border-line-strong bg-card p-3 shadow-[0_6px_24px_rgba(20,30,50,.10)]', className)}>
      <div className="relative grid grid-cols-[1fr_auto_1fr] items-center">
        <div className="pointer-events-none absolute inset-x-0 top-20 h-10 rounded-[6px] bg-[oklch(0.94_0.01_250)] dark:bg-[oklch(0.24_0.01_250)]" />
        <Colonna n={24} offset={1} selezionato={hi} onSelect={i => aggiorna({ hi: i, mi })} etichetta="Ore" />
        <span className="relative px-1 font-mono text-2xl font-semibold">:</span>
        <Colonna n={60} offset={0} selezionato={mi} onSelect={i => aggiorna({ hi, mi: i })} etichetta="Minuti" />
      </div>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation()
          if (emitTimer.current) clearTimeout(emitTimer.current)
          onChange(format(hi, mi))
          onDone()
        }}
        className="flex h-12 items-center justify-center rounded-[6px] bg-primary text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
      >
        Fatto
      </button>
    </div>
  )
}

// Campo orario: mostra "HH:MM" e apre la rotella ancorata al campo.
// Tocco fuori senza girare la rotella mantiene il valore precedente.
export function CampoOrario({ value, onChange, disabled, className, placeholder = 'HH:MM' }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; className?: string; placeholder?: string
}) {
  const [aperto, setAperto] = useState(false)
  const mostrato = value ? value.slice(0, 5) : ''
  return (
    <PopoverPrimitive.Root open={aperto} onOpenChange={o => !disabled && setAperto(o)}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-11 w-full items-center rounded-md border border-input bg-card px-3.5 font-mono text-base tabular-nums outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            aperto && 'border-foreground ring-1 ring-foreground',
            !mostrato && 'text-muted-foreground',
            className
          )}
        >
          {mostrato || placeholder}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-[60] anim-swapin outline-none">
          <Rotella value={value || '18:00'} onChange={onChange} onDone={() => setAperto(false)} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
