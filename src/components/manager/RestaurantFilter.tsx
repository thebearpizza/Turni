'use client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface RestaurantOption {
  id: string
  name: string
}

interface Props {
  restaurants: RestaurantOption[]
  value: string
  onChange: (id: string) => void
  className?: string
}

// Valore sentinella per "tutti i ristoranti" — un'unica costante condivisa
// invece che 'all' in alcune tab e 'tutti' in altre, stesso tipo di
// disallineamento che questo componente esiste per eliminare.
export const RESTAURANT_FILTER_ALL = 'tutti'

// Filtro ristorante a selezione singola, un'unica resa per tutte le tab
// dell'area Manager che lo offrono (Turni, ODS, Presenze, Assenze,
// Dipendenti): prima ciascuna aveva il proprio stile (larghezza, altezza,
// arrotondamento) pur trattandosi dello stesso controllo con lo stesso
// significato — un manager con più locali lo doveva ritrovare ogni volta
// con un aspetto diverso.
export function RestaurantFilter({ restaurants, value, onChange, className }: Props) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? 'h-9 w-full sm:w-56'}>
        <SelectValue placeholder="Tutti i ristoranti" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={RESTAURANT_FILTER_ALL}>Tutti i ristoranti</SelectItem>
        {restaurants.map(r => (
          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
