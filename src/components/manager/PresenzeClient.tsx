'use client'
import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Pencil, Clock } from 'lucide-react'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { differenceInMinutes } from 'date-fns'
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
    // Converti UTC → Europe/Rome per l'input datetime-local
    setEditCheckIn(formatInTimeZone(new Date(p.check_in), TZ, "yyyy-MM-dd'T'HH:mm"))
    setEditCheckOut(p.check_out ? formatInTimeZone(new Date(p.check_out), TZ, "yyyy-MM-dd'T'HH:mm") : '')
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
    setEditing(null)
    setSaving(false)
  }

  const isManager = currentUserRole === 'manager'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Presenze</h1>
        <p className="text-muted-foreground text-sm">{presenze.length} timbrature</p>
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

      {/* Tabella / Lista */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : presenze.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nessuna presenze nel periodo selezionato
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {presenze.map(p => {
            const checkIn = new Date(p.check_in)
            const checkOut = p.check_out ? new Date(p.check_out) : null
            const minutes = checkOut ? differenceInMinutes(checkOut, checkIn) : null

            return (
              <Card key={p.id}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{p.profile?.full_name ?? '—'}</span>
                        {!p.check_out && (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs">
                            In corso
                          </Badge>
                        )}
                        {p.restaurant && (
                          <span className="text-xs text-muted-foreground">{p.restaurant.name}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
                        <span>↓ {formatInTimeZone(checkIn, TZ, 'dd/MM HH:mm')}</span>
                        {checkOut && <span>↑ {formatInTimeZone(checkOut, TZ, 'dd/MM HH:mm')}</span>}
                        {minutes !== null && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(minutes)}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Dialog modifica */}
      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifica Timbratura</DialogTitle>
          </DialogHeader>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Annulla</Button>
            <Button onClick={handleSave} disabled={saving || !editCheckIn}>
              {saving ? 'Salvataggio...' : 'Salva'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
