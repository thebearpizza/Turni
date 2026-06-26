'use client'

import { useState, useTransition } from 'react'
import { approveAccount, rejectAccount } from '@/app/actions/adminActions'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'
import { it } from 'date-fns/locale'
import { UserCheck, UserX, Clock, Loader2 } from 'lucide-react'

interface PendingAccount {
  id: string
  full_name: string
  username: string | null
  created_at: string
}

export function AccountPendentiClient({ initialAccounts }: { initialAccounts: PendingAccount[] }) {
  const [accounts, setAccounts] = useState(initialAccounts)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [action, setAction] = useState<'approve' | 'reject' | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleApprove(id: string) {
    setLoadingId(id)
    setAction('approve')
    startTransition(async () => {
      try {
        await approveAccount(id)
        setAccounts(prev => prev.filter(a => a.id !== id))
      } catch {
        // action failed — keep card visible
      } finally {
        setLoadingId(null)
        setAction(null)
      }
    })
  }

  function handleReject(id: string) {
    setLoadingId(id)
    setAction('reject')
    startTransition(async () => {
      try {
        await rejectAccount(id)
        setAccounts(prev => prev.filter(a => a.id !== id))
      } catch {
        // action failed — keep card visible
      } finally {
        setLoadingId(null)
        setAction(null)
      }
    })
  }

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
        <UserCheck className="w-10 h-10 opacity-30" />
        <p className="text-sm">Nessuna richiesta in attesa.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {accounts.map(account => {
        const isLoading = isPending && loadingId === account.id
        return (
          <div
            key={account.id}
            className={`flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-opacity ${isLoading ? 'opacity-60' : ''}`}
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
              <Button
                size="sm"
                className="gap-1.5"
                disabled={isLoading}
                onClick={() => handleApprove(account.id)}
              >
                {isLoading && action === 'approve'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <UserCheck className="w-3.5 h-3.5" />
                }
                Approva
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5"
                disabled={isLoading}
                onClick={() => handleReject(account.id)}
              >
                {isLoading && action === 'reject'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <UserX className="w-3.5 h-3.5" />
                }
                Rifiuta
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
