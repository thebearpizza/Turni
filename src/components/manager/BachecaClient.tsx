'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Globe, Store } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { it } from 'date-fns/locale'
import type { Bulletin, Restaurant, BulletinTarget } from '@/types'

type BulletinWithRelations = Bulletin & {
  restaurant?: { id: string; name: string } | null
  author?: { id: string; full_name: string } | null
}

interface Props {
  initialBulletins: BulletinWithRelations[]
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
  currentUserId: string
  currentUserRole: string
  currentRestaurantId: string | null
  canPost: boolean
}

export function BachecaClient({ initialBulletins, restaurants, currentUserId, currentUserRole, currentRestaurantId, canPost }: Props) {
  const [bulletins, setBulletins] = useState<BulletinWithRelations[]>(initialBulletins)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [target, setTarget] = useState<BulletinTarget>('all')
  const [restaurantId, setRestaurantId] = useState(currentRestaurantId ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data } = await supabase
      .from('bulletins')
      .insert({
        title,
        body,
        target,
        restaurant_id: target === 'restaurant' ? (restaurantId || null) : null,
        created_by: user!.id,
      })
      .select('*, restaurant:restaurants(id, name), author:profiles!created_by(id, full_name)')
      .single()

    if (data) setBulletins(bs => [data, ...bs])
    setTitle('')
    setBody('')
    setTarget('all')
    setShowForm(false)
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Eliminare questo comunicato?')) return
    const supabase = createClient()
    await supabase.from('bulletins').delete().eq('id', id)
    setBulletins(bs => bs.filter(b => b.id !== id))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Bacheca</h1>
        {canPost && (
          <Button onClick={() => setShowForm(true)} size="sm">
            <Plus className="w-4 h-4" /> Nuovo
          </Button>
        )}
      </div>

      {bulletins.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nessun comunicato pubblicato
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {bulletins.map(b => (
            <Card key={b.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <CardTitle className="text-base">{b.title}</CardTitle>
                      {b.target === 'all' ? (
                        <Badge variant="outline" className="gap-1 text-xs">
                          <Globe className="w-3 h-3" /> Tutti
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-xs">
                          <Store className="w-3 h-3" /> {b.restaurant?.name ?? 'Ristorante'}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {b.author?.full_name} · {formatDistanceToNow(new Date(b.created_at), { addSuffix: true, locale: it })}
                    </p>
                  </div>
                  {currentUserRole === 'manager' && (
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(b.id)} className="text-destructive hover:text-destructive shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm whitespace-pre-wrap">{b.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuovo Comunicato</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Titolo *</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Aggiornamento turni..." />
            </div>
            <div className="space-y-2">
              <Label>Messaggio *</Label>
              <Textarea value={body} onChange={e => setBody(e.target.value)} rows={5} placeholder="Scrivi il tuo comunicato..." />
            </div>
            <div className="space-y-2">
              <Label>Destinatari</Label>
              <Select value={target} onValueChange={v => setTarget(v as BulletinTarget)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  <SelectItem value="restaurant">Ristorante specifico</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {target === 'restaurant' && (
              <div className="space-y-2">
                <Label>Ristorante</Label>
                <Select value={restaurantId} onValueChange={setRestaurantId}>
                  <SelectTrigger><SelectValue placeholder="Seleziona ristorante" /></SelectTrigger>
                  <SelectContent>
                    {restaurants.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={saving || !title.trim() || !body.trim()}>
              {saving ? 'Pubblicazione...' : 'Pubblica'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
