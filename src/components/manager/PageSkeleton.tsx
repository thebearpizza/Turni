import { ScheletroForma } from '@/components/shared/ScheletroForma'

// Caricamento delle pagine (loading.tsx): lo scheletro a forma del design
// (Skeleton.dc.html). Non c'è ancora contenuto da misurare, quindi
// ScheletroForma disegna la sua forma di riserva: pillole, una card con
// intestazione e righe, con l'onda.
export function PageSkeleton() {
  return (
    <div data-sk-root="" className="relative h-full min-h-[60dvh]">
      <ScheletroForma esce={false} />
    </div>
  )
}
