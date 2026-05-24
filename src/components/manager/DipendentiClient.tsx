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
import type { Profile, Restaurant, Role, Department } from '@/types'
import { ROLE_LABELS, DEPARTMENTS } from '@/types'

const USERNAME_RE = /^[a-z0-9._-]+$/

const roleColors: Record<Role, string> = {
  manager:       'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  capo_servizio: 'bg-blue-100   text-blue-800  dark:bg-blue-900/30   dark:text-blue-300',
  dipendente:    'bg-slate-100  text-slate-700 dark:bg-slate-800      dark:text-slate-300',
}

const deptColors: Record<Department, string> = {
  Sala:     'bg-amber-100  text-amber-800  dark:bg-amber-900/30  dark:text-amber-300',
  Pizzeria: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  Bar:      'bg-cyan-100   text-cyan-800   dark:bg-cyan-900/30   dark:text-cyan-300',
  Cucina:   'bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-300',
}

type DipWithRestaurant = Profile & { restaurant?: { id: string; name: string } | null }

interface Props {
  initialDipendenti: DipWithRestaurant[]
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
  currentUserRole: string
}

export function DipendentiClient({ initialDipendenti, restaurants, currentUserRole }: Props) {
  const [dipendenti, setDipendenti] = useState(initialDipendenti)
  const [showForm, setShowForm]     = useState(false)
  const [editing, setEditing]       = useState<DipWithRestaurant | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [search, setSearch]         = useState('')

  // Form state
  const [username, setUsername]           = useState('')
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [password, setPassword]           = useState('')
  const [fullName, setFullName]           = useState('')
  const [role, setRole]                   = useState<Role>('dipendente')
  const [department, setDepartment]       = useState<Department | ''>('')
  const [restaurantId, setRestaurantId]   = useState('none')
  const [canPostBulletin, setCanPostBulletin] = useState(false)

  function validateUsername(val: string) {
    if (!val) { setUsernameError(null); return }
    if (!USERNAME_RE.test(val)) {
      setUsernameError('Solo lettere minuscole, numeri, punti, trattini e underscore')
    } else {
      setUsernameError(null)
    }
  }

  function openCreate() {
    setEditing(null)
    setUsername(''); setUsernameError(null)
    setPassword(''); setFullName('')
    setRole('dipendente'); setDepartment('')
    setRestaurantId('none'); setCanPostBulletin(false)
    setError(null); setShowForm(true)
  }

  function openEdit(p: DipWithRestaurant) {
    setEditing(p)
    setUsername(''); setUsernameError(null)
    setPassword(''); setFullName(p.full_name)
    setRole(p.role)
    setDepartment((p.department as Department | null) ?? '')
    setRestaurantId(p.restaurant_id ?? 'none')
    setCanPostBulletin(p.can_post_bulletin)
    setError(null); setShowForm(true)
  }

  async function handleSave() {
    setLoading(true); setError(null)

    try {
      if (editing) {
        const res = await fetch('/api/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editing.id,
            full_name: fullName,
            role,
            department: department || null,
            restaurant_id: restaurantId === 'none' ? null : restaurantId,
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
            username,
            password,
            full_name: fullName,
            role,
            department: department || null,
            restaurant_id: restaurantId === 'none' ? null : restaurantId,
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
    d.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (d.username ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const isManager = currentUserRole === 'manager'
  const needsDept = role !== 'manager'
  const canSave = !!fullName.trim() &&
    (editing
      ? !usernameError
      : !!username.trim() && !usernameError && !!password.trim()) &&
    (!needsDept || !!department)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Dipendenti</h1>
          <p className="text-muted-foreground text-sm mt-1">{dipendenti.length} utenti</p>
        </div>
        {isManager && (
          <Button onClick={openCreate} size="sm">
            <Plus className="w-4 h-4" /> Nuovo
          </Button>
        )}
      </div>

      <Input
        placeholder="Cerca per nome o username..."
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
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <p className="font-medium">{d.full_name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[d.role]}`}>
                    {ROLE_LABELS[d.role]}
                  </span>
                  {d.department && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${deptColors[d.department as Department]}`}>
                      {d.department}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {d.username ? `@${d.username}` : ''}
                  {d.username && d.restaurant && ' · '}
                  {d.restaurant?.name}
                </p>
              </div>
              {isManager && (
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(d)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
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

            {/* Username + Password — solo in creazione */}
            {!editing && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Username *</Label>
                  <Input
                    value={username}
                    onChange={e => { setUsername(e.target.value.toLowerCase()); validateUsername(e.target.value.toLowerCase()) }}
                    placeholder="mario.rossi"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  {usernameError && (
                    <p className="text-xs text-destructive">{usernameError}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Password *</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Min. 6 caratteri"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Nome completo *</Label>
              <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Mario Rossi" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Ruolo *</Label>
                <Select value={role} onValueChange={v => { setRole(v as Role); if (v === 'manager') setDepartment('') }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABELS) as Role[]).map(r => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Reparto {needsDept ? '*' : ''}</Label>
                <Select
                  value={department}
                  onValueChange={v => setDepartment(v as Department)}
                  disabled={!needsDept}
                >
                  <SelectTrigger><SelectValue placeholder="Seleziona reparto" /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Ristorante</Label>
              <Select value={restaurantId} onValueChange={setRestaurantId}>
                <SelectTrigger><SelectValue placeholder="Nessun ristorante" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nessun ristorante</SelectItem>
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

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={loading || !canSave}>
              {loading ? 'Salvataggio...' : 'Salva'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
