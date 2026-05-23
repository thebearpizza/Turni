'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Plus, Pencil, Trash2, User } from 'lucide-react'
import type { Profile, Restaurant, Role } from '@/types'
import { ROLE_LABELS } from '@/types'

interface Props {
  initialDipendenti: (Profile & { restaurant?: { id: string; name: string } | null })[]
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
  currentUserRole: string
}

const roleColors: Record<Role, string> = {
  manager: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  capo_servizio: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  dipendente: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

export function DipendentiClient({ initialDipendenti, restaurants, currentUserRole }: Props) {
  const [dipendenti, setDipendenti] = useState(initialDipendenti)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Form state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<Role>('dipendente')
  const [restaurantId, setRestaurantId] = useState('')
  const [canPostBulletin, setCanPostBulletin] = useState(false)

  function openCreate() {
    setEditing(null)
    setEmail('')
    setPassword('')
    setFullName('')
    setRole('dipendente')
    setRestaurantId('')
    setCanPostBulletin(false)
    setError(null)
    setShowForm(true)
  }

  function openEdit(p: Profile) {
    setEditing(p)
    setEmail('')
    setPassword('')
    setFullName(p.full_name)
    setRole(p.role)
    setRestaurantId(p.restaurant_id ?? '')
    setCanPostBulletin(p.can_post_bulletin)
    setError(null)
    setShowForm(true)
  }

  async function handleSave() {
    setLoading(true)
    setError(null)

    try {
      if (editing) {
        const res = await fetch('/api/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editing.id,
            full_name: fullName,
            role,
            restaurant_id: restaurantId || null,
            can_post_bulletin: canPostBulletin,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setDipendenti(ds => ds.map(d => d.id === data.id ? { ...d, ...data } : d))
      } else {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            full_name: fullName,
            role,
            restaurant_id: restaurantId || null,
            can_post_bulletin: canPostBulletin,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setDipendenti(ds => [...ds, data])
      }
      setShowForm(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore durante il salvataggio')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Eliminare questo utente? Questa azione è irreversibile.')) return
    const res = await fetch(`/api/users?id=${id}`, { method: 'DELETE' })
    if (res.ok) setDipendenti(ds => ds.filter(d => d.id !== id))
  }

  const filtered = dipendenti.filter(d =>
    d.full_name.toLowerCase().includes(search.toLowerCase())
  )

  const isManager = currentUserRole === 'manager'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Dipendenti</h1>
          <p className="text-muted-foreground text-sm mt-1">{dipendenti.length} utenti</p>
        </div>
        {isManager && (
          <Button onClick={openCreate} size="sm">
            <Plus className="w-4 h-4" />
            Nuovo
          </Button>
        )}
      </div>

      <Input
        placeholder="Cerca per nome..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="mb-4 max-w-sm"
      />

      <div className="space-y-2">
        {filtered.map(d => (
          <Card key={d.id}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium">{d.full_name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[d.role]}`}>
                    {ROLE_LABELS[d.role]}
                  </span>
                </div>
                {(d as Profile & { restaurant?: { name: string } | null }).restaurant && (
                  <p className="text-sm text-muted-foreground truncate">
                    {(d as Profile & { restaurant?: { name: string } | null }).restaurant?.name}
                  </p>
                )}
              </div>
              {isManager && (
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(d)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(d.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Nessun utente trovato
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifica Utente' : 'Nuovo Utente'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!editing && (
              <>
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="mario@esempio.it" required />
                </div>
                <div className="space-y-2">
                  <Label>Password temporanea *</Label>
                  <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 caratteri" required />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>Nome completo *</Label>
              <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Mario Rossi" required />
            </div>
            <div className="space-y-2">
              <Label>Ruolo *</Label>
              <Select value={role} onValueChange={v => setRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABELS) as Role[]).map(r => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Ristorante</Label>
              <Select value={restaurantId} onValueChange={setRestaurantId}>
                <SelectTrigger><SelectValue placeholder="Nessun ristorante" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nessun ristorante</SelectItem>
                  {restaurants.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {role === 'capo_servizio' && (
              <div className="flex items-center justify-between">
                <Label>Può pubblicare in bacheca</Label>
                <Switch checked={canPostBulletin} onCheckedChange={setCanPostBulletin} />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={loading || !fullName.trim() || (!editing && (!email.trim() || !password.trim()))}>
              {loading ? 'Salvataggio...' : 'Salva'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
