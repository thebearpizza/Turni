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

export function AbsenceRequestDialog({ userId, restaurantId, onClose }: Props) {
  const [type, setType] = useState<AbsenceType>('ferie')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()
    await supabase.from('absences').insert({
      user_id: userId,
      restaurant_id: restaurantId,
      type,
      start_date: startDate,
      end_date: endDate,
      notes: notes || null,
      created_by: userId,
      status: 'pending',
    })
    setDone(true)
    setLoading(false)
    setTimeout(onClose, 1800)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Sheet */}
      <div
        className="relative w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-slate-600" />
        </div>

        <div className="px-5 pb-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-white text-xl font-bold">Richiedi Assenza</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white"
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
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Tipo */}
              <div>
                <label className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2 block">Tipo di assenza</label>
                <Select value={type} onValueChange={v => setType(v as AbsenceType)}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-12 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ABSENCE_LABELS) as AbsenceType[]).map(t => (
                      <SelectItem key={t} value={t}>{ABSENCE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date */}
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2 block">Dal</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    required
                    className="w-full h-12 bg-slate-800 border border-slate-700 rounded-xl px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2 block">Al</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    required
                    min={startDate}
                    className="w-full h-12 bg-slate-800 border border-slate-700 rounded-xl px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 [color-scheme:dark]"
                  />
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="text-slate-400 text-xs font-medium uppercase tracking-wide mb-2 block">Note <span className="normal-case text-slate-500">(opzionale)</span></label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Aggiungi una nota..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-3 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !startDate || !endDate}
                className="w-full h-14 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-semibold text-base transition-all active:scale-95"
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
