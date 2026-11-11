import { cn } from '@/lib/utils'

// Selettore del mese unico per tutta l'app ("‹ Novembre 2026 ›"): prima
// ogni sezione aveva il suo (barra grigia con frecce da 34 px, pulsanti
// tondi, etichetta che andava a capo). Barra grigia, frecce da 40 px,
// etichetta su una riga sola.

const Freccia = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
)

export function SelettoreMese({ etichetta, onPrec, onSucc, precOk = true, succOk = true, className }: {
  etichetta: string
  onPrec: () => void
  onSucc: () => void
  precOk?: boolean
  succOk?: boolean
  className?: string
}) {
  const freccia = 'flex h-10 w-10 flex-none items-center justify-center rounded-[8px] transition-transform active:scale-[0.94] disabled:opacity-30 disabled:active:scale-100'
  return (
    <div data-sk-keep="" className={cn('flex h-11 min-w-[200px] items-center justify-between gap-0.5 rounded-[10px] bg-[oklch(0.93_0.01_250)] px-0.5 dark:bg-secondary', className)}>
      <button type="button" aria-label="Mese precedente" disabled={!precOk} onClick={onPrec} className={freccia}><Freccia d="M15 6l-6 6 6 6" /></button>
      <span className="min-w-[112px] flex-1 truncate whitespace-nowrap text-center text-sm font-medium">{etichetta}</span>
      <button type="button" aria-label="Mese successivo" disabled={!succOk} onClick={onSucc} className={freccia}><Freccia d="M9 6l6 6-6 6" /></button>
    </div>
  )
}
