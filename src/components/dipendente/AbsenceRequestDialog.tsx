'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { X, CheckCircle2 } from 'lucide-react'
import type { AbsenceType } from '@/types'
import { ABSENCE_LABELS } from '@/types'

interface Props {
  userId: string
  restaurantId: string | null
  onClose: () => void
}

/* Classe condivisa per tutti i form field single-line — simmetria assoluta h-10
 * NB: `appearance-none` + `box-border` + `min-w-0` sono necessari per evitare che
 * <input type="date"> erediti la larghezza intrinseca del placeholder iOS Safari
 * e sbordi rispetto al contenitore. */
const fieldCls =
  'block w-full min-w-0 h-10 box-border appearance-none bg-background border border-input rounded-md px-3 text-foreground text-sm ' +
  'focus:outline-none focus:ring-1 focus:ring-ring transition-colors'

const labelCls = 'text-muted-foreground text-xs font-medium uppercase tracking-wide mb-2 block'

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
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-lg bg-card border-t border-border rounded-t-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        <div className="px-5 pb-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-foreground text-lg font-semibold tracking-tight">Richiedi Assenza</h2>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-md bg-card border border-border flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {done ? (
            <div className="py-8 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 dark:text-emerald-400" />
              <p className="text-foreground font-semibold text-lg">Richiesta inviata!</p>
              <p className="text-muted-foreground text-sm">Il manager riceverà la tua richiesta</p>
            </div>
          ) : (
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
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  required
                  className={fieldCls}
                />
              </div>

              {/* Al */}
              <div>
                <label className={labelCls}>Al</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  required
                  min={startDate}
                  className={fieldCls}
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
                  className="w-full bg-background border border-input rounded-md px-3 py-2.5 text-foreground text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring resize-none transition-colors"
                />
              </div>

              {error && (
                <p className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2.5">
                  {error}
                </p>
              )}

              {/* Submit — touch target h-14 mobile */}
              <button
                type="submit"
                disabled={loading || !startDate || !endDate}
                className="w-full h-14 rounded-md bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-semibold text-base transition-colors active:scale-[0.98]"
              >
                {loading ? 'Invio in corso...' : 'Invia Richiesta'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
