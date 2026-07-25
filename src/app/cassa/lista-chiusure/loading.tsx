import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Filtri: ristoranti + mese */}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-32 rounded-full ml-auto" />
      </div>

      {/* Righe chiusure */}
      <div className="border rounded-md overflow-hidden">
        <div className="h-10 bg-muted/60 border-b" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 border-b last:border-0 flex items-center px-4 gap-4">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 w-16 ml-auto" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}
