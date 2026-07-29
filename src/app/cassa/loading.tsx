import { Skeleton } from '@/components/ui/skeleton'

// Landing di Cassa: solo un controllo ruolo e reindirizzo (analisi per il
// manager, chiusura per il cassiere) — nessun layout proprio da rispecchiare.
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-3">
        <Skeleton className="h-3 w-24 mx-auto" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  )
}
