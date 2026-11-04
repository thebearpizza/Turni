import { ScheletroForma } from '@/components/shared/ScheletroForma'

// Scheletro a forma di contenuto (Skeleton.dc.html): sotto c'è una sagoma
// della Home (ora, pulsante, Prossimi turni) che ScheletroForma misura e
// ridisegna con l'onda. I trattini fanno da segnaposto per i valori.
export default function Loading() {
  return (
    <div data-sk-root="" data-sk-on="1" className="relative mx-auto flex w-full max-w-[560px] flex-col pb-6">
      <div className="flex flex-col items-center gap-1.5 px-5 pt-8">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[1px] text-muted-foreground">———————————</span>
        <span className="font-mono text-[64px] font-medium leading-none tracking-[-2px]">——:——</span>
        <span className="text-[15px] text-muted-foreground">————————————————</span>
      </div>
      <div className="flex flex-col gap-2.5 px-4 pt-7">
        <div className="h-16 rounded-[8px] bg-primary" />
        <span className="text-center text-xs text-muted-foreground">——————————————</span>
      </div>
      <div className="mx-4 mt-6 rounded-[14px] border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
          <span className="text-[15px] font-semibold">Prossimi turni</span>
          <span className="text-[13px] font-medium text-muted-foreground">Tutti →</span>
        </div>
        {[0, 1, 2].map(i => (
          <div key={i} className="grid min-h-12 grid-cols-[72px_1fr_auto] items-center gap-2 border-b border-border px-3.5">
            <span className="font-mono text-[13px] text-muted-foreground">———</span>
            <span className="font-mono text-[15px]">——————</span>
            <span className="text-xs text-muted-foreground">———</span>
          </div>
        ))}
        <div className="flex h-12 items-center px-3.5 text-sm font-medium text-muted-foreground">Richiedi assenza</div>
      </div>
      <ScheletroForma esce={false} />
    </div>
  )
}
