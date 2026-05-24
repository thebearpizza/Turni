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
import { Clock, Trash2, AlertTriangle } from 'lucide-react'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { differenceInMinutes } from 'date-fns'
import { it } from 'date-fns/locale'
import type { Attendance, Restaurant } from '@/types'

const TZ = 'Europe/Rome'

interface Props {
  initialPresenze: (Attendance & {
    profile?: { id: string; full_name: string; role: string } | null
    restaurant?: { id: string; name: string } | null
  })[]
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
  currentUserRole: string
  currentRestaurantId: string | null
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

export function PresenzeClient({ initialPresenze, restaurants, currentUserRole, currentRestaurantId }: Props) {
  const [presenze, setPresenze] = useState(initialPresenze)
  const [selectedMonth, setSelectedMonth] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM'))
  const [selectedRestaurant, setSelectedRestaurant] = useState(currentRestaurantId ?? 'all')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<typeof initialPresenze[0] | null>(null)
  const [editCheckIn, setEditCheckIn] = useState('')
  const [editCheckOut, setEditCheckOut] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [isLive, setIsLive] = useState(false)

  // Refs so the realtime handler always reads current filter values without re-subscribing
  const monthRef = useRef(selectedMonth)
  const restaurantRef = useRef(selectedRestaurant)
  useEffect(() => { monthRef.current = selectedMonth }, [selectedMonth])
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

          // Filter: check if record falls within selected month
          const [y, m] = monthRef.current.split('-').map(Number)
          const monthStart = new Date(Date.UTC(y, m - 1, 1))
          const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59))
          const checkIn = new Date(rec.check_in)
          if (checkIn < monthStart || checkIn > monthEnd) return

          // Filter: check restaurant (skip if 'all')
          if (restaurantRef.current !== 'all' && rec.restaurant_id !== restaurantRef.current) return

          // Fetch full record with profile + restaurant joins
          const { data } = await supabase
            .from('attendances')
            .select('*, profile:profiles(id, full_name, role), restaurant:restaurants(id, name)')
            .eq('id', rec.id)
            .single()

          if (!data) return

          if (payload.eventType === 'INSERT') {
            setPresenze(ps => [data, ...ps])
          } else {
            setPresenze(ps => ps.map(p => p.id === data.id ? data : p))
          }
        }
      )
      .subscribe(status => {
        setIsLive(status === 'SUBSCRIBED')
      })

    return () => { supabase.removeChannel(channel) }
  }, [])

  const loadPresenze = useCallback(async (month: string, restaurantId: string) => {
    setLoading(true)
    const [year, m] = month.split('-').map(Number)
    const startDate = new Date(Date.UTC(year, m - 1, 1)).toISOString()
    const endDate = new Date(Date.UTC(year, m, 0, 23, 59, 59)).toISOString()

    const supabase = createClient()
    let query = supabase
      .from('attendances')
      .select('*, profile:profiles(id, full_name, role), restaurant:restaurants(id, name)')
      .gte('check_in', startDate)
      .lte('check_in', endDate)
      .order('check_in', { ascending: false })

    if (restaurantId !== 'all') query = query.eq('restaurant_id', restaurantId)

    const { data } = await query
    setPresenze(data ?? [])
    setLoading(false)
  }, [])

  function handleMonthChange(month: string) {
    setSelectedMonth(month)
    loadPresenze(month, selectedRestaurant)
  }

  function handleRestaurantChange(restaurantId: string) {
    setSelectedRestaurant(restaurantId)
    loadPresenze(selectedMonth, restaurantId)
  }

  function openEdit(p: typeof initialPresenze[0]) {
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
    if (!editing) return
    setSaving(true)

    const supabase = createClient()
    const updates: Record<string, string | null> = {
      check_in: fromZonedTime(new Date(editCheckIn), TZ).toISOString(),
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
    if (!editing) return
    setDeleting(true)
    const supabase = createClient()
    const { error } = await supabase.from('attendances').delete().eq('id', editing.id)
    if (!error) {
      // Optimistic local removal — Realtime DELETE event will reconcile too
      setPresenze(ps => ps.filter(p => p.id !== editing.id))
      closeEdit()
    }
    setDeleting(false)
  }

  // Raggruppamento annidato Data -> Dipendente -> [blocchi]
  // Ricalcolato solo quando l'array presenze cambia
  const groupedPresenze = useMemo(() => {
    type Row = {
      userId: string
      userName: string
      restaurantName: string | null
      blocks: typeof presenze
      totalMinutes: number
      hasOpen: boolean
      hasSplit: boolean
    }
    const byDay = new Map<string, Map<string, Row>>()

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
        }
        dayMap.set(p.user_id, row)
      }

      row.blocks.push(p)
      if (!p.check_out) row.hasOpen = true
      else row.totalMinutes += differenceInMinutes(new Date(p.check_out), new Date(p.check_in))
      if (p.is_split_shift) row.hasSplit = true
    }

    // Blocchi: ordinati per check_in ascendente (mattina → sera)
    for (const dayMap of byDay.values()) {
      for (const row of dayMap.values()) {
        row.blocks.sort((a, b) => new Date(a.check_in).getTime() - new Date(b.check_in).getTime())
      }
    }

    // Giorni ordinati desc (oggi prima), dipendenti per nome asc
    return Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, dayMap]) => [
        day,
        Array.from(dayMap.values()).sort((a, b) => a.userName.localeCompare(b.userName, 'it')),
      ] as const)
  }, [presenze])

  function formatDayHeader(dayKey: string): string {
    const [y, m, d] = dayKey.split('-').map(Number)
    // Costruisci una data a mezzogiorno locale per evitare offset DST
    const date = new Date(y, m - 1, d, 12, 0, 0)
    const label = formatInTimeZone(date, TZ, 'EEEE d MMMM yyyy', { locale: it })
    return label.charAt(0).toUpperCase() + label.slice(1)
  }

  const isManager = currentUserRole === 'manager'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Presenze</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{presenze.length} timbrature</p>
        </div>
        {/* Indicatore live */}
        <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border ${
          isLive
            ? 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/30 dark:border-emerald-800'
            : 'text-muted-foreground bg-muted border-border'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'}`} />
          {isLive ? 'Live' : 'Connessione...'}
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
      ) : presenze.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nessuna presenza nel periodo selezionato
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedPresenze.map(([dayKey, rows]) => (
            <section key={dayKey}>
              {/* Header gruppo — stile Fluent/Windows: neutro, sottile, separato */}
              <div className="flex items-baseline justify-between border-b border-border pb-1.5 mb-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {formatDayHeader(dayKey)}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {rows.length} {rows.length === 1 ? 'dipendente' : 'dipendenti'}
                </span>
              </div>

              <div className="space-y-2">
                {rows.map(row => (
                  <Card key={`${dayKey}-${row.userId}`} className="rounded-sm">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        {/* Sezione sinistra: nome + badge stati + blocchi turno */}
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

                          {/* Blocchi turno: ogni badge è cliccabile → apre il dialog di modifica per quel blocco */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {row.blocks.map(b => {
                              const isOpen = !b.check_out
                              const checkIn = formatInTimeZone(new Date(b.check_in), TZ, 'HH:mm')
                              const checkOut = b.check_out
                                ? formatInTimeZone(new Date(b.check_out), TZ, 'HH:mm')
                                : '···'
                              return (
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
                              )
                            })}
                          </div>
                        </div>

                        {/* Sezione destra: totale ore + contatore turni */}
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-semibold tabular-nums flex items-center gap-1.5 justify-end">
                            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                            {formatDuration(row.totalMinutes)}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {row.blocks.length} {row.blocks.length === 1 ? 'turno' : 'turni'}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Dialog modifica */}
      <Dialog open={!!editing} onOpenChange={open => !open && closeEdit()}>
        <DialogContent>
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
                  <div>{formatInTimeZone(new Date(editing.check_in), TZ, 'dd-MM-yyyy HH:mm')} → {editing.check_out ? formatInTimeZone(new Date(editing.check_out), TZ, 'HH:mm') : '—'}</div>
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
                    {saving ? 'Salvataggio...' : 'Salva'}
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
