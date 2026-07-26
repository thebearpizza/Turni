'use client'
import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CountInputProps {
  value: number
  onChange?: (value: number) => void
  step?: number
  min?: number
  readOnly?: boolean
  disabled?: boolean
  className?: string
}

// blankZero: come CurrencyInput — uno zero si mostra vuoto negli input
// editabili, cosi' si digita subito il numero invece di dover prima
// cancellare lo "0" predefinito (altrimenti, con un input controllato,
// digitare "4" dopo uno "0" non sostituito produce "04").
function formatDisplay(v: number, blankZero: boolean): string {
  if (!Number.isFinite(v)) return ''
  if (blankZero && v === 0) return ''
  return String(v)
}

function parseText(t: string): number | null {
  const normalized = t.trim()
  if (normalized === '') return null
  const n = parseInt(normalized, 10)
  return Number.isFinite(n) ? n : null
}

// Campo per conteggi interi (es. Coperti): stesso pattern di CurrencyInput
// (digitazione libera + stepper +/-) ma senza simbolo valuta né decimali.
export function CountInput({ value, onChange, step = 1, min = 0, readOnly = false, disabled = false, className }: CountInputProps) {
  const isReadOnly = readOnly || !onChange
  const [text, setText] = useState(formatDisplay(value, !isReadOnly))

  useEffect(() => { setText(formatDisplay(value, !isReadOnly)) }, [value, isReadOnly])

  function handleTextChange(e: React.ChangeEvent<HTMLInputElement>) {
    setText(e.target.value.replace(/[^0-9]/g, ''))
  }

  function handleBlur() {
    if (isReadOnly) return
    const parsed = parseText(text)
    if (parsed === null) {
      setText(formatDisplay(value, true))
      return
    }
    const clamped = min != null ? Math.max(min, parsed) : parsed
    onChange!(clamped)
    setText(formatDisplay(clamped, true))
  }

  function bump(delta: number) {
    if (isReadOnly) return
    const next = value + delta
    onChange!(min != null ? Math.max(min, next) : next)
  }

  return (
    <div className="relative flex items-center w-full">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={isReadOnly ? undefined : '0'}
        value={text}
        onChange={handleTextChange}
        onBlur={handleBlur}
        readOnly={isReadOnly}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 pr-16 py-1.5 text-base tabular-nums ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
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
