'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

// Tastierino numerico del design Acciaio (Tastierino.dc.html): i campi
// numerici non aprono mai la tastiera nativa, ma questo tastierino
// flottante ancorato al campo. Regole:
// - il valore resta visibile finché non si digita: il primo tasto lo
//   sostituisce, non lo prolunga;
// - tocco fuori, o "Fatto" senza aver digitato, mantengono il valore
//   precedente;
// - ogni tasto propaga subito il valore (i calcoli derivati, es. la
//   differenza di cassa, si aggiornano mentre si digita).
// Su PC funziona anche da tastiera fisica mentre è aperto.

const ICONA_CANCELLA = (
  <svg width="24" height="24" viewBox="0 0 256 256" fill="currentColor" aria-hidden>
    <path d="M216,40H68.53a16.08,16.08,0,0,0-13.72,7.77L9.14,123.88a8,8,0,0,0,0,8.24l45.67,76.11A16.08,16.08,0,0,0,68.53,216H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H68.53l-43.2-72,43.2-72H216ZM106.34,146.34,124.69,128l-18.35-18.34a8,8,0,0,1,11.32-11.32L136,116.69l18.34-18.35a8,8,0,0,1,11.32,11.32L147.31,128l18.35,18.34a8,8,0,0,1-11.32,11.32L136,139.31l-18.34,18.35a8,8,0,0,1-11.32-11.32Z" />
  </svg>
)

const ICONA_CESTINO = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" />
  </svg>
)

export type TastoTastierino = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | ',' | 'del'

interface TastierinoProps {
  onKey: (k: TastoTastierino) => void
  onDone: () => void
  /** Senza separatore decimale (conteggi interi): il tasto resta vuoto. */
  senzaVirgola?: boolean
  onRemove?: () => void
  removeLabel?: string
  /** Etichetta del tasto separatore (default ","); il valore emesso resta ",". */
  separatore?: string
  /** Variante agganciata al fondo dello schermo (prop `dock` del prototipo):
   *  tutta larghezza, solo bordo sopra, angoli alti arrotondati. */
  dock?: boolean
  /** Tasti più bassi (48 px) e testo più piccolo: cassa del cassiere. */
  compatto?: boolean
  className?: string
}

export function Tastierino({ onKey, onDone, senzaVirgola, onRemove, removeLabel = 'Elimina', separatore = ',', dock, compatto, className }: TastierinoProps) {
  const tasti: (TastoTastierino | null)[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', senzaVirgola ? null : ',', '0', 'del']
  return (
    <div className={cn(
      'flex flex-col gap-2 border-line-strong bg-card',
      dock
        ? 'w-full rounded-t-[16px] border-t px-3 pb-5 pt-3 shadow-[0_-8px_28px_rgba(20,30,50,.10)]'
        : cn(compatto ? 'w-[264px]' : 'w-[312px]', 'max-w-[calc(100vw-24px)] rounded-[10px] border p-3 shadow-[0_6px_24px_rgba(20,30,50,.10)]'),
      className
    )}>
      <div className="grid grid-cols-3 gap-2">
        {tasti.map((k, i) =>
          k === null ? (
            <div key={i} />
          ) : (
            <button
              key={k}
              type="button"
              onPointerDown={e => e.preventDefault()}
              onClick={e => { e.stopPropagation(); onKey(k) }}
              aria-label={k === 'del' ? 'Cancella' : k === ',' ? 'Virgola' : k}
              className={cn('flex select-none items-center justify-center rounded-[6px] bg-[oklch(0.95_0.01_250)] font-mono font-medium', compatto ? 'h-12 text-xl' : 'h-[60px] text-2xl', ' text-foreground transition-transform active:scale-[0.97] active:bg-[oklch(0.9_0.01_250)] dark:bg-[oklch(0.24_0.01_250)] dark:active:bg-[oklch(0.3_0.01_250)]')}
            >
              {k === 'del' ? ICONA_CANCELLA : k === ',' ? separatore : k}
            </button>
          )
        )}
      </div>
      <div className={cn('grid gap-2', onRemove ? 'grid-cols-2' : 'grid-cols-1')}>
        {onRemove && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onRemove() }}
            className={cn('flex items-center justify-center gap-2 rounded-[6px] bg-neg-tint font-semibold text-neg transition-transform active:scale-[0.98]', compatto ? 'h-11 text-sm' : 'h-[52px] text-[15px]')}
          >
            {ICONA_CESTINO}
            {removeLabel}
          </button>
        )}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onDone() }}
          className={cn('flex items-center justify-center rounded-[6px] bg-primary font-semibold text-primary-foreground transition-transform active:scale-[0.98]', compatto ? 'h-11 text-[15px]' : 'h-[52px] text-base')}
        >
          Fatto
        </button>
      </div>
    </div>
  )
}

function formatIt(v: number, decimali: number): string {
  return v.toLocaleString('it-IT', { minimumFractionDigits: decimali === 0 ? 0 : 2, maximumFractionDigits: decimali })
}

// Il buffer è la stringa digitata ("1240,5"): mostrata così com'è mentre
// si digita, poi formattata alla chiusura.
function bufferToNumber(b: string): number | null {
  if (b === '' || b === ',') return null
  const n = parseFloat(b.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function formatBuffer(b: string): string {
  const [int, dec] = b.split(',')
  const intFmt = int === '' ? '0' : Number(int).toLocaleString('it-IT')
  return dec !== undefined ? `${intFmt},${dec}` : intFmt
}

export interface CampoNumericoProps {
  value: number | null
  onChange?: (value: number) => void
  /** Cifre decimali ammesse: 0 per i conteggi, 2 per gli importi. */
  decimali?: number
  /** Simbolo a destra del valore (es. "€"). */
  suffisso?: string
  min?: number
  max?: number
  readOnly?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
  'aria-label'?: string
  /** Azione distruttiva accanto a "Fatto" (es. elimina una spesa). */
  onRemove?: () => void
  removeLabel?: string
  /** Allineamento del valore nel campo. */
  allinea?: 'left' | 'right'
}

export function CampoNumerico({
  value, onChange, decimali = 2, suffisso, min, max, readOnly, disabled, placeholder,
  className, onRemove, removeLabel, allinea = 'left', ...rest
}: CampoNumericoProps) {
  const isReadOnly = readOnly || !onChange
  const [aperto, setAperto] = useState(false)
  const [buffer, setBuffer] = useState<string | null>(null) // null = non ancora digitato
  const valoreIniziale = useRef<number | null>(value)

  const apri = useCallback(() => {
    if (isReadOnly || disabled) return
    valoreIniziale.current = value
    setBuffer(null)
    setAperto(true)
  }, [isReadOnly, disabled, value])

  const chiudi = useCallback(() => {
    setAperto(false)
    setBuffer(null)
  }, [])

  const emetti = useCallback((b: string) => {
    const n = bufferToNumber(b)
    if (n === null || !onChange) return
    let v = n
    if (min != null) v = Math.max(min, v)
    if (max != null) v = Math.min(max, v)
    onChange(v)
  }, [onChange, min, max])

  const premi = useCallback((k: TastoTastierino) => {
    setBuffer(prev => {
      let b = prev ?? ''
      if (k === 'del') b = b.slice(0, -1)
      else if (k === ',') {
        if (decimali === 0 || b.includes(',')) return prev ?? ''
        b = (b === '' ? '0' : b) + ','
      } else {
        const dec = b.split(',')[1]
        if (dec !== undefined && dec.length >= decimali) return b
        if (b.replace(',', '').length >= 9) return b
        b = b === '0' ? k : b + k
      }
      emetti(b === '' ? '0' : b)
      return b
    })
  }, [decimali, emetti])

  // Tastiera fisica (PC/tablet con tastiera) mentre il tastierino è aperto.
  useEffect(() => {
    if (!aperto) return
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); premi(e.key as TastoTastierino) }
      else if (e.key === ',' || e.key === '.') { e.preventDefault(); premi(',') }
      else if (e.key === 'Backspace') { e.preventDefault(); premi('del') }
      else if (e.key === 'Enter') { e.preventDefault(); chiudi() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aperto, premi, chiudi])

  const testo = aperto && buffer !== null
    ? formatBuffer(buffer)
    : value === null || (value === 0 && !isReadOnly)
      ? ''
      : formatIt(value, decimali)

  const campo = (
    <div
      role={isReadOnly ? undefined : 'button'}
      tabIndex={isReadOnly || disabled ? -1 : 0}
      aria-label={rest['aria-label']}
      aria-disabled={disabled || undefined}
      onKeyDown={e => { if (!aperto && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); apri() } }}
      className={cn(
        'flex h-11 w-full items-center gap-2 rounded-md border border-input bg-card px-3.5 font-mono text-base tabular-nums outline-none transition-colors',
        !isReadOnly && !disabled && 'cursor-pointer',
        aperto && 'border-foreground ring-1 ring-foreground',
        isReadOnly && 'bg-muted text-muted-foreground',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <span className={cn('min-w-0 flex-1 truncate', allinea === 'right' && 'text-right', testo === '' && 'text-muted-foreground')}>
        {testo === '' ? (value === null && isReadOnly ? '—' : placeholder ?? (decimali ? '0,00' : '0')) : testo}
        {aperto && <span className="ml-px inline-block h-5 w-px translate-y-1 animate-pulse bg-foreground" />}
      </span>
      {suffisso && <span className="flex-none text-muted-foreground">{suffisso}</span>}
    </div>
  )

  if (isReadOnly) return campo

  return (
    <PopoverPrimitive.Root open={aperto} onOpenChange={o => (o ? apri() : chiudi())}>
      <PopoverPrimitive.Trigger asChild>{campo}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={e => e.preventDefault()}
          className="z-[60] outline-none data-[state=open]:anim-swapin data-[state=closed]:anim-swapout"
        >
          <Tastierino
            onKey={premi}
            onDone={chiudi}
            senzaVirgola={decimali === 0}
            onRemove={onRemove ? () => { chiudi(); onRemove() } : undefined}
            removeLabel={removeLabel}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
