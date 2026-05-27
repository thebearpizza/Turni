'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Check, X, CalendarX } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Absence, AbsenceType } from '@/types'
import { ABSENCE_LABELS } from '@/types'

type RequestWithRelations = Absence & {
  profile?: { id: string; full_name: string } | null
  restaurant?: { id: string; name: string } | null
}

interface Props {
  initialRequests: RequestWithRelations[]
}

const typeBadgeClass: Record<AbsenceType, string> = {
  ferie: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  malattia: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  riposo: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  assenza_ingiustificata: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
}

export function ApprovazioniClient({ initialRequests }: Props) {
  const [requests, setRequests] = useState<RequestWithRelations[]>(initialRequests)
  const [processing, setProcessing] = useState<string | null>(null)

  async function handleApprove(id: string) {
    setProcessing(id)
    const supabase = createClient()
    await supabase.from('absences').update({ status: 'approved' }).eq('id', id)
    setRequests(rs => rs.filter(r => r.id !== id))
    setProcessing(null)
  }

  async function handleReject(id: string) {
    setProcessing(id)
    const supabase = createClient()
    await supabase.from('absences').update({ status: 'rejected' }).eq('id', id)
    setRequests(rs => rs.filter(r => r.id !== id))
    setProcessing(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Approvazioni</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {requests.length} richieste in attesa
          </p>
        </div>
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center text-muted-foreground gap-3">
            <CalendarX className="w-12 h-12 opacity-30" />
            <p>Nessuna richiesta in attesa</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map(r => (
            <Card key={r.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold">{r.profile?.full_name ?? '—'}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadgeClass[r.type]}`}>
                        {ABSENCE_LABELS[r.type]}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Dal {formatDate(r.start_date)} al {formatDate(r.end_date)}
                    </p>
                    {r.restaurant && (
                      <p className="text-xs text-muted-foreground mt-0.5">{r.restaurant.name}</p>
                    )}
                    {r.notes && (
                      <p className="text-sm mt-2 text-foreground/80 bg-muted rounded px-3 py-2">{r.notes}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => handleApprove(r.id)}
                      disabled={processing === r.id}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleReject(r.id)}
                      disabled={processing === r.id}
                      className="text-destructive hover:text-destructive border-destructive/30 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300 dark:border-red-500/30"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
