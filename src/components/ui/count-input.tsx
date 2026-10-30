'use client'
import { CampoNumerico } from '@/components/ui/tastierino'

interface CountInputProps {
  value: number
  onChange?: (value: number) => void
  /** Non più usato: niente stepper +/- nel design Acciaio. */
  step?: number
  min?: number
  readOnly?: boolean
  disabled?: boolean
  className?: string
}

// Campo per conteggi interi (es. Coperti): tastierino senza virgola.
export function CountInput({ value, onChange, min = 0, readOnly = false, disabled = false, className }: CountInputProps) {
  return (
    <CampoNumerico
      value={value}
      onChange={onChange}
      decimali={0}
      min={min}
      readOnly={readOnly}
      disabled={disabled}
      className={className}
    />
  )
}
