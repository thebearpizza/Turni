import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="border rounded-lg p-5">
        <Skeleton className="h-9 w-full sm:w-64" />
      </div>

      <div className="border rounded-lg divide-y">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3 p-4">
            <div className="space-y-1.5 min-w-0">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}
