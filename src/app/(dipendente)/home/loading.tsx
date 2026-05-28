import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <main className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="w-9 h-9 rounded-md" />
          <Skeleton className="w-9 h-9 rounded-md" />
          <Skeleton className="w-9 h-9 rounded-md" />
        </div>
      </div>

      {/* Center: clock + button + link */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
        <Skeleton className="h-16 w-64 rounded-md" />
        <Skeleton className="w-full max-w-xs h-14 rounded-md" />
        <Skeleton className="h-4 w-36 rounded" />
      </div>
    </main>
  )
}
