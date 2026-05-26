export default function Loading() {
  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header: date + name + restaurant — right side: bacheca + logout */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="space-y-1.5">
          <div className="h-3 w-40 bg-muted rounded animate-pulse" />
          <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          <div className="h-3 w-24 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-md bg-muted animate-pulse" />
          <div className="w-10 h-10 rounded-md bg-muted animate-pulse" />
        </div>
      </div>

      {/* Center: clock + primary QR button + absence link */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
        <div className="h-16 w-64 bg-muted rounded-md animate-pulse" />
        <div className="w-full max-w-xs h-14 rounded-md bg-muted animate-pulse" />
        <div className="h-4 w-36 bg-muted rounded animate-pulse" />
      </div>
    </main>
  )
}
