// Avviso dell'account in attesa, con la forma delle strisce del guscio
// (card sotto l'intestazione, come "Attiva le notifiche" del design).
export function DemoBanner() {
  return (
    <div className="relative z-[2] mx-4 mb-2.5 flex flex-none items-center gap-3 rounded-[12px] border border-border bg-card py-2.5 pl-3.5 pr-2.5 shadow-[0_4px_20px_rgba(20,30,50,.06)] sm:mx-8">
      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-warn-tint text-warn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4l9 16H3z" /><path d="M12 10v4" /><path d="M12 17.5v.5" /></svg>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-sm font-semibold">Account in attesa di approvazione</span>
        <span className="text-[12.5px] text-muted-foreground text-pretty">Stai esplorando una demo: alcune funzioni restano disattivate finché il servizio non è attivo.</span>
      </div>
    </div>
  )
}
