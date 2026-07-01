'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TimeInput } from '@/components/ui/time-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Plus, UserCheck } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'

const TZ = 'Europe/Rome'

export type PresenzaPreviewRow = {
  id:        string
  user_id:   string
  check_in:  string
  check_out: string | null
  profile?:  { id: string; full_name: string } | null
}

interface Props {
  initialRows: PresenzaPreviewRow[]
  dipendenti:  { id: string; full_name: string }[]
  isDirettore: boolean
}

export function PresenzePreviewClient({ initialRows, dipendenti, isDirettore }: Props) {
  const [rows, setRows] = useState<PresenzaPreviewRow[]>(initialRows)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<PresenzaPreviewRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [fUserId, setFUserId] = useState('')
  const [fDate, setFDate] = useState(formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'))
  const [fCheckIn, setFCheckIn] = useState('')
  const [fCheckOut, setFCheckOut] = useState('')

  function resetForm() {
    setEditing(null)
    setFUserId('')
    setFDate(formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'))
    setFCheckIn('')
    setFCheckOut('')
    setError(null)
  }

  function openCreate() {
    resetForm()
    setShowForm(true)
  }

  function openEdit(row: PresenzaPreviewRow) {
    if (!isDirettore) return
    setEditing(row)
    setFUserId(row.user_id)
    setFDate(formatInTimeZone(row.check_in, TZ, 'yyyy-MM-dd'))
    setFCheckIn(formatInTimeZone(row.check_in, TZ, 'HH:mm'))
    setFCheckOut(row.check_out ? formatInTimeZone(row.check_out, TZ, 'HH:mm') : '')
    setError(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!fUserId || !fDate || !fCheckIn) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/presenze', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editing
            ? { id: editing.id, date: fDate, checkIn: fCheckIn, checkOut: fCheckOut || null }
            : { userId: fUserId, date: fDate, checkIn: fCheckIn, checkOut: fCheckOut || null }
        ),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Errore sconosciuto')

      const saved = json.attendance as PresenzaPreviewRow
      setRows(prev => editing
        ? prev.map(r => r.id === saved.id ? saved : r)
        : [...prev, saved]
      )
      resetForm()
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore sconosciuto')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-6 bg-card border border-border rounded-md p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-muted-foreground" />
          Presenze di Oggi
        </h2>
        {isDirettore && (
          <Button size="sm" variant="outline" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Aggiungi
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">Nessuna presenza registrata oggi</p>
      ) : (
        <div className={`space-y-1.5 ${isDirettore ? '' : 'pointer-events-none select-none'}`}>
          {rows.map(row => (
            <div
              key={row.id}
              onClick={() => openEdit(row)}
              className={`flex items-center justify-between px-3 py-2 rounded-sm border border-border bg-background ${
                isDirettore ? 'cursor-pointer hover:bg-accent transition-colors' : ''
              }`}
            >
              <span className="text-sm font-medium text-foreground">{row.profile?.full_name ?? '—'}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Entrata {formatInTimeZone(row.check_in, TZ, 'HH:mm')}
                </span>
                {row.check_out ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 h-auto rounded-sm">
                    Uscito
                  </Badge>
                ) : (
                  <Badge className="text-[10px] px-1.5 py-0.5 h-auto rounded-sm bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800">
                    In corso
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Add / edit dialog — direttore only ─────────────────────── */}
      {isDirettore && (
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? 'Modifica Presenza' : 'Aggiungi Presenza'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Dipendente *</Label>
                <Select value={fUserId} onValueChange={setFUserId} disabled={!!editing}>
                  <SelectTrigger><SelectValue placeholder="Seleziona dipendente" /></SelectTrigger>
                  <SelectContent>
                    {dipendenti.map(d => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Data *</Label>
                <Input type="date" value={fDate} onChange={e => setFDate(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Ora ingresso *</Label>
                  <TimeInput value={fCheckIn} onChange={setFCheckIn} />
                </div>
                <div className="space-y-2">
                  <Label>Ora uscita</Label>
                  <TimeInput value={fCheckOut} onChange={setFCheckOut} />
                </div>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
              <Button onClick={handleSave} disabled={saving || !fUserId || !fDate || !fCheckIn}>
                {saving ? 'Salvataggio...' : editing ? 'Salva modifiche' : 'Aggiungi'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
