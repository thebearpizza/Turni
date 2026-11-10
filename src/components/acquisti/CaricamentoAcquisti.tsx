// Sagoma di una sezione di Acquisti mentre la pagina arriva dal server
// (barra in alto, elenco e pannello di dettaglio), con l'onda del design.
export function CaricamentoAcquisti() {
  return (
    <div className="box-border flex h-full flex-col gap-3 px-4 sm:px-8" aria-hidden>
      <div className="flex flex-none gap-1.5">
        {[64, 92, 108, 96].map(w => <div key={w} className="skeleton-shimmer h-10 rounded-full" style={{ width: w }} />)}
      </div>
      <div className="grid min-h-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-border bg-card">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4">
              <div className="flex flex-col gap-1.5"><div className="skeleton-shimmer h-2.5 w-40 rounded" /><div className="skeleton-shimmer h-2 w-24 rounded" /></div>
              <div className="skeleton-shimmer h-7 w-[72px] rounded-[8px]" />
            </div>
          ))}
        </div>
        <div className="hidden rounded-[12px] border border-border bg-card sm:block" />
      </div>
    </div>
  )
}
