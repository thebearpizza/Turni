export default function Loading() {
  return (
    <main className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-5 pb-3 border-b border-border">
        <div className="w-5 h-5 bg-muted rounded animate-pulse shrink-0" />
        <div className="space-y-1">
          <div className="h-4 w-36 bg-muted rounded animate-pulse" />
          <div className="h-3 w-20 bg-muted rounded animate-pulse" />
        </div>
      </div>

      <div className="px-4 pt-4 space-y-6">
        <div className="flex gap-1.5 flex-wrap">
          {[72, 88, 96, 80, 104].map((w, i) => (
            <div key={i} className="h-7 bg-muted rounded-sm animate-pulse" style={{ width: w }} />
          ))}
        </div>

        <div className="space-y-1.5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-11 bg-muted rounded-sm animate-pulse" />
          ))}
        </div>
      </div>
    </main>
  )
}
