'use client'
import { cn } from '@/lib/utils'

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
// invece che 'all' in alcune tab e 'tutti' in altre.
export const RESTAURANT_FILTER_ALL = 'tutti'

// Colore stabile per locale (pallino nelle pillole, legende dei grafici):
// stessa tavolozza dei prototipi (teal, blu, ocra, viola, rosa, verde).
const COLORI_LOCALE = [
  'oklch(0.58 0.12 180)', 'oklch(0.58 0.12 250)', 'oklch(0.68 0.12 75)',
  'oklch(0.58 0.12 320)', 'oklch(0.62 0.12 20)', 'oklch(0.58 0.12 140)',
]
export function coloreLocale(indice: number): string {
  return COLORI_LOCALE[indice % COLORI_LOCALE.length]
}

// Filtro ristorante del design: una fila scorrevole di pillole ("Tutti i
// locali" più una per locale, con il suo pallino colorato). Unica resa per
// tutte le sezioni che lo offrono.
export function RestaurantFilter({ restaurants, value, onChange, className }: Props) {
  if (restaurants.length <= 1) return null
  const pill = (attiva: boolean) => cn(
    'flex h-10 flex-none items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors active:scale-[0.97]',
    attiva ? 'bg-primary text-primary-foreground' : 'border border-line-strong bg-card'
  )
  return (
    <div className={cn('-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
      <button type="button" onClick={() => onChange(RESTAURANT_FILTER_ALL)} className={pill(value === RESTAURANT_FILTER_ALL)}>
        Tutti i locali
      </button>
      {restaurants.map((r, i) => (
        <button key={r.id} type="button" onClick={() => onChange(r.id)} className={pill(value === r.id)}>
          <span className="h-2 w-2 rounded-full" style={{ background: coloreLocale(i) }} />
          {r.name}
        </button>
      ))}
    </div>
  )
}
