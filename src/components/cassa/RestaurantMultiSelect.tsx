'use client'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/popover'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RestaurantOption {
  id: string
  name: string
}

interface Props {
  restaurants: RestaurantOption[]
  selected: string[]
  onChange: (ids: string[]) => void
  className?: string
  // La semantica di "selezione vuota" cambia da un chiamante all'altro
  // (in Analisi vuoto = tutti; in Progressivo Buste vuoto = nessuno,
  // bisogna sceglierne almeno uno): l'etichetta deve rifletterla, non
  // dare per scontato "tutti".
  emptyLabel?: string
}

// Selettore multiplo dei ristoranti. Usa Popover (non DropdownMenu): un
// menu a tendina è pensato per un elenco di azioni che chiudono al tap,
// mentre qui serve un pannello che resta aperto mentre si selezionano più
// voci — su mobile il DropdownMenu di Radix richiedeva più tap per
// chiudersi proprio per questo disallineamento (semantica "menu" invece
// di "pannello"), il Popover si chiude in modo affidabile con un solo tap
// fuori o sul pulsante "Chiudi".
export function RestaurantMultiSelect({ restaurants, selected, onChange, className, emptyLabel = 'Tutti i ristoranti' }: Props) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(r => r !== id) : [...selected, id])
  }

  const label = selected.length === 0
    ? emptyLabel
    : selected.length === 1
      ? (restaurants.find(r => r.id === selected[0])?.name ?? '1 selezionato')
      : `${selected.length} ristoranti selezionati`

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
          {restaurants.map(r => {
            const checked = selected.includes(r.id)
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggle(r.id)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm text-left hover:bg-accent focus-visible:outline-none focus-visible:bg-accent"
              >
                <span className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                  checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                )}>
                  {checked && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate">{r.name}</span>
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
