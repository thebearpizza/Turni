'use client'
import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAccountStatus } from '@/contexts/AccountStatusContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, User, MoreVertical, Pencil, KeyRound, Trash2, CheckCircle2 } from 'lucide-react'
import type { Profile, Restaurant, Role, Department, SecondaryDepartment, ShiftSlot } from '@/types'
import { ROLE_LABELS, DEPARTMENTS, WEEK_DAYS_SHORT } from '@/types'

const USERNAME_RE = /^[a-z0-9._-]+$/

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

const roleColors: Record<Role, string> = {
  manager:           'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  capo_servizio:     'bg-blue-100   text-blue-800  dark:bg-blue-900/30   dark:text-blue-300',
  dipendente:        'bg-slate-100  text-slate-700 dark:bg-slate-800      dark:text-slate-300',
  consulente_lavoro: 'bg-amber-100  text-amber-800 dark:bg-amber-900/30  dark:text-amber-300',
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
  currentIsDirettore?: boolean
  currentRestaurantId?: string | null
  currentRestaurantFilter?: string | null
}

export function DipendentiClient({
  initialDipendenti, restaurants, currentUserRole,
  currentIsDirettore = false, currentRestaurantId = null,
  currentRestaurantFilter = null,
}: Props) {
  const { isPending } = useAccountStatus()
  const router   = useRouter()
  const pathname = usePathname()

  const [dipendenti, setDipendenti] = useState(initialDipendenti)
  const [search, setSearch]         = useState('')

  // ── Edit dialog ──────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState<DipWithRestaurant | null>(null)
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError]     = useState<string | null>(null)

  const [username, setUsername]           = useState('')
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [password, setPassword]           = useState('')
  const [fullName, setFullName]           = useState('')
  const [role, setRole]                   = useState<Role>('dipendente')
  const [department, setDepartment]       = useState<Department | ''>('')
  const [restaurantId, setRestaurantId]   = useState('none')
  const [canPostBulletin, setCanPostBulletin] = useState(false)
  const [isDirettore, setIsDirettore]     = useState(false)

  // ── AI scheduling fields ──────────────────────────────────────────────
  const [weeklyRestDays, setWeeklyRestDays]                     = useState(1)
  const [preferredRestDay, setPreferredRestDay]                 = useState<string>('none')
  const [primarySlotIds, setPrimarySlotIds]                     = useState<string[]>([])
  const [secondaryDepartments, setSecondaryDepartments]         = useState<SecondaryDepartment[]>([])
  const [weeklyHoursTarget, setWeeklyHoursTarget]               = useState<string>('')
  const [canSubstituteCapoServizio, setCanSubstituteCapoServizio] = useState(false)
  const [restaurantSlots, setRestaurantSlots]                   = useState<ShiftSlot[]>([])

  // ── Password-reset dialog ─────────────────────────────────────────────
  const [pwTarget, setPwTarget]   = useState<DipWithRestaurant | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwError, setPwError]     = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)

  // ── Restaurant filter (manager only, URL-based — SSR-friendly) ─────────
  function handleRestaurantFilter(value: string) {
    const params = new URLSearchParams()
    if (value !== 'all') params.set('restaurant_id', value)
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function validateUsername(val: string) {
    if (!val) { setUsernameError(null); return }
    setUsernameError(USERNAME_RE.test(val)
      ? null
      : 'Solo lettere minuscole, numeri, punti, trattini e underscore')
  }

  function openCreate() {
    setEditing(null)
    setUsername(''); setUsernameError(null); setPassword('')
    setFullName(''); setRole('dipendente'); setDepartment('')
    setRestaurantId(currentUserRole === 'manager' ? 'none' : (currentRestaurantId ?? 'none'))
    setCanPostBulletin(false); setIsDirettore(false)
    setWeeklyRestDays(1); setPreferredRestDay('none')
    setPrimarySlotIds([]); setSecondaryDepartments([])
    setWeeklyHoursTarget(''); setCanSubstituteCapoServizio(false)
    setRestaurantSlots([])
    setFormError(null); setShowForm(true)
  }

  async function openEdit(p: DipWithRestaurant) {
    setEditing(p)
    setUsername(''); setUsernameError(null); setPassword('')
    setFullName(p.full_name); setRole(p.role)
    setDepartment((p.department as Department | null) ?? '')
    setRestaurantId(p.restaurant_id ?? 'none')
    setCanPostBulletin(p.can_post_bulletin)
    setIsDirettore(p.is_direttore ?? false)
    setWeeklyRestDays(p.weekly_rest_days ?? 1)
    setPreferredRestDay(p.preferred_rest_day != null ? String(p.preferred_rest_day) : 'none')
    setPrimarySlotIds((p as Profile).primary_slot_ids ?? [])
    setSecondaryDepartments((p.secondary_departments ?? []) as SecondaryDepartment[])
    setWeeklyHoursTarget(p.weekly_hours_target != null ? String(p.weekly_hours_target) : '')
    setCanSubstituteCapoServizio(p.can_substitute_capo_servizio ?? false)
    setRestaurantSlots([])
    setFormError(null); setShowForm(true)

    // Carica fasce orarie del ristorante in background
    const rid = p.restaurant_id
    if (rid) {
      const supabase = createClient()
      const { data } = await supabase
        .from('shift_slots')
        .select('*')
        .eq('restaurant_id', rid)
        .order('department')
        .order('start_time')
      setRestaurantSlots((data ?? []) as ShiftSlot[])
    }
  }

  function openPasswordReset(p: DipWithRestaurant) {
    setPwTarget(p); setNewPassword('')
    setPwError(null); setPwSuccess(false)
  }

  function closePwDialog() {
    setPwTarget(null); setNewPassword('')
    setPwError(null); setPwSuccess(false)
  }

  // ── Save (create / edit) ──────────────────────────────────────────────
  async function handleSave() {
    setFormLoading(true); setFormError(null)
    try {
      if (editing) {
        const res = await fetch('/api/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editing.id, full_name: fullName, role,
            department: department || null,
            restaurant_id: restaurantId === 'none' ? null : restaurantId,
            can_post_bulletin: canPostBulletin,
            is_direttore: role === 'capo_servizio' ? isDirettore : false,
            weekly_rest_days: weeklyRestDays,
            preferred_rest_day: preferredRestDay === 'none' ? null : parseInt(preferredRestDay),
            primary_slot_ids: primarySlotIds,
            secondary_departments: secondaryDepartments,
            weekly_hours_target: weeklyHoursTarget ? parseInt(weeklyHoursTarget) : null,
            can_substitute_capo_servizio: canSubstituteCapoServizio,
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
            username, password, full_name: fullName, role,
            department: department || null,
            restaurant_id: restaurantId === 'none' ? null : restaurantId,
            can_post_bulletin: canPostBulletin,
            is_direttore: role === 'capo_servizio' ? isDirettore : false,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setDipendenti(ds => [...ds, data])
      }
      setShowForm(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Errore durante il salvataggio')
    } finally {
      setFormLoading(false)
    }
  }

  // ── Reset password ────────────────────────────────────────────────────
  async function handleResetPassword() {
    if (!pwTarget) return
    setPwLoading(true); setPwError(null)
    try {
      const res = await fetch('/api/users/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pwTarget.id, password: newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPwSuccess(true)
      // Auto-close after 1.2 s so the user sees the success confirmation
      setTimeout(closePwDialog, 1200)
    } catch (e) {
      setPwError(e instanceof Error ? e.message : 'Errore durante il salvataggio')
    } finally {
      setPwLoading(false)
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
  // A "Direttore" (capo_servizio + is_direttore) can manage users within its
  // own restaurant, with manager-equivalent powers confined to that locale.
  const canManageUsers = isManager || (currentUserRole === 'capo_servizio' && currentIsDirettore)
  // Direttore cannot create/assign the manager role.
  // consulente_lavoro is managed via the dedicated ConsulenteLavoroManager section
  const assignableRoles = (Object.keys(ROLE_LABELS) as Role[])
    .filter(r => r !== 'consulente_lavoro' && (isManager || r !== 'manager'))
  const needsDept = role !== 'manager'
  const canSave = !!fullName.trim() &&
    (editing
      ? !usernameError
      : !!username.trim() && !usernameError && !!password.trim()) &&
    (!needsDept || !!department)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Dipendenti</h1>
          <p className="text-muted-foreground text-sm mt-1">{dipendenti.length} utenti</p>
        </div>
        {canManageUsers && (
          <Button onClick={openCreate} size="sm" disabled={isPending} title={isPending ? 'Disponibile dopo l\'attivazione' : undefined}>
            <Plus className="w-4 h-4" /> Nuovo
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Input
          placeholder="Cerca per nome o username..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
        {/* Restaurant filter — manager only. Capo servizio is locked server-side. */}
        {isManager && (
          <Select
            value={currentRestaurantFilter ?? 'all'}
            onValueChange={handleRestaurantFilter}
          >
            <SelectTrigger className="sm:w-56">
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

      {/* User list */}
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

              {/* Actions dropdown — manager / direttore */}
              {canManageUsers && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="shrink-0">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => openEdit(d)}>
                      <Pencil className="w-4 h-4" /> Modifica
                    </DropdownMenuItem>

                    {/* "Cambia Password" is hidden for other managers */}
                    {d.role !== 'manager' && (
                      <DropdownMenuItem onClick={() => openPasswordReset(d)}>
                        <KeyRound className="w-4 h-4" /> Cambia Password
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleDelete(d.id)}
                      className="text-destructive focus:text-destructive dark:text-red-400 dark:focus:text-red-300 dark:focus:bg-red-500/10"
                    >
                      <Trash2 className="w-4 h-4" /> Elimina
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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

      {/* ── Edit / Create dialog ────────────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifica Utente' : 'Nuovo Utente'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!editing && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Username *</Label>
                  <Input
                    value={username}
                    onChange={e => { setUsername(e.target.value.toLowerCase()); validateUsername(e.target.value.toLowerCase()) }}
                    placeholder="mario.rossi"
                    autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  />
                  {usernameError && <p className="text-xs text-destructive">{usernameError}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Password *</Label>
                  <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 caratteri" />
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
                    {assignableRoles.map(r => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reparto {needsDept ? '*' : ''}</Label>
                <Select value={department} onValueChange={v => setDepartment(v as Department)} disabled={!needsDept}>
                  <SelectTrigger><SelectValue placeholder="Seleziona reparto" /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Restaurant field — manager only. For capo servizio / direttore the
                value is auto-set to its own restaurant in openCreate/openEdit and
                hidden, so it can never assign a user to another locale. */}
            {isManager && (
              <div className="space-y-2">
                <Label>Ristorante</Label>
                <Select value={restaurantId} onValueChange={setRestaurantId}>
                  <SelectTrigger><SelectValue placeholder="Nessun ristorante" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nessun ristorante</SelectItem>
                    {restaurants.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {role === 'capo_servizio' && (
              <>
                {/* Direttore: global access to all departments of the restaurant.
                    Only a manager can grant this flag. */}
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label>Direttore (Accesso Globale al Locale)</Label>
                    <p className="text-xs text-muted-foreground">
                      Gestisce ODS e utenti di tutti i reparti del ristorante.
                    </p>
                  </div>
                  <Switch
                    checked={isDirettore}
                    onCheckedChange={setIsDirettore}
                    disabled={!isManager}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Può pubblicare in bacheca</Label>
                  <Switch checked={canPostBulletin} onCheckedChange={setCanPostBulletin} />
                </div>
              </>
            )}
            {/* ── Campi AI scheduling — solo in modifica (non creazione) ── */}
            {editing && (
              <div className="border-t border-border pt-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Pianificazione turni
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Riposi/settimana</Label>
                    <input
                      type="number" min={0} max={7}
                      value={weeklyRestDays}
                      onChange={e => setWeeklyRestDays(parseInt(e.target.value) || 0)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Ore/settimana <span className="font-normal text-muted-foreground">(vuoto = full-time)</span></Label>
                    <input
                      type="number" min={1} max={60} placeholder="es. 20"
                      value={weeklyHoursTarget}
                      onChange={e => setWeeklyHoursTarget(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">Giorno di riposo preferito</Label>
                  <select
                    value={preferredRestDay}
                    onChange={e => setPreferredRestDay(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  >
                    <option value="none">Nessuna preferenza</option>
                    {[1,2,3,4,5,6,0].map(d => (
                      <option key={d} value={String(d)}>{WEEK_DAYS_SHORT[d]}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5">
                  <div className="space-y-0.5">
                    <Label className="text-sm">Può fare da senior / sostituire capo servizio</Label>
                    <p className="text-xs text-muted-foreground">
                      L'IA garantisce almeno un senior per slot. Chi non lo è non può stare da solo.
                    </p>
                  </div>
                  <Switch checked={canSubstituteCapoServizio} onCheckedChange={setCanSubstituteCapoServizio} />
                </div>

                {/* Fasce principali (slot del reparto principale) */}
                {(() => {
                  const empDept = department || (editing as DipWithRestaurant).department
                  const primarySlots = restaurantSlots.filter(s => s.department === empDept)
                  if (!empDept || restaurantSlots.length === 0) return null
                  return (
                    <div className="space-y-2">
                      <Label className="text-sm">
                        Fasce principali <span className="font-normal text-muted-foreground">({empDept})</span>
                      </Label>
                      {primarySlots.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Nessuna fascia configurata per {empDept}.</p>
                      ) : (
                        <div className="space-y-1">
                          {primarySlots.map(s => {
                            const overnight = timeToMinutes(s.end_time) <= timeToMinutes(s.start_time)
                            return (
                              <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={primarySlotIds.includes(s.id)}
                                  onChange={e => {
                                    if (e.target.checked) setPrimarySlotIds(prev => [...prev, s.id])
                                    else setPrimarySlotIds(prev => prev.filter(id => id !== s.id))
                                  }}
                                  className="accent-primary"
                                />
                                <span className="text-sm">{s.name}</span>
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}
                                  {overnight && <span className="text-amber-600 dark:text-amber-400 ml-0.5">(+1)</span>}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Fasce jolly (slot di altri reparti) — solo manager */}
                {isManager && (() => {
                  const empDept = department || (editing as DipWithRestaurant).department
                  const jollySlots = restaurantSlots.filter(s => s.department !== empDept)
                  if (restaurantSlots.length === 0) return (
                    <p className="text-xs text-muted-foreground">Caricamento fasce…</p>
                  )
                  if (jollySlots.length === 0) return null

                  // Raggruppa per reparto
                  const byDept = jollySlots.reduce<Record<string, ShiftSlot[]>>((acc, s) => {
                    ;(acc[s.department] ??= []).push(s)
                    return acc
                  }, {})

                  return (
                    <div className="space-y-2">
                      <Label className="text-sm">Fasce jolly <span className="font-normal text-muted-foreground">(se necessario lavora in altro reparto)</span></Label>
                      <div className="space-y-3">
                        {Object.entries(byDept).map(([dept, deptSlots]) => (
                          <div key={dept}>
                            <p className="text-xs font-medium text-muted-foreground mb-1">{dept}</p>
                            <div className="space-y-1 pl-2">
                              {deptSlots.map(s => {
                                const existing = secondaryDepartments.find(sd => sd.slot_id === s.id)
                                const overnight = timeToMinutes(s.end_time) <= timeToMinutes(s.start_time)
                                return (
                                  <div key={s.id} className="flex items-center gap-2">
                                    <label className="flex items-center gap-2 cursor-pointer flex-1">
                                      <input
                                        type="checkbox"
                                        checked={!!existing}
                                        onChange={e => {
                                          if (e.target.checked) {
                                            setSecondaryDepartments(prev => [...prev, { slot_id: s.id, priority: 2 }])
                                          } else {
                                            setSecondaryDepartments(prev => prev.filter(sd => sd.slot_id !== s.id))
                                          }
                                        }}
                                        className="accent-primary"
                                      />
                                      <span className="text-sm">{s.name}</span>
                                      <span className="text-xs text-muted-foreground tabular-nums">
                                        {s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}
                                        {overnight && <span className="text-amber-600 dark:text-amber-400 ml-0.5">(+1)</span>}
                                      </span>
                                    </label>
                                    {existing && (
                                      <select
                                        value={existing.priority}
                                        onChange={e => setSecondaryDepartments(prev =>
                                          prev.map(sd => sd.slot_id === s.id ? { ...sd, priority: parseInt(e.target.value) } : sd)
                                        )}
                                        className="h-7 rounded border border-input bg-background px-2 text-xs"
                                      >
                                        <option value={1}>Priorità alta</option>
                                        <option value={2}>Priorità media</option>
                                        <option value={3}>Priorità bassa</option>
                                      </select>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            {formError && (
              <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{formError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={formLoading || !canSave}>
              {formLoading ? 'Salvataggio...' : 'Salva'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset password dialog ───────────────────────────────────────── */}
      <Dialog open={!!pwTarget} onOpenChange={open => { if (!open) closePwDialog() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reimposta password</DialogTitle>
            {pwTarget && (
              <p className="text-sm text-muted-foreground mt-0.5">{pwTarget.full_name}</p>
            )}
          </DialogHeader>

          {pwSuccess ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                Password aggiornata con successo
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="new-password">Nuova password *</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Min. 6 caratteri"
                  autoComplete="new-password"
                />
                {newPassword.length > 0 && newPassword.length < 6 && (
                  <p className="text-xs text-muted-foreground">Almeno 6 caratteri</p>
                )}
              </div>
              {pwError && (
                <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{pwError}</p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={closePwDialog} disabled={pwLoading}>Annulla</Button>
                <Button
                  onClick={handleResetPassword}
                  disabled={pwLoading || newPassword.trim().length < 6}
                >
                  {pwLoading ? 'Salvataggio...' : 'Salva'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
