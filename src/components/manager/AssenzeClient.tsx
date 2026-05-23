'use client'
import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import type { Absence, Restaurant, AbsenceType, AbsenceStatus } from '@/types'
import { ABSENCE_LABELS } from '@/types'

const TZ = 'Europe/Rome'

const typeBadgeClass: Record<AbsenceType, string> = {
  ferie: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  malattia: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  riposo: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  assenza_ingiustificata: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
}

const statusBadgeClass: Record<AbsenceStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400',
}

const statusLabels: Record<AbsenceStatus, string> = {
  pending: 'In attesa',
  approved: 'Approvata',
  rejected: 'Rifiutata',
}

interface DipProfile { id: string; full_name: string; restaurant_id: string | null }

interface Props {
  initialAbsences: (Absence & {
    profile?: { id: string; full_name: string } | null
    restaurant?: { id: string; name: string } | null
  })[]
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
  dipendenti: DipProfile[]
  currentUserRole: string
  currentRestaurantId: string | null
}

export function AssenzeClient({ initialAbsences, restaurants, dipendenti, currentUserRole, currentRestaurantId }: Props) {
  const [absences, setAbsences] = useState(initialAbsences)
  const [selectedMonth, setSelectedMonth] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM'))
  const [selectedRestaurant, setSelectedRestaurant] = useState(currentRestaurantId ?? 'all')
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<typeof initialAbsences[0] | null>(null)

  // Form state
  const [userId, setUserId] = useState('')
  const [type, setType] = useState<AbsenceType>('ferie')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [certCode, setCertCode] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const loadAbsences = useCallback(async (month: string, restaurantId: string) => {
    setLoading(true)
    const [year, m] = month.split('-').map(Number)
    const start = new Date(Date.UTC(year, m - 1, 1)).toISOString().split('T')[0]
    const end = new Date(Date.UTC(year, m, 0)).toISOString().split('T')[0]

    const supabase = createClient()
    let query = supabase
      .from('absences')
      .select('*, profile:profiles!user_id(id, full_name), restaurant:restaurants(id, name)')
      .lte('start_date', end)
      .gte('end_date', start)
      .order('start_date', { ascending: false })

    if (restaurantId !== 'all') query = query.eq('restaurant_id', restaurantId)

    const { data, error } = await query
    if (error) console.error('[assenze] loadAbsences error:', error.message)
    setAbsences(data ?? [])
    setLoading(false)
  }, [])

  function openCreate() {
    setEditing(null)
    setUserId('')
    setType('ferie')
    setStartDate('')
    setEndDate('')
    setCertCode('')
    setNotes('')
    setShowForm(true)
  }

  function openEdit(a: typeof initialAbsences[0]) {
    setEditing(a)
    setUserId(a.user_id)
    setType(a.type)
    setStartDate(a.start_date)
    setEndDate(a.end_date)
    setCertCode(a.certificate_code ?? '')
    setNotes(a.notes ?? '')
    setShowForm(true)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    const supabase = createClient()

    const selectedDip = dipendenti.find(d => d.id === userId)
    const restaurantId = selectedDip?.restaurant_id ?? null

    if (editing) {
      const { data, error } = await supabase
        .from('absences')
        .update({
          type, start_date: startDate, end_date: endDate,
          certificate_code: type === 'malattia' ? certCode || null : null,
          notes: notes || null,
        })
        .eq('id', editing.id)
        .select('*, profile:profiles!user_id(id, full_name), restaurant:restaurants(id, name)')
        .single()
      if (error) { setSaveError(error.message); setSaving(false); return }
      if (data) setAbsences(as => as.map(a => a.id === data.id ? data : a))
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('absences')
        .insert({
          user_id: userId, restaurant_id: restaurantId, type,
          start_date: startDate, end_date: endDate,
          certificate_code: type === 'malattia' ? certCode || null : null,
          notes: notes || null, created_by: user!.id, status: 'approved',
        })
        .select('*, profile:profiles!user_id(id, full_name), restaurant:restaurants(id, name)')
        .single()
      if (error) { setSaveError(error.message); setSaving(false); return }
      if (data) setAbsences(as => [data, ...as])
    }

    setShowForm(false)
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Eliminare questa assenza?')) return
    const supabase = createClient()
    await supabase.from('absences').delete().eq('id', id)
    setAbsences(as => as.filter(a => a.id !== id))
  }

  const isManager = currentUserRole === 'manager'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Assenze</h1>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4" /> Nuova
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <Input
          type="month"
          value={selectedMonth}
          onChange={e => { setSelectedMonth(e.target.value); loadAbsences(e.target.value, selectedRestaurant) }}
          className="w-auto"
        />
        {isManager && (
          <Select value={selectedRestaurant} onValueChange={v => { setSelectedRestaurant(v); loadAbsences(selectedMonth, v) }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Tutti i ristoranti" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i ristoranti</SelectItem>
              {restaurants.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : absences.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nessuna assenza nel periodo</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {absences.map(a => (
            <Card key={a.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-medium text-sm">{a.profile?.full_name ?? '—'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadgeClass[a.type]}`}>
                      {ABSENCE_LABELS[a.type]}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadgeClass[a.status]}`}>
                      {statusLabels[a.status]}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {a.start_date} → {a.end_date}
                    {a.certificate_code && <span className="ml-2 text-xs">Cert: {a.certificate_code}</span>}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(a)}><Pencil className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(a.id)} className="text-destructive hover:text-destructive"><Trash2 className="w-4 h-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Modifica Assenza' : 'Nuova Assenza'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!editing && (
              <div className="space-y-2">
                <Label>Dipendente *</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger><SelectValue placeholder="Seleziona dipendente" /></SelectTrigger>
                  <SelectContent>
                    {dipendenti.map(d => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Tipo *</Label>
              <Select value={type} onValueChange={v => setType(v as AbsenceType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ABSENCE_LABELS) as AbsenceType[]).map(t => (
                    <SelectItem key={t} value={t}>{ABSENCE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Dal *</Label><Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required /></div>
              <div className="space-y-2"><Label>Al *</Label><Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required /></div>
            </div>
            {type === 'malattia' && (
              <div className="space-y-2">
                <Label>Codice Certificato Medico</Label>
                <Input value={certCode} onChange={e => setCertCode(e.target.value)} placeholder="INPS-XXXX" />
              </div>
            )}
            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
            </div>
          </div>
          {saveError && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{saveError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={saving || (!editing && !userId) || !startDate || !endDate}>
              {saving ? 'Salvataggio...' : 'Salva'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
