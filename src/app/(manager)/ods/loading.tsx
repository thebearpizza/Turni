export default function Loading() {
  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="h-7 w-40 bg-muted rounded animate-pulse" />
        <div className="h-8 w-28 bg-muted rounded animate-pulse" />
      </div>
      <div className="flex gap-2 mb-5">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-7 w-20 bg-muted rounded animate-pulse" />
        ))}
      </div>
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-muted rounded animate-pulse" />
        ))}
      </div>
    </div>
  )
}
