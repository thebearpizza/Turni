// Palette qualitativa "Ledger" condivisa da tutti i grafici Cassa (donut
// categorie, trend categorie nel tempo…) — verde/rame del design system più
// toni terrosi coerenti, niente arcobaleno neon da dashboard generica.
export const CASSA_CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--cassa-copper))',
  '#8A6D3B',
  '#4A6670',
  '#7C5C4B',
  '#A8763E',
  '#5E7A5A',
  '#9C4B3D',
]

export function cassaChartColor(index: number): string {
  return CASSA_CHART_COLORS[index % CASSA_CHART_COLORS.length]
}
