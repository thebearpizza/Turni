'use client'
import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TimeInputProps {
  value: string // "HH:mm" oppure ""
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
}

// Su iOS Safari <input type="time"> apre SOLO la rotella nativa: non c'è
// modo di digitare le cifre da tastiera in quel controllo. Qui affianchiamo
// un campo testuale (tastiera numerica, digitazione libera con inserimento
// automatico dei ":") a un <input type="time"> nascosto che resta
// raggiungibile tramite l'icona orologio, per chi preferisce la rotella.
export function TimeInput({ value, onChange, className, disabled }: TimeInputProps) {
  const [text, setText] = useState(formatDisplay(value))
  const nativeRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setText(formatDisplay(value)) }, [value])

  function formatDisplay(v: string): string {
    return v ? v.slice(0, 5) : ''
  }

  function handleTextChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
    const formatted = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits
    setText(formatted)

    if (formatted.length === 5) {
      const [h, m] = formatted.split(':').map(Number)
      if (h <= 23 && m <= 59) onChange(formatted)
    } else if (formatted === '') {
      onChange('')
    }
  }

  function handleBlur() {
    if (text.length === 5) {
      const [h, m] = text.split(':').map(Number)
      if (h <= 23 && m <= 59) return
    }
    // Valore incompleto o non valido — torna all'ultimo orario valido
    setText(formatDisplay(value))
  }

  function openNativePicker() {
    const el = nativeRef.current
    if (!el) return
    // showPicker() è il modo corretto quando supportato; su iOS Safari
    // (che non lo espone) il focus/click nel gestore del tap apre comunque
    // la rotella, essendo dentro lo stesso gesto utente.
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return } catch { /* fallback sotto */ }
    }
    el.focus()
    el.click()
  }

  return (
    <div className="relative flex items-center w-full">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="HH:MM"
        value={text}
        onChange={handleTextChange}
        onBlur={handleBlur}
        maxLength={5}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 pr-9 text-base tabular-nums ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      />
      <button
        type="button"
        onClick={openNativePicker}
        disabled={disabled}
        tabIndex={-1}
        aria-label="Apri selettore orario"
        className="absolute right-1 flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent disabled:pointer-events-none transition-colors"
      >
        <Clock className="w-4 h-4" />
      </button>
      <input
        ref={nativeRef}
        type="time"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
    </div>
  )
}
