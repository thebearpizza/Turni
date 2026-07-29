import { Skeleton } from '@/components/ui/skeleton'

// Questa pagina fa solo un controllo auth/ruolo e reindirizza (a /login,
// /hub, /dashboard, /home o /cassa a seconda del ruolo) — nessun layout
// proprio da rispecchiare, solo un segnale che qualcosa sta caricando.
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-3">
        <Skeleton className="h-3 w-24 mx-auto" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  )
}
