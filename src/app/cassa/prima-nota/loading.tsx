import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="p-6 lg:p-8 space-y-2">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-4 w-56" />
    </div>
  )
}
