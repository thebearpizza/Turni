'use client'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/popover'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FornitoreOption {
  id: string
  nome: string
}

interface Props {
  fornitori: FornitoreOption[]
  selected: string[]
  onChange: (ids: string[]) => void
  className?: string
}

// Stesso pattern (Popover, non DropdownMenu — resta aperto mentre si
// selezionano più voci) di RestaurantMultiSelect, ma per fornitori
// (campo nome, non name): l'elenco può essere lungo, un menu a tendina
// con ricerca visiva scorrevole è più adatto delle pillole già usate per
// i ristoranti.
export function FornitoreMultiSelect({ fornitori, selected, onChange, className }: Props) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(f => f !== id) : [...selected, id])
  }

  const label = selected.length === 0
    ? 'Tutti i fornitori'
    : selected.length === 1
      ? (fornitori.find(f => f.id === selected[0])?.nome ?? '1 selezionato')
      : `${selected.length} fornitori selezionati`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={cn('w-full sm:w-72 justify-between font-normal', className)}>
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1">
        <div className="max-h-64 overflow-y-auto">
          {fornitori.map(f => {
            const checked = selected.includes(f.id)
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => toggle(f.id)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm text-left hover:bg-accent focus-visible:outline-none focus-visible:bg-accent"
              >
                <span className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                  checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                )}>
                  {checked && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate">{f.nome}</span>
              </button>
            )
          })}
        </div>
        <div className="border-t border-border mt-1 pt-1 px-1">
          <PopoverClose asChild>
            <Button type="button" variant="ghost" size="sm" className="w-full">Chiudi</Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  )
}
