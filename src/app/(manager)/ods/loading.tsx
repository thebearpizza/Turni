import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <div className="flex gap-2 mb-5 flex-wrap">
        {[96, 80, 88, 104, 80].map((w, i) => (
          <Skeleton key={i} className="h-7 rounded-sm" style={{ width: w }} />
        ))}
      </div>
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-sm" />
        ))}
      </div>
    </div>
  )
}
