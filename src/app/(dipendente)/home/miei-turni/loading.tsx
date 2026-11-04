import { ScheletroForma } from '@/components/shared/ScheletroForma'

// Scheletro a forma di contenuto: sagoma di "I miei turni" (titolo,
// intestazione della settimana, sei righe) ridisegnata da ScheletroForma.
export default function Loading() {
  return (
    <div data-sk-root="" data-sk-on="1" className="relative mx-auto flex w-full max-w-[560px] flex-col pb-6">
      <div className="px-5 pb-3 pt-2">
        <span className="text-[28px] font-semibold tracking-[-0.8px]">I miei turni</span>
      </div>
      <div className="flex flex-col gap-2 px-4">
        <div className="flex justify-between px-1 pt-1 font-mono text-[11px] font-medium uppercase tracking-[1px] text-muted-foreground">
          <span>Questa settimana</span><span>——</span>
        </div>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-[8px] border border-border bg-card px-3.5 py-3">
            <div className="flex flex-col items-center">
              <span className="font-mono text-[11px] text-muted-foreground">———</span>
              <span className="font-mono text-xl font-semibold">——</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[15px]">———————————</span>
              <span className="text-xs text-muted-foreground">——————</span>
            </div>
            <span className="text-[10px]">————</span>
          </div>
        ))}
      </div>
      <ScheletroForma esce={false} />
    </div>
  )
}
