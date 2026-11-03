// Palette qualitativa dei grafici Cassa (design Acciaio): toni oklch a pari
// luminosità, distinguibili tra loro e leggibili sia in chiaro che in scuro.
export const CASSA_CHART_COLORS = [
  'oklch(0.56 0.1 175)',
  'oklch(0.72 0.12 75)',
  'oklch(0.58 0.12 250)',
  'oklch(0.66 0.11 320)',
  'oklch(0.62 0.13 30)',
  'oklch(0.6 0.1 140)',
  'oklch(0.55 0.08 280)',
  'oklch(0.65 0.09 100)',
]

export function cassaChartColor(index: number): string {
  return CASSA_CHART_COLORS[index % CASSA_CHART_COLORS.length]
}
