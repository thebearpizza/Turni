import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Filtri: ristoranti + periodo */}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-32 rounded-full ml-auto" />
      </div>

      {/* Tile riepilogo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border rounded-md p-3 space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>

      {/* Tabella */}
      <div className="border rounded-md overflow-hidden">
        <div className="h-10 bg-muted/60 border-b" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 border-b last:border-0 flex items-center px-4 gap-4">
            <Skeleton className="h-3.5 w-1/4" />
            <Skeleton className="h-3.5 w-1/5" />
            <Skeleton className="h-3.5 w-1/6" />
          </div>
        ))}
      </div>
    </div>
  )
}
