'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Plus, QrCode, Pencil, Trash2, MapPin } from 'lucide-react'
import QRCode from 'qrcode'
import type { Restaurant } from '@/types'

interface Props {
  initialRestaurants: Restaurant[]
}

export function RestaurantsClient({ initialRestaurants }: Props) {
  const [restaurants, setRestaurants] = useState<Restaurant[]>(initialRestaurants)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Restaurant | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  function openCreate() {
    setEditing(null)
    setName('')
    setAddress('')
    setShowForm(true)
  }

  function openEdit(r: Restaurant) {
    setEditing(r)
    setName(r.name)
    setAddress(r.address ?? '')
    setShowForm(true)
  }

  async function handleSave() {
    setLoading(true)
    const supabase = createClient()

    if (editing) {
      const { data } = await supabase
        .from('restaurants')
        .update({ name, address: address || null })
        .eq('id', editing.id)
        .select()
        .single()
      if (data) setRestaurants(rs => rs.map(r => r.id === data.id ? data : r))
    } else {
      const { data } = await supabase
        .from('restaurants')
        .insert({ name, address: address || null })
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
      width: 400,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
    const a = document.createElement('a')
    a.href = url
    a.download = `QR-${restaurant.name.replace(/\s+/g, '-')}.png`
    a.click()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Ristoranti</h1>
          <p className="text-muted-foreground text-sm mt-1">{restaurants.length} ristoranti</p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4" />
          Aggiungi
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
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => downloadQR(r)} className="flex-1">
                    <QrCode className="w-4 h-4" />
                    QR Code
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
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

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifica Ristorante' : 'Nuovo Ristorante'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="La Bella Italia" required />
            </div>
            <div className="space-y-2">
              <Label>Indirizzo</Label>
              <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Via Roma 1, Milano" />
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
    </div>
  )
}
