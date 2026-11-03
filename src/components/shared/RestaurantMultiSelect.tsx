'use client'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { coloreLocale } from '@/components/manager/RestaurantFilter'

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
  // bisogna sceglierne almeno uno): l'etichetta deve rifletterla.
  emptyLabel?: string
}

// Selettore multiplo dei locali del design: una fila scorrevole di pillole
// col pallino colorato di ogni locale, più locali insieme; la prima
// pillola azzera la selezione. Stessa resa del filtro a scelta singola.
export function RestaurantMultiSelect({ restaurants, selected, onChange, className, emptyLabel = 'Tutti i locali' }: Props) {
  return (
    <PilloleLocali
      multipla
      nascondiSeUno={false}
      className={className}
      etichettaTutti={emptyLabel}
      locali={restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) }))}
      selezionati={selected}
      onCambia={onChange}
    />
  )
}
