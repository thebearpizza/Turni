import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <main className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-3 border-b border-border">
        <Skeleton className="w-5 h-5 rounded shrink-0" />
        <div className="space-y-1">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>

      <div className="px-4 pt-4 space-y-6">
        {/* Filter pills */}
        <div className="flex gap-1.5 flex-wrap">
          {[72, 88, 96, 80, 104].map((w, i) => (
            <Skeleton key={i} className="h-7 rounded-sm" style={{ width: w }} />
          ))}
        </div>

        {/* Task rows */}
        <div className="space-y-1.5">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-11 rounded-sm" />
          ))}
        </div>
      </div>
    </main>
  )
}
