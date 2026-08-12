'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { LoadingDots } from '@/components/shared/LoadingDots'
import { CheckCircle2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Absence, AbsenceType, AbsenceStatus } from '@/types'
import { ABSENCE_LABELS } from '@/types'

interface Props {
  userId: string
  restaurantId: string | null
  onClose: () => void
}

const labelCls = 'text-muted-foreground text-xs font-medium uppercase tracking-wide mb-2 block'

const statusLabels: Record<AbsenceStatus, string> = {
  pending: 'In attesa',
  approved: 'Approvata',
  rejected: 'Rifiutata',
}

const statusBadgeClass: Record<AbsenceStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400',
}

/* Dipendenti non possono inserire "Assenza Ingiustificata" — solo il manager la assegna */
const DIPENDENTE_TYPES: AbsenceType[] = ['ferie', 'malattia', 'riposo']

export function AbsenceRequestDialog({ userId, restaurantId, onClose }: Props) {
  const [type, setType] = useState<AbsenceType>('ferie')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [myAbsences, setMyAbsences] = useState<Absence[]>([])

  const loadMyAbsences = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('absences')
      .select('*')
      .eq('user_id', userId)
      .order('start_date', { ascending: false })
      .limit(5)
    if (data) setMyAbsences(data as Absence[])
  }, [userId])

  useEffect(() => { loadMyAbsences() }, [loadMyAbsences])

  // Realtime — se il manager approva/rifiuta mentre il dipendente ha il
  // pannello aperto, il badge di stato si aggiorna senza dover riaprire.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('rt-my-absences')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'absences', filter: `user_id=eq.${userId}` },
        () => { loadMyAbsences() }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, loadMyAbsences])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: insertError } = await supabase.from('absences').insert({
      user_id: userId,
      restaurant_id: restaurantId,
      type,
      start_date: startDate,
      end_date: endDate,
      notes: notes || null,
      created_by: userId,
      status: 'pending',
    })
    if (insertError) {
      setError('Errore durante l\'invio. Riprova.')
      setLoading(false)
      return
    }
    setDone(true)
    setLoading(false)
    setTimeout(onClose, 1800)
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="top-auto bottom-0 left-1/2 translate-x-[-50%] translate-y-0 max-w-lg w-full max-h-[90vh] overflow-y-auto rounded-t-md rounded-b-none sm:rounded-lg data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom">
        <DialogHeader>
          <DialogTitle>Richiedi Assenza</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="py-8 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 dark:text-emerald-400" />
            <p className="text-foreground font-semibold text-lg">Richiesta inviata!</p>
            <p className="text-muted-foreground text-sm">Il manager riceverà la tua richiesta</p>
          </div>
        ) : (
          <>
            {myAbsences.length > 0 && (
              <div className="space-y-1.5">
                <p className={labelCls}>Le mie richieste recenti</p>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {myAbsences.map(a => (
                    <div key={a.id} className="flex items-center justify-between gap-2 text-xs bg-muted/40 border border-border rounded-sm px-2.5 py-1.5">
                      <span className="text-foreground">
                        {ABSENCE_LABELS[a.type]} · {formatDate(a.start_date)} → {formatDate(a.end_date)}
                      </span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded-full font-medium ${statusBadgeClass[a.status]}`}>
                        {statusLabels[a.status]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Tipo */}
              <div>
                <label className={labelCls}>Tipo di assenza</label>
                <Select value={type} onValueChange={v => setType(v as AbsenceType)}>
                  <SelectTrigger className="h-10 rounded-md bg-background border-input text-foreground focus:ring-1 focus:ring-ring">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIPENDENTE_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{ABSENCE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Dal */}
              <div>
                <label className={labelCls}>Dal</label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  required
                  className="h-10"
                />
              </div>

              {/* Al */}
              <div>
                <label className={labelCls}>Al</label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  required
                  min={startDate}
                  className="h-10"
                />
              </div>

              {/* Note */}
              <div>
                <label className={labelCls}>
                  Note <span className="normal-case text-muted-foreground/70">(opzionale)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Aggiungi una nota..."
                  className="w-full bg-background border border-input rounded-md px-3 py-2.5 text-foreground text-base placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring resize-none transition-colors"
                />
              </div>

              {error && (
                <p className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2.5">
                  {error}
                </p>
              )}

              <DialogFooter>
                <Button
                  type="submit"
                  disabled={loading || !startDate || !endDate}
                  className="w-full h-14 text-base font-semibold active:scale-[0.98]"
                >
                  {loading ? <>Invio in corso<LoadingDots /></> : 'Invia Richiesta'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
