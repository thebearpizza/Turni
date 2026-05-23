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

/* Classe condivisa per tutti i form field single-line — simmetria assoluta */
const fieldCls =
  'w-full h-10 bg-slate-800 border border-slate-700 rounded-md px-3 text-white text-sm ' +
  'focus:outline-none focus:ring-1 focus:ring-slate-500 transition-colors'

const labelCls = 'text-slate-400 text-xs font-medium uppercase tracking-wide mb-2 block'

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
        className="relative w-full max-w-lg bg-slate-900 rounded-t-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        <div className="px-5 pb-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-white text-lg font-semibold tracking-tight">Richiedi Assenza</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {done ? (
            <div className="py-8 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400" />
              <p className="text-white font-semibold text-lg">Richiesta inviata!</p>
              <p className="text-slate-400 text-sm">Il manager riceverà la tua richiesta</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Tipo */}
              <div>
                <label className={labelCls}>Tipo di assenza</label>
                <Select value={type} onValueChange={v => setType(v as AbsenceType)}>
                  <SelectTrigger className="h-10 rounded-md bg-slate-800 border-slate-700 text-white focus:ring-1 focus:ring-slate-500">
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
                  className={`${fieldCls} [color-scheme:dark]`}
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
                  className={`${fieldCls} [color-scheme:dark]`}
                />
              </div>

              {/* Note */}
              <div>
                <label className={labelCls}>
                  Note <span className="normal-case text-slate-600">(opzionale)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Aggiungi una nota..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2.5 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-500 resize-none transition-colors"
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2.5">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !startDate || !endDate}
                className="w-full h-14 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-semibold text-base transition-colors active:scale-[0.98]"
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
