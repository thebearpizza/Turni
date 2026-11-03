'use client'
import { PilloleLocali } from '@/components/shared/PilloleLocali'

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
  'oklch(0.58 0.12 180)', 'oklch(0.6 0.11 250)', 'oklch(0.72 0.12 75)',
  'oklch(0.62 0.12 330)', 'oklch(0.62 0.12 20)', 'oklch(0.58 0.12 140)',
]

/** Variante tenue del colore (barre non evidenziate nei grafici, legende). */
export function coloreTenue(c: string): string {
  const m = c.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/)
  if (!m) return c
  return `oklch(${Math.min(0.85, +m[1] + 0.09).toFixed(2)} ${(+m[2] * 0.78).toFixed(3)} ${m[3]})`
}
export function coloreLocale(indice: number): string {
  return COLORI_LOCALE[indice % COLORI_LOCALE.length]
}

// Filtro ristorante del design a scelta singola: le pillole condivise
// (riordinabili con una pressione lunga) con "Tutti i locali" in testa.
export function RestaurantFilter({ restaurants, value, onChange, className }: Props) {
  return (
    <PilloleLocali
      className={className}
      locali={restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) }))}
      selezionati={value === RESTAURANT_FILTER_ALL ? [] : [value]}
      onCambia={ids => onChange(ids[0] ?? RESTAURANT_FILTER_ALL)}
    />
  )
}
