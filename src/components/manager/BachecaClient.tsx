'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Globe, Store, Users, Eye, ChevronDown } from 'lucide-react'
import { LoadingDots } from '@/components/shared/LoadingDots'
import { formatInTimeZone } from 'date-fns-tz'
import type { Bulletin, BulletinRead, BulletinTarget, Restaurant, Role } from '@/types'
import { ROLE_LABELS, DEPARTMENTS } from '@/types'

const TZ = 'Europe/Rome'

type DipProfile = { id: string; full_name: string; role: string }

type BulletinWithRelations = Bulletin & {
  restaurant?: { id: string; name: string } | null
  author?: { id: string; full_name: string } | null
}

interface Props {
  initialBulletins: BulletinWithRelations[]
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
  dipendenti: DipProfile[]
  currentUserId: string
  currentUserRole: string
  currentRestaurantId: string | null
  canPost: boolean
  isDirettore?: boolean
}

const SELECTABLE_ROLES: { value: string; label: string }[] = [
  { value: 'capo_servizio', label: 'Capi Servizio' },
  { value: 'dipendente', label: 'Dipendenti' },
]

export function BachecaClient({
  initialBulletins, restaurants, dipendenti,
  currentUserId, currentUserRole, currentRestaurantId, canPost, isDirettore = false,
}: Props) {
  const [bulletins, setBulletins] = useState<BulletinWithRelations[]>(initialBulletins)

  // New bulletin form
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [targetType, setTargetType] = useState<BulletinTarget>('all')
  const [restaurantId, setRestaurantId] = useState(currentRestaurantId ?? '')
  const [targetRole, setTargetRole] = useState('capo_servizio')
  const [targetDepartment, setTargetDepartment] = useState(DEPARTMENTS[0])
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // Read receipt dialog
  const [viewingReadsFor, setViewingReadsFor] = useState<BulletinWithRelations | null>(null)
  const [reads, setReads] = useState<BulletinRead[]>([])
  const [loadingReads, setLoadingReads] = useState(false)

  // Contatori lettura per ogni bulletin (aggiornati al mount e dopo ogni nuova pubblicazione)
  const [readCounts, setReadCounts] = useState<Record<string, number>>({})

  // Espansione e tracciamento letture per capo_servizio
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sentReadIds, setSentReadIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!bulletins.length) return
    const supabase = createClient()
    supabase
      .from('bulletin_reads')
      .select('bulletin_id')
      .in('bulletin_id', bulletins.map(b => b.id))
      .then(({ data }) => {
        const counts: Record<string, number> = {}
        data?.forEach(r => {
          counts[r.bulletin_id] = (counts[r.bulletin_id] ?? 0) + 1
        })
        setReadCounts(counts)
      })
  }, [bulletins])

  // ── Realtime — un comunicato pubblicato o rimosso da un altro utente
  // (manager o capo servizio) compare/sparisce qui all'istante, senza
  // ricaricare la pagina. Stesso pattern di Turni/Presenze. La RLS fa sì
  // che si ricevano solo i comunicati a noi destinati. ────────────────
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('rt-bacheca')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bulletins' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id: string }).id
            setBulletins(bs => bs.filter(b => b.id !== deletedId))
            return
          }
          // INSERT/UPDATE: il payload non include le relazioni (autore/
          // ristorante), quindi rileggiamo la riga completa.
          const rec = payload.new as { id: string }
          const { data } = await supabase
            .from('bulletins')
            .select('*, restaurant:restaurants(id, name), author:profiles!created_by(id, full_name)')
            .eq('id', rec.id)
            .single()
          if (!data) return
          setBulletins(bs => {
            const exists = bs.some(b => b.id === data.id)
            return exists
              ? bs.map(b => b.id === data.id ? data as BulletinWithRelations : b)
              : [data as BulletinWithRelations, ...bs]
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  function handleToggle(b: BulletinWithRelations) {
    const opening = expandedId !== b.id
    setExpandedId(opening ? b.id : null)

    if (opening && !sentReadIds.has(b.id)) {
      setSentReadIds(prev => new Set(prev).add(b.id))
      const supabase = createClient()
      supabase
        .from('bulletin_reads')
        .upsert(
          [{ bulletin_id: b.id, user_id: currentUserId }],
          { onConflict: 'bulletin_id,user_id', ignoreDuplicates: true }
        )
        .then(() => {})
    }
  }

  function resetForm() {
    setTitle(''); setBody(''); setTargetType('all')
    setRestaurantId(currentRestaurantId ?? '')
    setTargetRole('capo_servizio'); setSelectedUserIds([])
    setTargetDepartment(DEPARTMENTS[0])
  }

  async function handleSave() {
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data } = await supabase
      .from('bulletins')
      .insert({
        title,
        body,
        target: targetType,
        restaurant_id: targetType === 'restaurant'
          ? (restaurantId || null)
          : (targetType === 'department' ? currentRestaurantId : null),
        target_roles: targetType === 'role' ? [targetRole] : [],
        target_user_ids: targetType === 'users' ? selectedUserIds : [],
        target_department: targetType === 'department' ? targetDepartment : null,
        created_by: user!.id,
      })
      .select('*, restaurant:restaurants(id, name), author:profiles!created_by(id, full_name)')
      .single()

    if (data) {
      setBulletins(bs => [data, ...bs])
      setReadCounts(prev => ({ ...prev, [data.id]: 0 }))
      // Fire-and-forget: invia notifica push agli utenti target
      fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulletinId: data.id }),
      }).catch(() => {})
    }
    resetForm()
    setShowForm(false)
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Eliminare questo comunicato?')) return
    const supabase = createClient()
    await supabase.from('bulletins').delete().eq('id', id)
    setBulletins(bs => bs.filter(b => b.id !== id))
  }

  async function openReads(bulletin: BulletinWithRelations) {
    setViewingReadsFor(bulletin)
    setReads([])
    setLoadingReads(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('bulletin_reads')
      .select('*, profile:profiles!user_id(id, full_name)')
      .eq('bulletin_id', bulletin.id)
      .order('read_at', { ascending: false })
    setReads((data as BulletinRead[]) ?? [])
    setLoadingReads(false)
  }

  function toggleUserId(id: string) {
    setSelectedUserIds(ids =>
      ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
    )
  }

  const canSave = !!title.trim() && !!body.trim() &&
    (targetType !== 'users' || selectedUserIds.length > 0)

  function TargetBadge({ b }: { b: BulletinWithRelations }) {
    if (b.target === 'all') return (
      <Badge variant="outline" className="gap-1 text-xs"><Globe className="w-3 h-3" /> Tutti</Badge>
    )
    if (b.target === 'restaurant') return (
      <Badge variant="outline" className="gap-1 text-xs"><Store className="w-3 h-3" /> {b.restaurant?.name ?? 'Ristorante'}</Badge>
    )
    if (b.target === 'role') return (
      <Badge variant="outline" className="gap-1 text-xs">
        <Users className="w-3 h-3" />
        {b.target_roles.map(r => ROLE_LABELS[r as Role] ?? r).join(', ')}
      </Badge>
    )
    if (b.target === 'department') return (
      <Badge variant="outline" className="gap-1 text-xs">
        <Store className="w-3 h-3" /> Reparto {b.target_department}
      </Badge>
    )
    return (
      <Badge variant="outline" className="gap-1 text-xs">
        <Users className="w-3 h-3" /> {b.target_user_ids.length} destinatari
      </Badge>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Bacheca</h1>
        {canPost && (
          <Button onClick={() => { resetForm(); setShowForm(true) }} size="sm">
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
          {bulletins.map(b => {
            const isManager = currentUserRole === 'manager'
            const isOpen = isManager || expandedId === b.id
            const canViewReads = isManager || (currentUserRole === 'capo_servizio' && canPost)
            return (
              <Card key={b.id}>
                <CardHeader className={isOpen ? 'pb-2' : 'pb-3'}>
                  <div className="flex items-start justify-between gap-3">
                    {!isManager ? (
                      <button
                        onClick={() => handleToggle(b)}
                        className="flex-1 text-left flex items-start gap-2 min-w-0"
                      >
                        <ChevronDown
                          className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <CardTitle className="text-base">{b.title}</CardTitle>
                            <TargetBadge b={b} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {b.author?.full_name && <>{b.author.full_name} · </>}
                            {formatInTimeZone(new Date(b.created_at), TZ, 'dd-MM-yyyy HH:mm')}
                          </p>
                        </div>
                      </button>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <CardTitle className="text-base">{b.title}</CardTitle>
                          <TargetBadge b={b} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {b.author?.full_name && <>{b.author.full_name} · </>}
                          {formatInTimeZone(new Date(b.created_at), TZ, 'dd-MM-yyyy HH:mm')}
                        </p>
                        {(readCounts[b.id] ?? 0) > 0 && (
                          <p className="text-xs text-muted-foreground/70 mt-0.5">
                            Letto da {readCounts[b.id]} {readCounts[b.id] === 1 ? 'persona' : 'persone'}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                      {canViewReads && (
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => openReads(b)}
                          className="text-muted-foreground hover:text-foreground dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-700/50"
                          title="Visualizza letture"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      )}
                      {isManager && (
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => handleDelete(b.id)}
                          className="text-destructive hover:text-destructive dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {isOpen && (
                  <CardContent className="pt-0">
                    <p className="text-sm whitespace-pre-wrap">{b.body}</p>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* New bulletin dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
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
              <Select value={targetType} onValueChange={v => setTargetType(v as BulletinTarget)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {isDirettore ? (
                    <>
                      <SelectItem value="all">Tutto il Ristorante</SelectItem>
                      <SelectItem value="department">Reparto Specifico</SelectItem>
                      <SelectItem value="users">Singolo Dipendente</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="all">Tutti</SelectItem>
                      <SelectItem value="role">Solo per ruolo</SelectItem>
                      <SelectItem value="users">Dipendenti specifici</SelectItem>
                      {restaurants.length > 0 && <SelectItem value="restaurant">Ristorante specifico</SelectItem>}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            {targetType === 'restaurant' && (
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

            {targetType === 'department' && (
              <div className="space-y-2">
                <Label>Reparto</Label>
                <Select value={targetDepartment} onValueChange={v => setTargetDepartment(v as typeof targetDepartment)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {targetType === 'role' && (
              <div className="space-y-2">
                <Label>Ruolo</Label>
                <Select value={targetRole} onValueChange={setTargetRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SELECTABLE_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {targetType === 'users' && (
              <div className="space-y-2">
                <Label>
                  Dipendenti
                  {selectedUserIds.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {selectedUserIds.length} selezionati
                    </span>
                  )}
                </Label>
                <div className="border border-input rounded-md divide-y divide-border max-h-48 overflow-y-auto">
                  {dipendenti.map(d => (
                    <label
                      key={d.id}
                      className="flex items-center gap-3 px-3 h-10 cursor-pointer hover:bg-muted transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(d.id)}
                        onChange={() => toggleUserId(d.id)}
                        className="shrink-0"
                      />
                      <span className="text-sm flex-1 truncate">{d.full_name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {ROLE_LABELS[d.role as Role] ?? d.role}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={saving || !canSave}>
              {saving ? <>Pubblicazione<LoadingDots /></> : 'Pubblica'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Read receipts dialog */}
      <Dialog open={!!viewingReadsFor} onOpenChange={() => setViewingReadsFor(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chi ha letto</DialogTitle>
            {viewingReadsFor && (
              <p className="text-sm text-muted-foreground mt-0.5 truncate">{viewingReadsFor.title}</p>
            )}
          </DialogHeader>
          {loadingReads ? (
            <div className="space-y-2 py-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-9 bg-muted animate-pulse rounded" />)}
            </div>
          ) : reads.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nessuno ha ancora letto questo comunicato.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {reads.map(r => (
                <div key={r.id} className="flex items-center justify-between py-2.5 gap-4">
                  <span className="text-sm font-medium">{r.profile?.full_name ?? '—'}</span>
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {formatInTimeZone(new Date(r.read_at), TZ, 'dd-MM-yyyy HH:mm')}
                  </span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingReadsFor(null)}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
