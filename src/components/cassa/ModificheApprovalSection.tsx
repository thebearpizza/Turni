'use client'
import { useState } from 'react'
import { ShieldAlert, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'

const TZ = 'Europe/Rome'

const FIELD_LABELS: Record<string, string> = {
  fondo_cassa_iniziale: 'Fondo Cassa Iniziale',
  entrate_contanti: 'Entrate Contanti',
  entrate_pos: 'Entrate POS',
  entrate_bonifico: 'Entrate Bonifico',
  coperti: 'Coperti',
  incasso_asporto: 'Incasso Asporto',
  fondo_cassa_finale: 'Fondo Cassa Finale',
  contanti_per_banca: 'Contanti per Banca',
}

export interface PendingModifica {
  id: string
  chiusura_id: string
  payload: Record<string, number>
  created_at: string
  chiusura: { data: string; restaurant: { name: string } | null } | null
  richiedente: { full_name: string } | null
}

interface Props {
  initialPending: PendingModifica[]
}

export function ModificheApprovalSection({ initialPending }: Props) {
  const [pending, setPending] = useState(initialPending)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function handleAction(modificaId: string, action: 'approve' | 'reject') {
    setLoadingId(modificaId)
    const res = await fetch('/api/cassa/modifica-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modificaId, action }),
    })
    if (res.ok) {
      setPending(prev => prev.filter(p => p.id !== modificaId))
    }
    setLoadingId(null)
  }

  if (pending.length === 0) {
    return <p className="text-sm text-muted-foreground">Nessuna richiesta in attesa.</p>
  }

  return (
    <div className="border border-amber-200 dark:border-amber-800 rounded-md overflow-hidden">
      <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 border-b border-amber-200 dark:border-amber-800">
        <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          Modifiche in attesa di approvazione ({pending.length})
        </h2>
      </div>

      <div className="divide-y divide-border">
        {pending.map(item => {
          const isWorking = loadingId === item.id
          const requestedAt = formatInTimeZone(new Date(item.created_at), TZ, "dd/MM/yyyy HH:mm", { locale: it })

          return (
            <div key={item.id} className="flex flex-col gap-3 px-4 py-4 bg-background">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {item.chiusura?.restaurant?.name ?? '—'} · {item.chiusura?.data ?? '—'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Richiesta da {item.richiedente?.full_name ?? '—'} il {requestedAt}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-8 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm"
                    onClick={() => handleAction(item.id, 'approve')}
                    disabled={isWorking}
                  >
                    <Check className="w-3.5 h-3.5 mr-1" />
                    Approva
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8 px-3 text-xs rounded-sm"
                    onClick={() => handleAction(item.id, 'reject')}
                    disabled={isWorking}
                  >
                    <X className="w-3.5 h-3.5 mr-1" />
                    Rifiuta
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {Object.entries(item.payload).map(([key, value]) => (
                  <div key={key} className="rounded-md border border-border px-2 py-1.5">
                    <p className="text-muted-foreground">{FIELD_LABELS[key] ?? key}</p>
                    <p className="font-medium tabular-nums">
                      {key === 'coperti' ? value : `€ ${Number(value).toFixed(2)}`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
