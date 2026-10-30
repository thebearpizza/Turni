'use client'
import { CampoOrario } from '@/components/ui/rotella'

interface TimeInputProps {
  value: string // "HH:mm" oppure ""
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
}

// Gli orari si scelgono con la Rotella del design (mai tastiera nativa né
// il selettore di sistema): vedi rotella.tsx.
export function TimeInput({ value, onChange, className, disabled }: TimeInputProps) {
  return <CampoOrario value={value} onChange={onChange} className={className} disabled={disabled} />
}
