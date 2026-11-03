'use client'
import { cn } from '@/lib/utils'
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
  const pill = (attiva: boolean) => cn(
    'flex h-10 flex-none items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors active:scale-[0.97]',
    attiva ? 'bg-primary text-primary-foreground' : 'border border-line-strong bg-card'
  )
  return (
    <div className={cn('-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
      <button type="button" onClick={() => onChange([])} className={pill(selected.length === 0)}>
        {emptyLabel}
      </button>
      {restaurants.map((r, i) => {
        const on = selected.includes(r.id)
        return (
          <button key={r.id} type="button" onClick={() => onChange(on ? selected.filter(x => x !== r.id) : [...selected, r.id])} className={pill(on)}>
            <span className="h-2 w-2 rounded-full" style={{ background: coloreLocale(i) }} />
            {r.name}
          </button>
        )
      })}
    </div>
  )
}
