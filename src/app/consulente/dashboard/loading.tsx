import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="min-h-[100dvh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-border">
        <Skeleton className="h-4 w-40" />
        <div className="flex items-center gap-2">
          <Skeleton className="w-8 h-8 rounded-md" />
          <Skeleton className="h-4 w-12" />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-4 px-4 border-b border-border py-3">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-24" />
      </div>

      {/* Contenuto */}
      <div className="p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
    </div>
  )
}
