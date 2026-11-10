// Colori dei turni del design (MTTurni.dc.html, fCol): turno standard su
// tinta blu, straordinario su tinta attenzione, riposo su tinta negativa.
// Ogni tinta ha sfondo, bordo e testo; in tema scuro le stesse tinte scure.
// Le classi sono scritte per intero perché Tailwind le trovi nel sorgente.

export type TipoTurno = 'standard' | 'straordinario' | 'riposo'

export function tipoTurno(t: { is_rest_day: boolean; is_extraordinary: boolean }): TipoTurno {
  return t.is_rest_day ? 'riposo' : t.is_extraordinary ? 'straordinario' : 'standard'
}

export const TINTA_TURNO: Record<TipoTurno, string> = {
  standard: 'bg-[oklch(0.93_0.035_250)] border-[oklch(0.82_0.06_250)] text-[oklch(0.35_0.06_250)] dark:bg-[oklch(0.3_0.04_250)] dark:border-[oklch(0.42_0.06_250)] dark:text-[oklch(0.86_0.06_250)]',
  straordinario: 'bg-[oklch(0.94_0.05_75)] border-[oklch(0.82_0.09_75)] text-[oklch(0.42_0.08_75)] dark:bg-[oklch(0.32_0.05_75)] dark:border-[oklch(0.45_0.08_75)] dark:text-[oklch(0.86_0.08_75)]',
  riposo: 'bg-[oklch(0.94_0.035_25)] border-[oklch(0.84_0.06_25)] text-[oklch(0.45_0.1_25)] dark:bg-[oklch(0.3_0.04_25)] dark:border-[oklch(0.45_0.07_25)] dark:text-[oklch(0.85_0.07_25)]',
}

// Colore del bordo da solo: le maniglie delle barre della timeline sono
// lineette nel colore del bordo del turno.
export const MANIGLIA_TURNO: Record<TipoTurno, string> = {
  standard: 'bg-[oklch(0.82_0.06_250)] dark:bg-[oklch(0.5_0.06_250)]',
  straordinario: 'bg-[oklch(0.82_0.09_75)] dark:bg-[oklch(0.55_0.08_75)]',
  riposo: 'bg-[oklch(0.84_0.06_25)] dark:bg-[oklch(0.55_0.07_25)]',
}
