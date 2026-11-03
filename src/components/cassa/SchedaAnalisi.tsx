import { cn } from '@/lib/utils'

// Contenitore delle sezioni di Analisi (design Manager Analisi): titolo a
// 17px con sottotitolo grigio sulla stessa riga, azione o legenda a destra.
export function SchedaAnalisi({ titolo, sotto, destra, className, children, ritardo = 0 }: {
  titolo: React.ReactNode
  sotto?: React.ReactNode
  destra?: React.ReactNode
  className?: string
  children: React.ReactNode
  ritardo?: number
}) {
  return (
    <section
      className={cn('anim-swapin flex flex-col gap-3 rounded-[12px] border border-border bg-card px-4 py-4 sm:px-5 sm:py-[18px]', className)}
      style={ritardo ? { animationDelay: `${ritardo}ms` } : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="text-[17px] font-semibold">{titolo}</span>
          {sotto && <span className="text-[13px] text-muted-foreground">{sotto}</span>}
        </div>
        {destra}
      </div>
      {children}
    </section>
  )
}

export const COLORI_PAGAMENTO = {
  pos: 'oklch(0.56 0.1 175)',
  contanti: 'oklch(0.72 0.12 75)',
  bonifico: 'oklch(0.58 0.12 250)',
} as const
