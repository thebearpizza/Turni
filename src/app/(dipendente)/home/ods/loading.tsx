import { ScheletroForma } from '@/components/shared/ScheletroForma'

// Scheletro a forma di contenuto: sagoma degli Ordini di servizio
// (titolo, barra di avanzamento, filtri, righe) ridisegnata da ScheletroForma.
export default function Loading() {
  return (
    <div data-sk-root="" data-sk-on="1" className="relative mx-auto flex w-full max-w-[560px] flex-col pb-6">
      <div className="flex flex-col gap-3 px-5 pb-3.5 pt-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[28px] font-semibold tracking-[-0.8px]">Ordini di servizio</span>
          <span className="font-mono text-sm text-muted-foreground">—/—</span>
        </div>
        <div className="h-1 rounded-full bg-border" />
        <div className="flex gap-1.5">
          {['Tutti', 'Per me', 'Reparto'].map(l => (
            <span key={l} className="flex h-9 items-center rounded-full border border-line-strong px-3.5 text-[13px] font-medium">{l}</span>
          ))}
        </div>
      </div>
      <div className="mx-4 flex flex-col gap-1.5">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex min-h-[60px] items-center gap-3 rounded-[8px] border border-border bg-card px-3.5 py-2">
            <span className="h-[26px] w-[26px] flex-none rounded-[12px] border-[1.5px] border-line-strong" />
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-medium">——————————————</span>
              <span className="text-xs text-muted-foreground">————————</span>
            </span>
          </div>
        ))}
      </div>
      <ScheletroForma esce={false} />
    </div>
  )
}
