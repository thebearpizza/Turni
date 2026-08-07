import { Skeleton } from '@/components/ui/skeleton'

// Rispecchia la struttura della tab: barra giorno/servizio, intestazione
// di sezione, poi le righe orario dell'agenda.
export default function Loading() {
  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-9 w-full rounded-lg" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  )
}
