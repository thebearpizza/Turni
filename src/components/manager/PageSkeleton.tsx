interface Props {
  rows?: number
  // Alcune pagine (Approvazioni, Report) non hanno un pulsante di azione
  // né una barra filtri sotto il titolo — di default entrambi sono
  // presenti perché è il caso più comune tra le pagine manager.
  hasAction?: boolean
  hasFilters?: boolean
}

export function PageSkeleton({ rows = 6, hasAction = true, hasFilters = true }: Props) {
  return (
    <div className="p-6 lg:p-8 space-y-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-36 bg-muted rounded" />
          <div className="h-3.5 w-24 bg-muted rounded" />
        </div>
        {hasAction && <div className="h-9 w-24 bg-muted rounded" />}
      </div>
      {hasFilters && <div className="h-9 w-56 bg-muted rounded" />}
      <div className="border rounded-md overflow-hidden">
        <div className="h-10 bg-muted/60 border-b" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-12 border-b last:border-0 bg-background flex items-center px-4 gap-4">
            <div className="h-3.5 w-1/4 bg-muted rounded" />
            <div className="h-3.5 w-1/5 bg-muted rounded" />
            <div className="h-3.5 w-1/6 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
