import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getPendingAccounts, approveAccount, rejectAccount } from '@/app/actions/adminActions'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'
import { it } from 'date-fns/locale'
import { UserCheck, UserX, Clock } from 'lucide-react'

export default async function AccountPendentiPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, managed_restaurant_ids')
    .eq('id', user!.id)
    .single()

  // Solo il platform owner può accedere a questa pagina
  if (profile?.role !== 'manager' || profile.managed_restaurant_ids !== null) {
    redirect('/dashboard')
  }

  const pending = await getPendingAccounts()

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Account Pendenti</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestisci le richieste di accesso a inTurno.
        </p>
      </div>

      {pending.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <UserCheck className="w-10 h-10 opacity-30" />
          <p className="text-sm">Nessuna richiesta in attesa.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map(account => (
            <div
              key={account.id}
              className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-sm font-semibold text-amber-700 dark:text-amber-400 shrink-0">
                {account.full_name[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{account.full_name}</p>
                <p className="text-xs text-muted-foreground truncate">{account.username}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(account.created_at), { addSuffix: true, locale: it })}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <form action={approveAccount.bind(null, account.id)}>
                  <Button type="submit" size="sm" className="gap-1.5">
                    <UserCheck className="w-3.5 h-3.5" />
                    Approva
                  </Button>
                </form>
                <form action={rejectAccount.bind(null, account.id)}>
                  <Button type="submit" size="sm" variant="outline" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5">
                    <UserX className="w-3.5 h-3.5" />
                    Rifiuta
                  </Button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
