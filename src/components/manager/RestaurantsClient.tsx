'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAccountStatus } from '@/contexts/AccountStatusContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Plus, QrCode, Pencil, Trash2, MapPin, Clock, X } from 'lucide-react'
import QRCode from 'qrcode'
import type { Restaurant, ShiftSlot, Department } from '@/types'
import { DEPARTMENTS, WEEK_DAYS_SHORT } from '@/types'

// 0=Dom..6=Sab — mostrati come Lun→Dom per convenzione
const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0] as const

interface Props {
  initialRestaurants: Restaurant[]
}

const emptySlotForm = () => ({
  department: '' as Department | '',
  name: '',
  start_time: '',
  end_time: '',
  required_count: 1,
  days_of_week: [] as number[],  // vuoto = tutti i giorni
})

export function RestaurantsClient({ initialRestaurants }: Props) {
  const { isPending } = useAccountStatus()
  const [restaurants, setRestaurants] = useState<Restaurant[]>(initialRestaurants)

  // ── Restaurant form ───────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Restaurant | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [closingDays, setClosingDays] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  // ── ShiftSlots dialog ─────────────────────────────────────────────────
  const [slotsRestaurant, setSlotsRestaurant] = useState<Restaurant | null>(null)
  const [slots, setSlots] = useState<ShiftSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotForm, setSlotForm] = useState(emptySlotForm())
  const [editingSlot, setEditingSlot] = useState<ShiftSlot | null>(null)
  const [slotSaving, setSlotSaving] = useState(false)
  const [slotError, setSlotError] = useState<string | null>(null)

  // ── Helpers ───────────────────────────────────────────────────────────
  function toggleClosingDay(day: number) {
    setClosingDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  function toggleSlotDay(day: number) {
    setSlotForm(f => ({
      ...f,
      days_of_week: f.days_of_week.includes(day)
        ? f.days_of_week.filter(d => d !== day)
        : [...f.days_of_week, day],
    }))
  }

  function openCreate() {
    setEditing(null)
    setName(''); setAddress(''); setLatitude(''); setLongitude('')
    setClosingDays([])
    setShowForm(true)
  }

  function openEdit(r: Restaurant) {
    setEditing(r)
    setName(r.name)
    setAddress(r.address ?? '')
    setLatitude(r.latitude != null ? String(r.latitude) : '')
    setLongitude(r.longitude != null ? String(r.longitude) : '')
    setClosingDays(r.closing_days ?? [])
    setShowForm(true)
  }

  async function handleSave() {
    setLoading(true)
    const supabase = createClient()
    const lat = latitude !== '' ? parseFloat(latitude) : null
    const lng = longitude !== '' ? parseFloat(longitude) : null

    if (editing) {
      const { data } = await supabase
        .from('restaurants')
        .update({ name, address: address || null, latitude: lat, longitude: lng, closing_days: closingDays })
        .eq('id', editing.id)
        .select()
        .single()
      if (data) setRestaurants(rs => rs.map(r => r.id === data.id ? data : r))
    } else {
      const { data } = await supabase
        .from('restaurants')
        .insert({ name, address: address || null, latitude: lat, longitude: lng, closing_days: closingDays })
        .select()
        .single()
      if (data) setRestaurants(rs => [...rs, data])
    }

    setShowForm(false)
    setLoading(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Eliminare questo ristorante?')) return
    setDeleting(id)
    const supabase = createClient()
    await supabase.from('restaurants').delete().eq('id', id)
    setRestaurants(rs => rs.filter(r => r.id !== id))
    setDeleting(null)
  }

  async function downloadQR(restaurant: Restaurant) {
    const url = await QRCode.toDataURL(restaurant.qr_secret, {
      width: 400, margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
    const a = document.createElement('a')
    a.href = url
    a.download = `QR-${restaurant.name.replace(/\s+/g, '-')}.png`
    a.click()
  }

  // ── Shift slots management ────────────────────────────────────────────
  async function openSlots(r: Restaurant) {
    setSlotsRestaurant(r)
    setSlotsLoading(true)
    setSlotForm(emptySlotForm())
    setEditingSlot(null)
    setSlotError(null)
    const supabase = createClient()
    const { data } = await supabase
      .from('shift_slots')
      .select('*')
      .eq('restaurant_id', r.id)
      .order('department')
      .order('start_time')
    setSlots((data ?? []) as ShiftSlot[])
    setSlotsLoading(false)
  }

  function startEditSlot(s: ShiftSlot) {
    setEditingSlot(s)
    setSlotForm({
      department: s.department,
      name:       s.name,
      start_time: s.start_time.slice(0, 5),
      end_time:   s.end_time.slice(0, 5),
      required_count: s.required_count,
      days_of_week:   s.days_of_week,
    })
    setSlotError(null)
  }

  function cancelEditSlot() {
    setEditingSlot(null)
    setSlotForm(emptySlotForm())
    setSlotError(null)
  }

  async function handleSaveSlot() {
    if (!slotsRestaurant || !slotForm.department || !slotForm.name || !slotForm.start_time || !slotForm.end_time) return
    setSlotSaving(true); setSlotError(null)
    const supabase = createClient()

    if (editingSlot) {
      const { data, error } = await supabase
        .from('shift_slots')
        .update({
          department:     slotForm.department,
          name:           slotForm.name,
          start_time:     slotForm.start_time,
          end_time:       slotForm.end_time,
          required_count: slotForm.required_count,
          days_of_week:   slotForm.days_of_week,
        })
        .eq('id', editingSlot.id)
        .select()
        .single()
      if (error) { setSlotError(error.message) }
      else if (data) {
        setSlots(prev => prev.map(s => s.id === editingSlot.id ? data as ShiftSlot : s))
        setEditingSlot(null)
        setSlotForm(emptySlotForm())
      }
    } else {
      const { data, error } = await supabase
        .from('shift_slots')
        .insert({
          restaurant_id:  slotsRestaurant.id,
          department:     slotForm.department,
          name:           slotForm.name,
          start_time:     slotForm.start_time,
          end_time:       slotForm.end_time,
          required_count: slotForm.required_count,
          days_of_week:   slotForm.days_of_week,
        })
        .select()
        .single()
      if (error) { setSlotError(error.message) }
      else if (data) {
        setSlots(prev => [...prev, data as ShiftSlot])
        setSlotForm(emptySlotForm())
      }
    }
    setSlotSaving(false)
  }

  async function handleDeleteSlot(id: string) {
    const supabase = createClient()
    await supabase.from('shift_slots').delete().eq('id', id)
    setSlots(prev => prev.filter(s => s.id !== id))
    if (editingSlot?.id === id) cancelEditSlot()
  }

  function isOvernight(start: string, end: string) {
    const [sh, sm] = start.split(':').map(Number)
    const [eh, em] = end.split(':').map(Number)
    return eh * 60 + em <= sh * 60 + sm
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Ristoranti</h1>
          <p className="text-muted-foreground text-sm mt-1">{restaurants.length} ristoranti</p>
        </div>
        <Button onClick={openCreate} size="sm" disabled={isPending} title={isPending ? 'Disponibile dopo l\'attivazione' : undefined}>
          <Plus className="w-4 h-4" /> Aggiungi
        </Button>
      </div>

      {restaurants.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nessun ristorante. Aggiungine uno per iniziare.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {restaurants.map(r => (
            <Card key={r.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{r.name}</CardTitle>
                  <Badge variant="outline" className="text-xs shrink-0">Attivo</Badge>
                </div>
                {r.address && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                    <MapPin className="w-3 h-3" /> {r.address}
                  </p>
                )}
                {r.closing_days?.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Chiuso: {r.closing_days.map(d => WEEK_DAYS_SHORT[d]).join(', ')}
                  </p>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => downloadQR(r)} className="flex-1">
                    <QrCode className="w-4 h-4" /> QR Code
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openSlots(r)} className="flex-1">
                    <Clock className="w-4 h-4" /> Fasce orarie
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => handleDelete(r.id)}
                    disabled={deleting === r.id}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Edit / Create restaurant ────────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifica Ristorante' : 'Nuovo Ristorante'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="La Bella Italia" />
            </div>
            <div className="space-y-2">
              <Label>Indirizzo</Label>
              <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Via Roma 1, Milano" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Latitudine</Label>
                <Input type="number" step="0.000001" value={latitude}
                  onChange={e => setLatitude(e.target.value)} placeholder="41.902782" />
              </div>
              <div className="space-y-2">
                <Label>Longitudine</Label>
                <Input type="number" step="0.000001" value={longitude}
                  onChange={e => setLongitude(e.target.value)} placeholder="12.496366" />
              </div>
            </div>

            {/* Giorno/i di chiusura ordinaria */}
            <div className="space-y-2">
              <Label>Giorno/i di chiusura settimanale</Label>
              <p className="text-xs text-muted-foreground -mt-1">
                Il giorno in cui il ristorante non apre. L'IA non genererà turni in questi giorni.
              </p>
              <div className="flex flex-wrap gap-2">
                {DAY_OPTIONS.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleClosingDay(d)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      closingDays.includes(d)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-border text-foreground hover:bg-accent'
                    }`}
                  >
                    {WEEK_DAYS_SHORT[d]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={loading || !name.trim()}>
              {loading ? 'Salvataggio...' : 'Salva'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Fasce orarie (ShiftSlots) ───────────────────────────────────── */}
      <Dialog open={!!slotsRestaurant} onOpenChange={open => { if (!open) setSlotsRestaurant(null) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fasce orarie — {slotsRestaurant?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Le fasce orarie definiscono quante persone servono per reparto in ogni turno.
              L'IA le usa come riferimento per generare i turni automaticamente.
            </p>

            {/* Elenco slot esistenti */}
            {slotsLoading ? (
              <p className="text-sm text-muted-foreground">Caricamento…</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Nessuna fascia configurata.</p>
            ) : (
              <div className="w-full rounded-md border overflow-auto max-h-[240px]">
                <table className="border-collapse text-xs w-full">
                  <thead>
                    <tr className="bg-zinc-900 text-white dark:bg-zinc-800">
                      <th className="px-2 py-1.5 text-left">Reparto</th>
                      <th className="px-2 py-1.5 text-left">Nome</th>
                      <th className="px-2 py-1.5 text-center">Orario</th>
                      <th className="px-2 py-1.5 text-center">N.</th>
                      <th className="px-2 py-1.5 text-left">Giorni</th>
                      <th className="px-2 py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map(s => (
                      <tr key={s.id} className={`even:bg-zinc-50 dark:even:bg-zinc-900/20 ${editingSlot?.id === s.id ? 'ring-2 ring-inset ring-primary/30' : ''}`}>
                        <td className="px-2 py-1 border border-zinc-200 dark:border-zinc-700">{s.department}</td>
                        <td className="px-2 py-1 border border-zinc-200 dark:border-zinc-700">{s.name}</td>
                        <td className="px-2 py-1 border border-zinc-200 dark:border-zinc-700 text-center whitespace-nowrap tabular-nums">
                          {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                          {isOvernight(s.start_time, s.end_time) && (
                            <span className="ml-0.5 text-[10px] text-amber-600 dark:text-amber-400" title="Termina il giorno successivo">(+1)</span>
                          )}
                        </td>
                        <td className="px-2 py-1 border border-zinc-200 dark:border-zinc-700 text-center">{s.required_count}</td>
                        <td className="px-2 py-1 border border-zinc-200 dark:border-zinc-700 text-xs text-muted-foreground">
                          {s.days_of_week.length === 0
                            ? 'Tutti'
                            : [1,2,3,4,5,6,0].filter(d => s.days_of_week.includes(d)).map(d => WEEK_DAYS_SHORT[d]).join(', ')
                          }
                        </td>
                        <td className="px-2 py-1 border border-zinc-200 dark:border-zinc-700 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <Button
                              variant="ghost" size="icon"
                              onClick={() => startEditSlot(s)}
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              onClick={() => handleDeleteSlot(s.id)}
                              className="text-destructive hover:text-destructive h-6 w-6"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Form aggiunta/modifica slot */}
            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">
                  {editingSlot ? `Modifica: ${editingSlot.name}` : 'Aggiungi fascia oraria'}
                </Label>
                {editingSlot && (
                  <Button variant="ghost" size="sm" onClick={cancelEditSlot} className="h-7 text-xs gap-1 text-muted-foreground">
                    <X className="w-3 h-3" /> Annulla
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Reparto *</Label>
                  <Select
                    value={slotForm.department}
                    onValueChange={v => setSlotForm(f => ({ ...f, department: v as Department }))}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Seleziona reparto" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Nome fascia *</Label>
                  <Input
                    value={slotForm.name}
                    onChange={e => setSlotForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="es. Pranzo, Cena, Apertura"
                    className="h-9 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Ora inizio *</Label>
                  <Input type="time" value={slotForm.start_time}
                    onChange={e => setSlotForm(f => ({ ...f, start_time: e.target.value }))}
                    className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Ora fine *</Label>
                  <Input type="time" value={slotForm.end_time}
                    onChange={e => setSlotForm(f => ({ ...f, end_time: e.target.value }))}
                    className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Persone *</Label>
                  <Input type="number" min={1} max={20} value={slotForm.required_count}
                    onChange={e => setSlotForm(f => ({ ...f, required_count: parseInt(e.target.value) || 1 }))}
                    className="h-9 text-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Giorni <span className="font-normal text-muted-foreground">(vuoto = tutti)</span></Label>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_OPTIONS.map(d => (
                    <button
                      key={d} type="button"
                      onClick={() => toggleSlotDay(d)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        slotForm.days_of_week.includes(d)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-border text-foreground hover:bg-accent'
                      }`}
                    >
                      {WEEK_DAYS_SHORT[d]}
                    </button>
                  ))}
                </div>
              </div>
              {slotForm.start_time && slotForm.end_time && isOvernight(slotForm.start_time, slotForm.end_time) && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  ⚠ Turno notturno: termina il giorno successivo (+1)
                </p>
              )}
              {slotError && <p className="text-xs text-destructive">{slotError}</p>}
              <Button
                size="sm" onClick={handleSaveSlot}
                disabled={slotSaving || !slotForm.department || !slotForm.name || !slotForm.start_time || !slotForm.end_time}
              >
                {editingSlot
                  ? <><Pencil className="w-4 h-4" /> {slotSaving ? 'Salvataggio…' : 'Salva modifiche'}</>
                  : <><Plus className="w-4 h-4" /> {slotSaving ? 'Salvataggio…' : 'Aggiungi fascia'}</>
                }
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSlotsRestaurant(null)}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
