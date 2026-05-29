'use client'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Clock, Trash2, AlertTriangle, Plus } from 'lucide-react'
import { LoadingDots } from '@/components/shared/LoadingDots'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { differenceInMinutes } from 'date-fns'
import { it } from 'date-fns/locale'
import { LiveShiftCounter } from './LiveShiftCounter'
import type { Attendance, Restaurant, AbsenceType } from '@/types'
import { ABSENCE_LABELS } from '@/types'

const TZ = 'Europe/Rome'

// Absence badge colors matching AssenzeClient
const ABSENCE_BADGE: Record<string, string> = {
  ferie:                  'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  malattia:               'bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-300',
  riposo:                 'bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-300',
  assenza_ingiustificata: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
}

type AttendanceRow = Attendance & {
  profile?: { id: string; full_name: string; role: string } | null
  restaurant?: { id: string; name: string } | null
}

export type AbsenceItem = {
  id: string
  user_id: string
  restaurant_id: string | null
  type: string
  start_date: string
  end_date: string
  profile?: { id: string; full_name: string } | null
}

interface Props {
  initialPresenze: AttendanceRow[]
  initialAbsences: AbsenceItem[]
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
  dipendenti: { id: string; full_name: string; role: string }[]
  currentUserRole: string
  currentRestaurantId: string | null
  isDirectore: boolean
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

export function PresenzeClient({
  initialPresenze, initialAbsences,
  restaurants, dipendenti, currentUserRole, currentRestaurantId, isDirectore,
}: Props) {
  const [presenze, setPresenze]   = useState(initialPresenze)
  const [absences, setAbsences]   = useState(initialAbsences)
  const [selectedMonth, setSelectedMonth]     = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM'))
  const [selectedRestaurant, setSelectedRestaurant] = useState(currentRestaurantId ?? 'all')
  const [loading, setLoading]     = useState(false)
  const [editing, setEditing]     = useState<AttendanceRow | null>(null)
  const [editCheckIn, setEditCheckIn]   = useState('')
  const [editCheckOut, setEditCheckOut] = useState('')
  const [saving, setSaving]       = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [isLive, setIsLive]       = useState(false)
  const [showAdd, setShowAdd]     = useState(false)
  const [newUserId, setNewUserId] = useState('')
  const [newDate, setNewDate]     = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'))
  const [newCheckIn, setNewCheckIn]   = useState('')
  const [newCheckOut, setNewCheckOut] = useState('')
  const [addError, setAddError]   = useState<string | null>(null)
  const [addSaving, setAddSaving] = useState(false)

  // Refs so the realtime handler always reads current filter values without re-subscribing
  const monthRef      = useRef(selectedMonth)
  const restaurantRef = useRef(selectedRestaurant)
  useEffect(() => { monthRef.current = selectedMonth },      [selectedMonth])
  useEffect(() => { restaurantRef.current = selectedRestaurant }, [selectedRestaurant])

  // Supabase Realtime subscription — wired once on mount
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('rt-presenze')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendances' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id: string }).id
            setPresenze(ps => ps.filter(p => p.id !== deletedId))
            return
          }

          const rec = payload.new as { id: string; check_in: string; restaurant_id: string | null }

          const [y, m] = monthRef.current.split('-').map(Number)
          const monthStart = new Date(Date.UTC(y, m - 1, 1))
          const monthEnd   = new Date(Date.UTC(y, m, 0, 23, 59, 59))
          const checkIn    = new Date(rec.check_in)
          if (checkIn < monthStart || checkIn > monthEnd) return

          if (restaurantRef.current !== 'all' && rec.restaurant_id !== restaurantRef.current) return

          const { data } = await supabase
            .from('attendances')
            .select('*, profile:profiles(id, full_name, role), restaurant:restaurants(id, name)')
            .eq('id', rec.id)
            .single()

          if (!data) return

          if (payload.eventType === 'INSERT') {
            setPresenze(ps =>
              ps.some(p => p.id === data.id)
                ? ps.map(p => p.id === data.id ? data : p)
                : [data, ...ps]
            )
          } else {
            setPresenze(ps => ps.map(p => p.id === data.id ? data : p))
          }
        }
      )
      .subscribe(status => { setIsLive(status === 'SUBSCRIBED') })

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Load presenze + absences for the given month / restaurant filter
  const loadData = useCallback(async (month: string, restaurantId: string) => {
    setLoading(true)
    const [year, m] = month.split('-').map(Number)
    const startIso = new Date(Date.UTC(year, m - 1, 1)).toISOString()
    const endIso   = new Date(Date.UTC(year, m, 0, 23, 59, 59)).toISOString()
    const monthStart = `${month}-01`
    const monthEnd   = `${month}-${String(new Date(Date.UTC(year, m, 0)).getDate()).padStart(2, '0')}`

    const supabase = createClient()
    let presQ = supabase
      .from('attendances')
      .select('*, profile:profiles(id, full_name, role), restaurant:restaurants(id, name)')
      .gte('check_in', startIso)
      .lte('check_in', endIso)
      .order('check_in', { ascending: false })

    let absQ = supabase
      .from('absences')
      .select('id, user_id, restaurant_id, type, start_date, end_date, profile:profiles!user_id(id, full_name)')
      .eq('status', 'approved')
      .lte('start_date', monthEnd)
      .gte('end_date', monthStart)

    if (restaurantId !== 'all') {
      presQ = presQ.eq('restaurant_id', restaurantId)
      absQ  = absQ.eq('restaurant_id', restaurantId)
    }

    const [{ data: p }, { data: a }] = await Promise.all([presQ, absQ])
    setPresenze(p ?? [])
    setAbsences((a ?? []) as unknown as AbsenceItem[])
    setLoading(false)
  }, [])

  function handleMonthChange(month: string) {
    setSelectedMonth(month)
    loadData(month, selectedRestaurant)
  }

  function handleRestaurantChange(restaurantId: string) {
    setSelectedRestaurant(restaurantId)
    loadData(selectedMonth, restaurantId)
  }

  function openEdit(p: AttendanceRow) {
    setEditing(p)
    setConfirmingDelete(false)
    setEditCheckIn(formatInTimeZone(new Date(p.check_in), TZ, "yyyy-MM-dd'T'HH:mm"))
    setEditCheckOut(p.check_out ? formatInTimeZone(new Date(p.check_out), TZ, "yyyy-MM-dd'T'HH:mm") : '')
  }

  function closeEdit() {
    setEditing(null)
    setConfirmingDelete(false)
  }

  async function handleSave() {
    if (!canEdit) { showUnauthorized(); return }
    if (!editing) return
    setSaving(true)

    const supabase = createClient()
    const updates: Record<string, string | null> = {
      check_in:  fromZonedTime(new Date(editCheckIn), TZ).toISOString(),
      check_out: editCheckOut ? fromZonedTime(new Date(editCheckOut), TZ).toISOString() : null,
    }

    const { data } = await supabase
      .from('attendances')
      .update(updates)
      .eq('id', editing.id)
      .select('*, profile:profiles(id, full_name, role), restaurant:restaurants(id, name)')
      .single()

    if (data) setPresenze(ps => ps.map(p => p.id === data.id ? data : p))
    closeEdit()
    setSaving(false)
  }

  async function handleDelete() {
    if (!canEdit) { showUnauthorized(); return }
    if (!editing) return
    setDeleting(true)
    const supabase = createClient()
    const { error } = await supabase.from('attendances').delete().eq('id', editing.id)
    if (!error) {
      setPresenze(ps => ps.filter(p => p.id !== editing.id))
      closeEdit()
    }
    setDeleting(false)
  }

  function resetAddForm() {
    setNewUserId('')
    setNewDate(formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'))
    setNewCheckIn('')
    setNewCheckOut('')
    setAddError(null)
  }

  async function handleAddPresenza() {
    if (!canEdit) { showUnauthorized(); return }
    if (!newUserId || !newDate || !newCheckIn) return
    setAddSaving(true)
    setAddError(null)

    const res = await fetch('/api/presenze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: newUserId,
        date: newDate,
        checkIn: newCheckIn,
        checkOut: newCheckOut || undefined,
      }),
    })
    const data = await res.json()

    if (!res.ok) {
      setAddError(data.error || 'Errore durante il salvataggio')
      setAddSaving(false)
      return
    }

    const [y, m] = selectedMonth.split('-').map(Number)
    const monthStart = new Date(Date.UTC(y, m - 1, 1))
    const monthEnd   = new Date(Date.UTC(y, m, 0, 23, 59, 59))
    const checkInDate = new Date(data.attendance.check_in)
    const matchesMonth = checkInDate >= monthStart && checkInDate <= monthEnd
    const matchesRest  = selectedRestaurant === 'all' || data.attendance.restaurant_id === selectedRestaurant
    if (matchesMonth && matchesRest) {
      setPresenze(ps => [data.attendance, ...ps])
    }

    setShowAdd(false)
    resetAddForm()
    setAddSaving(false)
  }

  // ── Grouped presenze + absent employees ────────────────────────────────
  // Depends on presenze, absences, and selectedMonth (for "show today" logic).
  const groupedPresenze = useMemo(() => {
    type PresentRow = {
      userId: string
      userName: string
      restaurantName: string | null
      blocks: AttendanceRow[]
      totalMinutes: number
      hasOpen: boolean
      hasSplit: boolean
      isAbsent: false
    }
    type AbsentRow = {
      userId: string
      userName: string
      isAbsent: true
      absenceType: string
    }
    type Row = PresentRow | AbsentRow

    // Build present rows (existing logic)
    const byDay = new Map<string, Map<string, PresentRow>>()

    for (const p of presenze) {
      const dayKey = formatInTimeZone(new Date(p.check_in), TZ, 'yyyy-MM-dd')
      let dayMap = byDay.get(dayKey)
      if (!dayMap) { dayMap = new Map(); byDay.set(dayKey, dayMap) }

      let row = dayMap.get(p.user_id)
      if (!row) {
        row = {
          userId: p.user_id,
          userName: p.profile?.full_name ?? '—',
          restaurantName: p.restaurant?.name ?? null,
          blocks: [],
          totalMinutes: 0,
          hasOpen: false,
          hasSplit: false,
          isAbsent: false,
        }
        dayMap.set(p.user_id, row)
      }

      row.blocks.push(p)
      if (!p.check_out) row.hasOpen = true
      else row.totalMinutes += differenceInMinutes(new Date(p.check_out), new Date(p.check_in))
      if (p.is_split_shift) row.hasSplit = true
    }

    // Sort shift blocks within each employee row
    for (const dayMap of byDay.values()) {
      for (const row of dayMap.values()) {
        row.blocks.sort((a, b) => new Date(a.check_in).getTime() - new Date(b.check_in).getTime())
      }
    }

    // Ensure today appears if the selected month is the current month and there
    // are approved absences for today — even if nobody has clocked in yet.
    const todayKey   = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
    const todayMonth = todayKey.substring(0, 7)
    if (todayMonth === selectedMonth) {
      const hasAbsencesToday = absences.some(a => a.start_date <= todayKey && a.end_date >= todayKey)
      if (hasAbsencesToday && !byDay.has(todayKey)) {
        byDay.set(todayKey, new Map())
      }
    }

    // Build absent rows: approved absence covers the day AND employee has no presenze that day
    const byDayAbsent = new Map<string, Map<string, AbsentRow>>()
    for (const [dayKey, presentMap] of byDay.entries()) {
      const absentMap = new Map<string, AbsentRow>()
      for (const absence of absences) {
        if (absence.start_date > dayKey || absence.end_date < dayKey) continue
        const uid = absence.user_id
        if (presentMap.has(uid) || absentMap.has(uid)) continue
        absentMap.set(uid, {
          userId: uid,
          userName: absence.profile?.full_name ?? '—',
          isAbsent: true,
          absenceType: absence.type,
        })
      }
      byDayAbsent.set(dayKey, absentMap)
    }

    // Sort and merge present + absent per day
    return Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, dayMap]) => {
        const presentRows = Array.from(dayMap.values())
          .sort((a, b) => a.userName.localeCompare(b.userName, 'it'))
        const absentRows = Array.from((byDayAbsent.get(day) ?? new Map()).values())
          .sort((a, b) => a.userName.localeCompare(b.userName, 'it'))
        return [day, [...presentRows, ...absentRows] as Row[]] as const
      })
  }, [presenze, absences, selectedMonth])

  function formatDayHeader(dayKey: string): string {
    const [y, m, d] = dayKey.split('-').map(Number)
    const date = new Date(y, m - 1, d, 12, 0, 0)
    const label = formatInTimeZone(date, TZ, 'EEEE d MMMM yyyy', { locale: it })
    return label.charAt(0).toUpperCase() + label.slice(1)
  }

  const isManager = currentUserRole === 'manager'
  const canEdit   = isManager || (currentUserRole === 'capo_servizio' && isDirectore)

  const [unauthorizedMsg, setUnauthorizedMsg] = useState(false)
  function showUnauthorized() {
    setUnauthorizedMsg(true)
    setTimeout(() => setUnauthorizedMsg(false), 3000)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Presenze</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{presenze.length} timbrature</p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button onClick={() => setShowAdd(true)} size="sm" className="h-8 rounded-sm px-3 text-xs gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              Aggiungi Presenza
            </Button>
          )}
          <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border ${
            isLive
              ? 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/30 dark:border-emerald-800'
              : 'text-muted-foreground bg-muted border-border'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'}`} />
            {isLive ? 'Live' : 'Connessione...'}
          </div>
        </div>
      </div>

      {/* Filtri */}
      <div className="flex flex-wrap gap-3 mb-6">
        <Input
          type="month"
          value={selectedMonth}
          onChange={e => handleMonthChange(e.target.value)}
          className="w-auto"
        />
        {isManager && (
          <Select value={selectedRestaurant} onValueChange={handleRestaurantChange}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Tutti i ristoranti" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i ristoranti</SelectItem>
              {restaurants.map(r => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />
          ))}
        </div>
      ) : groupedPresenze.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nessuna presenza nel periodo selezionato
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedPresenze.map(([dayKey, rows]) => (
            <section key={dayKey}>
              <div className="flex items-baseline justify-between border-b border-border pb-1.5 mb-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {formatDayHeader(dayKey)}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {rows.length} {rows.length === 1 ? 'dipendente' : 'dipendenti'}
                </span>
              </div>

              <div className="space-y-2">
                {rows.map(row => {
                  // ── Absent employee row ──────────────────────────────
                  if (row.isAbsent) {
                    return (
                      <Card
                        key={`absent-${dayKey}-${row.userId}`}
                        className="rounded-sm opacity-80 border-dashed"
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center gap-4">
                            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-muted-foreground">
                                {row.userName}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ABSENCE_BADGE[row.absenceType] ?? ''}`}>
                                {ABSENCE_LABELS[row.absenceType as AbsenceType] ?? row.absenceType}
                              </span>
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">Assente</span>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  }

                  // ── Present employee row (existing logic) ────────────
                  const openBlock = row.hasOpen ? row.blocks.find(b => !b.check_out) : undefined
                  return (
                    <Card key={`${dayKey}-${row.userId}`} className="rounded-sm">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <span className="font-medium text-sm">{row.userName}</span>
                              {row.hasOpen && (
                                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs">
                                  In corso
                                </Badge>
                              )}
                              {row.hasSplit && (
                                <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 text-xs">
                                  Spezzato
                                </Badge>
                              )}
                              {row.restaurantName && (
                                <span className="text-xs text-muted-foreground">{row.restaurantName}</span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 flex-wrap">
                              {row.blocks.map(b => {
                                const isOpen   = !b.check_out
                                const checkIn  = formatInTimeZone(new Date(b.check_in), TZ, 'HH:mm')
                                const checkOut = b.check_out
                                  ? formatInTimeZone(new Date(b.check_out), TZ, 'HH:mm')
                                  : '···'
                                return canEdit ? (
                                  <button
                                    key={b.id}
                                    onClick={() => openEdit(b)}
                                    title="Modifica turno"
                                    className={`h-10 px-3 inline-flex items-center justify-center text-xs font-medium tabular-nums rounded-sm border cursor-pointer transition-colors ${
                                      isOpen
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-400'
                                        : 'bg-zinc-100 border-border text-foreground hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800'
                                    }`}
                                  >
                                    {checkIn} → {checkOut}
                                  </button>
                                ) : (
                                  <span
                                    key={b.id}
                                    className={`h-10 px-3 inline-flex items-center justify-center text-xs font-medium tabular-nums rounded-sm border ${
                                      isOpen
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-400'
                                        : 'bg-zinc-100 border-border text-foreground dark:bg-zinc-900'
                                    }`}
                                  >
                                    {checkIn} → {checkOut}
                                  </span>
                                )
                              })}
                            </div>
                          </div>

                          <div className="shrink-0 text-right">
                            <div className="text-sm font-semibold tabular-nums flex items-center gap-1.5 justify-end">
                              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                              {openBlock ? (
                                <LiveShiftCounter
                                  checkInTime={openBlock.check_in}
                                  baseMinutes={row.totalMinutes}
                                />
                              ) : (
                                formatDuration(row.totalMinutes)
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {row.blocks.length} {row.blocks.length === 1 ? 'turno' : 'turni'}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Dialog modifica */}
      <Dialog open={!!editing} onOpenChange={open => !open && closeEdit()}>
        <DialogContent onInteractOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{confirmingDelete ? 'Elimina Timbratura' : 'Modifica Timbratura'}</DialogTitle>
          </DialogHeader>

          {confirmingDelete ? (
            <div className="space-y-4">
              <div className="flex gap-3 items-start rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">Sei sicuro di voler eliminare questa timbratura?</p>
                  <p className="text-muted-foreground mt-1">L&apos;azione è irreversibile.</p>
                </div>
              </div>
              {editing && (
                <div className="text-xs text-muted-foreground border-l-2 border-border pl-3">
                  <div>{editing.profile?.full_name ?? '—'}</div>
                  <div>
                    {formatInTimeZone(new Date(editing.check_in), TZ, 'dd-MM-yyyy HH:mm')} → {editing.check_out ? formatInTimeZone(new Date(editing.check_out), TZ, 'HH:mm') : '—'}
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmingDelete(false)} disabled={deleting} className="h-10 rounded-sm">
                  Annulla
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="h-10 rounded-sm">
                  {deleting ? 'Eliminazione...' : 'Elimina definitivamente'}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Entrata (ora locale)</Label>
                  <Input
                    type="datetime-local"
                    value={editCheckIn}
                    onChange={e => setEditCheckIn(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Uscita (ora locale)</Label>
                  <Input
                    type="datetime-local"
                    value={editCheckOut}
                    onChange={e => setEditCheckOut(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter className="sm:justify-between gap-2">
                <Button
                  variant="destructive"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={saving}
                  className="h-10 rounded-sm"
                >
                  <Trash2 className="w-4 h-4" />
                  Elimina
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={closeEdit} disabled={saving} className="h-10 rounded-sm">
                    Annulla
                  </Button>
                  <Button onClick={handleSave} disabled={saving || !editCheckIn} className="h-10 rounded-sm">
                    {saving ? <>Salvataggio<LoadingDots /></> : 'Salva'}
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog aggiunta manuale */}
      <Dialog open={showAdd} onOpenChange={open => { if (!open) { setShowAdd(false); resetAddForm() } }}>
        <DialogContent onInteractOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Aggiungi Presenza</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Dipendente</Label>
              <Select value={newUserId} onValueChange={setNewUserId}>
                <SelectTrigger className="h-10 rounded-sm">
                  <SelectValue placeholder="Seleziona dipendente..." />
                </SelectTrigger>
                <SelectContent>
                  {dipendenti.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Data</Label>
              <Input
                type="date"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                className="h-10 rounded-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Ora Ingresso</Label>
                <Input
                  type="time"
                  value={newCheckIn}
                  onChange={e => setNewCheckIn(e.target.value)}
                  className="h-10 rounded-sm"
                />
              </div>
              <div className="space-y-2">
                <Label>Ora Uscita</Label>
                <Input
                  type="time"
                  value={newCheckOut}
                  onChange={e => setNewCheckOut(e.target.value)}
                  className="h-10 rounded-sm"
                />
              </div>
            </div>
            {addError && (
              <p className="text-sm text-destructive">{addError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowAdd(false); resetAddForm() }}
              disabled={addSaving}
              className="h-10 rounded-sm"
            >
              Annulla
            </Button>
            <Button
              onClick={handleAddPresenza}
              disabled={addSaving || !newUserId || !newDate || !newCheckIn}
              className="h-10 rounded-sm"
            >
              {addSaving ? <>Salvataggio<LoadingDots /></> : 'Aggiungi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unauthorized toast */}
      {unauthorizedMsg && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-destructive text-destructive-foreground px-4 py-3 rounded-md shadow-lg text-sm font-medium animate-in slide-in-from-bottom-2">
          Azione riservata alla direzione
        </div>
      )}
    </div>
  )
}
