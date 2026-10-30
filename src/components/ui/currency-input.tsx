'use client'
import { CampoNumerico } from '@/components/ui/tastierino'

interface CurrencyInputProps {
  value: number | null // null → sola-lettura senza valore ("—")
  onChange?: (value: number) => void
  /** Non più usato: niente stepper +/- nel design Acciaio, resta per compatibilità. */
  step?: number
  min?: number
  readOnly?: boolean
  disabled?: boolean
  className?: string
  /** Non più usato (vedi step). */
  hideStepper?: boolean
}

// Campo per importi in euro: si compila col tastierino del design
// (vedi tastierino.tsx), mai con la tastiera nativa.
export function CurrencyInput({ value, onChange, min = 0, readOnly = false, disabled = false, className }: CurrencyInputProps) {
  return (
    <CampoNumerico
      value={value}
      onChange={onChange}
      decimali={2}
      suffisso="€"
      min={min}
      readOnly={readOnly}
      disabled={disabled}
      className={className}
    />
  )
}
