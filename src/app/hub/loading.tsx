// Attesa della Home del manager con la sua forma (MTHome): riepilogo,
// quattro indicatori e le due card affiancate.
export default function Loading() {
  const b = 'skeleton-shimmer rounded-[12px]'
  return (
    <div className="flex flex-col gap-3 px-4 sm:h-full sm:gap-4 sm:px-8">
      <div className={`${b} hidden h-[76px] sm:block`} />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {[0, 1, 2, 3].map(i => <div key={i} className={`${b} h-[132px] ${i === 2 ? 'max-sm:hidden' : ''} ${i === 3 ? 'max-sm:col-span-2' : ''}`} />)}
      </div>
      <div className="grid gap-3 sm:min-h-0 sm:flex-1 sm:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] sm:gap-4">
        <div className={`${b} h-[320px] sm:h-auto`} />
        <div className={`${b} h-[52px] sm:h-auto`} />
      </div>
    </div>
  )
}
