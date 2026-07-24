'use client'
import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CurrencyInputProps {
  value: number | null // null → sola-lettura senza valore ("—")
  onChange?: (value: number) => void
  step?: number
  min?: number
  readOnly?: boolean
  disabled?: boolean
  className?: string
}

function roundTo2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// blankZero: negli input editabili uno zero si mostra vuoto invece di "0",
// cosi' si digita subito l'importo senza dover prima cancellare il valore
// predefinito. I campi di sola lettura mostrano sempre il valore reale.
function formatDisplay(v: number | null, blankZero: boolean): string {
  if (v === null || !Number.isFinite(v)) return ''
  if (blankZero && v === 0) return ''
  return v % 1 === 0 ? String(v) : v.toFixed(2).replace('.', ',')
}

function parseText(t: string): number | null {
  const normalized = t.trim().replace(',', '.')
  if (normalized === '' || normalized === '-') return null
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : null
}

// Campo per importi in euro: digitazione libera (virgola o punto) + stepper
// +/- per micro-aggiustamenti, sul modello di time-input.tsx (testo libero
// affiancato a un controllo dedicato).
export function CurrencyInput({ value, onChange, step = 1, min = 0, readOnly = false, disabled = false, className }: CurrencyInputProps) {
  const isReadOnly = readOnly || !onChange
  const [text, setText] = useState(formatDisplay(value, !isReadOnly))

  useEffect(() => { setText(formatDisplay(value, !isReadOnly)) }, [value, isReadOnly])

  function handleTextChange(e: React.ChangeEvent<HTMLInputElement>) {
    setText(e.target.value)
  }

  function handleBlur() {
    if (isReadOnly) return
    const parsed = parseText(text)
    if (parsed === null) {
      setText(formatDisplay(value, true))
      return
    }
    const clamped = min != null ? Math.max(min, roundTo2(parsed)) : roundTo2(parsed)
    onChange!(clamped)
    setText(formatDisplay(clamped, true))
  }

  function bump(delta: number) {
    if (isReadOnly) return
    const base = value ?? 0
    const next = roundTo2(base + delta)
    onChange!(min != null ? Math.max(min, next) : next)
  }

  if (value === null && isReadOnly) {
    return (
      <div className={cn(
        "flex h-9 w-full items-center rounded-md border border-input bg-muted px-3 py-1.5 text-base text-muted-foreground",
        className
      )}>
        —
      </div>
    )
  }

  return (
    <div className="relative flex items-center w-full">
      <span className="pointer-events-none absolute left-3 text-muted-foreground text-base">€</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={isReadOnly ? undefined : '0,00'}
        value={text}
        onChange={handleTextChange}
        onBlur={handleBlur}
        readOnly={isReadOnly}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background pl-7 pr-16 py-1.5 text-base tabular-nums ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
          isReadOnly && "bg-muted text-muted-foreground cursor-default",
          className
        )}
      />
      {!isReadOnly && (
        <div className="absolute right-1 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => bump(-step)}
            disabled={disabled}
            tabIndex={-1}
            aria-label="Diminuisci"
            className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent disabled:pointer-events-none transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => bump(step)}
            disabled={disabled}
            tabIndex={-1}
            aria-label="Aumenta"
            className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent disabled:pointer-events-none transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
