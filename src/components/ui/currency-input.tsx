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
  // Nasconde gli stepper +/-: per un campo stretto (es. inline in una
  // riga elenco) lo spazio riservato (pr-16) non lascerebbe posto al
  // numero. Digitazione libera invariata.
  hideStepper?: boolean
  // Per numeri che non sono importi (es. una quantità): niente simbolo €.
  hideCurrency?: boolean
  // Decimali ammessi — 2 per gli importi; di più per le quantità (le
  // fatture riportano spesso i kg con tre decimali, es. 1,245).
  decimali?: number
}

function roundTo(n: number, decimali: number): number {
  const f = 10 ** decimali
  return Math.round((n + Number.EPSILON) * f) / f
}

// blankZero: negli input editabili uno zero si mostra vuoto invece di "0",
// cosi' si digita subito l'importo senza dover prima cancellare il valore
// predefinito. I campi di sola lettura mostrano sempre il valore reale.
function formatDisplay(v: number | null, blankZero: boolean, decimali: number): string {
  if (v === null || !Number.isFinite(v)) return ''
  if (blankZero && v === 0) return ''
  if (v % 1 === 0) return String(v)
  const s = v.toFixed(decimali)
  // Importi sempre con due decimali ("0,60"); altrimenti senza zeri finali ("1,25" non "1,250").
  return (decimali === 2 ? s : s.replace(/0+$/, '').replace(/\.$/, '')).replace('.', ',')
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
export function CurrencyInput({ value, onChange, step = 1, min = 0, readOnly = false, disabled = false, className, hideStepper = false, hideCurrency = false, decimali = 2 }: CurrencyInputProps) {
  const isReadOnly = readOnly || !onChange
  const [text, setText] = useState(formatDisplay(value, !isReadOnly, decimali))

  useEffect(() => { setText(formatDisplay(value, !isReadOnly, decimali)) }, [value, isReadOnly, decimali])

  function handleTextChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    setText(raw)
    // Propaga anche a ogni tasto premuto, non solo al blur: un calcolo
    // derivato altrove (es. Differenza in Quadratura) deve aggiornarsi
    // mentre si digita, non solo uscendo dal campo. Il testo mostrato
    // resta quello digitato per intero — solo il valore comunicato al
    // genitore viene già interpretato/vincolato, non la formattazione
    // visiva del campo, che resta compito del blur (vedi handleBlur).
    if (isReadOnly) return
    const parsed = parseText(raw)
    if (parsed !== null) {
      const clamped = min != null ? Math.max(min, roundTo(parsed, decimali)) : roundTo(parsed, decimali)
      onChange!(clamped)
    }
  }

  function handleBlur() {
    if (isReadOnly) return
    const parsed = parseText(text)
    if (parsed === null) {
      setText(formatDisplay(value, true, decimali))
      return
    }
    const clamped = min != null ? Math.max(min, roundTo(parsed, decimali)) : roundTo(parsed, decimali)
    onChange!(clamped)
    setText(formatDisplay(clamped, true, decimali))
  }

  function bump(delta: number) {
    if (isReadOnly) return
    const base = value ?? 0
    const next = roundTo(base + delta, decimali)
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
      {!hideCurrency && <span className="pointer-events-none absolute left-3 text-muted-foreground text-base">€</span>}
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={isReadOnly ? undefined : hideCurrency ? '0' : '0,00'}
        value={text}
        onChange={handleTextChange}
        onBlur={handleBlur}
        readOnly={isReadOnly}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background py-1.5 text-base tabular-nums ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
          hideCurrency ? "pl-3" : "pl-7",
          hideStepper ? "pr-2" : "pr-16",
          isReadOnly && "bg-muted text-muted-foreground cursor-default",
          className
        )}
      />
      {!isReadOnly && !hideStepper && (
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
