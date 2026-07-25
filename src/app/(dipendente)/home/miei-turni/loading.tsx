import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <main className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-5 pb-3 border-b border-border">
        <Skeleton className="w-5 h-5 rounded shrink-0" />
        <Skeleton className="h-4 w-32" />
      </div>

      <div className="px-4 pt-4 space-y-2.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="border rounded-md p-3 flex items-center justify-between">
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </main>
  )
}
