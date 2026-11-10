import { cn } from '@/lib/utils'
import type { RigaPresenza, StatoPresenza } from '@/lib/presenzeOggi'

const BADGE: Record<StatoPresenza, string> = {
  servizio: 'bg-ok-tint text-ok',
  uscito: 'bg-secondary text-muted-foreground',
  ritardo: 'bg-warn-tint text-warn',
  atteso: 'bg-secondary text-muted-foreground',
  assente: 'bg-neg-tint text-neg',
  foto: 'bg-warn-tint text-warn',
}

function iniziali(nome: string): string {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('')
}

// "Presenze di oggi in sala" della Home del capo servizio (Capo
// Servizio.dc.html, 7a): avatar con le iniziali, turno e timbratura in
// mono, stato a pillola. In alto quanti sono in servizio sul totale. La
// card riempie lo spazio sotto la timbratura e scorre al suo interno.
export function PresenzeOggiLista({ titolo, righe, className }: { titolo: string; righe: RigaPresenza[]; className?: string }) {
  const inServizio = righe.filter(r => r.stato === 'servizio' || r.stato === 'foto').length
  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden rounded-[14px] border border-border bg-card', className)}>
      <div className="flex flex-none items-center justify-between gap-2 border-b border-border px-3.5 py-3">
        <span className="text-[15px] font-semibold">{titolo}</span>
        <span className="font-mono text-[13px] font-medium text-muted-foreground">{inServizio}/{righe.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {righe.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-[18px] py-10 text-center">
            <span className="text-[15px] font-semibold">Nessuno in turno oggi</span>
            <span className="text-[13px] text-muted-foreground">Qui compaiono i turni e le timbrature del giorno.</span>
          </div>
        ) : righe.map((r, i) => (
          <div
            key={r.userId}
            className="grid min-h-[52px] grid-cols-[32px_1fr_auto] items-center gap-2.5 border-b border-border px-3.5 py-1.5"
            style={{ animation: 'inrise 600ms cubic-bezier(0.16,1,0.3,1) both', animationDelay: `${i * 70}ms` }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[oklch(0.93_0.01_250)] text-xs font-semibold text-muted-foreground dark:bg-secondary">{iniziali(r.nome)}</span>
            <div className="flex min-w-0 flex-col gap-px">
              <span className="truncate text-[15px] font-medium">{r.nome}</span>
              <span className="font-mono text-xs text-muted-foreground">{[r.turno, r.dettaglio].filter(Boolean).join(' · ')}</span>
            </div>
            <span className={cn('whitespace-nowrap rounded-full px-[9px] py-[3px] text-[10px] font-semibold uppercase tracking-[.05em]', BADGE[r.stato])}>{r.badge}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
