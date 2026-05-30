'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  Plus, ChevronDown, ChevronUp, Trash2, Pencil, Paperclip,
  Clock, BriefcaseBusiness, Send,
} from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { Profile, Restaurant, ConsultantMessage } from '@/types'

const TZ = 'Europe/Rome'

function fmtDate(iso: string | null) {
  if (!iso) return 'Mai'
  return formatInTimeZone(new Date(iso), TZ, 'dd-MM-yyyy HH:mm', { locale: it })
}

interface ConsultantProfile extends Pick<Profile, 'id' | 'full_name' | 'username' | 'last_active_at' | 'consultant_restaurant_ids' | 'can_view_hours'> {}

interface Props {
  managerId: string
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
}

export function ConsulenteLavoroManager({ managerId, restaurants }: Props) {
  const [consultants, setConsultants]     = useState<ConsultantProfile[]>([])
  const [loadingList, setLoadingList]     = useState(true)
  const [expandedId, setExpandedId]       = useState<string | null>(null)

  // Create / edit modal
  const [modalOpen, setModalOpen]         = useState(false)
  const [editTarget, setEditTarget]       = useState<ConsultantProfile | null>(null)
  const [formName, setFormName]           = useState('')
  const [formUsername, setFormUsername]   = useState('')
  const [formPassword, setFormPassword]   = useState('')
  const [formRestaurants, setFormRestaurants] = useState<string[]>([])
  const [formHours, setFormHours]         = useState(false)
  const [formSaving, setFormSaving]       = useState(false)
  const [formError, setFormError]         = useState<string | null>(null)

  // Delete confirm
  const [deleteTarget, setDeleteTarget]   = useState<ConsultantProfile | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Per-consultant thread state
  const [threads, setThreads]   = useState<Record<string, ConsultantMessage[]>>({})
  const [threadLoading, setThreadLoading] = useState<Record<string, boolean>>({})

  // Compose message state (per consultant id → open)
  const [composeOpen, setComposeOpen]     = useState<Record<string, boolean>>({})
  const [composeTitle, setComposeTitle]   = useState<Record<string, string>>({})
  const [composeBody, setComposeBody]     = useState<Record<string, string>>({})
  const [composeFile, setComposeFile]     = useState<Record<string, File | null>>({})
  const [composeSending, setComposeSending] = useState<Record<string, boolean>>({})
  const [composeError, setComposeError]   = useState<Record<string, string | null>>({})

  // Message expand state
  const [msgExpanded, setMsgExpanded]     = useState<Record<string, string | null>>({})

  const loadConsultants = useCallback(async () => {
    setLoadingList(true)
    const res = await fetch('/api/users?role=consulente_lavoro')
    if (res.ok) {
      const data = await res.json()
      setConsultants(data)
    }
    setLoadingList(false)
  }, [])

  useEffect(() => { loadConsultants() }, [loadConsultants])

  async function loadThread(consultantId: string) {
    setThreadLoading(prev => ({ ...prev, [consultantId]: true }))
    const res = await fetch(`/api/consultant-messages?consultantId=${consultantId}`)
    if (res.ok) {
      const data: ConsultantMessage[] = await res.json()
      setThreads(prev => ({ ...prev, [consultantId]: data }))
    }
    setThreadLoading(prev => ({ ...prev, [consultantId]: false }))
  }

  function handleAccordionToggle(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
    } else {
      setExpandedId(id)
      if (!threads[id]) loadThread(id)
    }
  }

  // ── Create / edit consultant ──────────────────────────────────────────────
  function openCreate() {
    setEditTarget(null)
    setFormName(''); setFormUsername(''); setFormPassword('')
    setFormRestaurants([]); setFormHours(false)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(c: ConsultantProfile) {
    setEditTarget(c)
    setFormName(c.full_name)
    setFormUsername(c.username ?? '')
    setFormPassword('')
    setFormRestaurants(c.consultant_restaurant_ids ?? [])
    setFormHours(c.can_view_hours)
    setFormError(null)
    setModalOpen(true)
  }

  function toggleFormRestaurant(id: string) {
    setFormRestaurants(prev =>
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    )
  }

  async function handleSave() {
    setFormSaving(true)
    setFormError(null)
    try {
      if (editTarget) {
        const res = await fetch('/api/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editTarget.id,
            full_name: formName,
            role: 'consulente_lavoro',
            consultant_restaurant_ids: formRestaurants,
            can_view_hours: formHours,
            can_post_bulletin: false,
          }),
        })
        if (!res.ok) { const e = await res.json(); throw new Error(e.error) }
      } else {
        if (!formUsername.trim() || !formPassword.trim() || !formName.trim()) {
          throw new Error('Username, password e nome sono obbligatori')
        }
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: formUsername,
            password: formPassword,
            full_name: formName,
            role: 'consulente_lavoro',
            consultant_restaurant_ids: formRestaurants,
            can_view_hours: formHours,
            can_post_bulletin: false,
          }),
        })
        if (!res.ok) { const e = await res.json(); throw new Error(e.error) }
      }
      setModalOpen(false)
      await loadConsultants()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Errore salvataggio')
    } finally {
      setFormSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteLoading(true)
    const res = await fetch(`/api/users?id=${deleteTarget.id}`, { method: 'DELETE' })
    if (res.ok) {
      setDeleteTarget(null)
      await loadConsultants()
    }
    setDeleteLoading(false)
  }

  // ── Messaging ─────────────────────────────────────────────────────────────
  async function handleSendMessage(consultantId: string) {
    const title = composeTitle[consultantId] ?? ''
    const body  = composeBody[consultantId] ?? ''
    if (!title.trim() || !body.trim()) return

    setComposeSending(prev => ({ ...prev, [consultantId]: true }))
    setComposeError(prev => ({ ...prev, [consultantId]: null }))
    try {
      let attachments: Array<{ name: string; path: string }> = []
      const file = composeFile[consultantId]
      if (file) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('consultantId', consultantId)
        const uploadRes = await fetch('/api/consultant-messages/upload', { method: 'POST', body: fd })
        if (!uploadRes.ok) {
          const e = await uploadRes.json()
          throw new Error(e.error ?? 'Errore upload')
        }
        const uploaded = await uploadRes.json()
        attachments = [{ name: file.name, path: uploaded.path }]
      }

      const res = await fetch('/api/consultant-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consultantId, title, body, attachments }),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error ?? 'Errore invio')
      }
      setComposeTitle(prev => ({ ...prev, [consultantId]: '' }))
      setComposeBody(prev => ({ ...prev, [consultantId]: '' }))
      setComposeFile(prev => ({ ...prev, [consultantId]: null }))
      setComposeOpen(prev => ({ ...prev, [consultantId]: false }))
      await loadThread(consultantId)
    } catch (e) {
      setComposeError(prev => ({ ...prev, [consultantId]: e instanceof Error ? e.message : 'Errore' }))
    } finally {
      setComposeSending(prev => ({ ...prev, [consultantId]: false }))
    }
  }

  async function handleMsgExpand(consultantId: string, msg: ConsultantMessage) {
    const currentOpen = msgExpanded[consultantId]
    const isAlreadyOpen = currentOpen === msg.id

    setMsgExpanded(prev => ({ ...prev, [consultantId]: isAlreadyOpen ? null : msg.id }))

    // Mark as read if manager is reading a consultant reply
    if (!isAlreadyOpen && !msg.sent_by_manager && !msg.read_at) {
      const res = await fetch(`/api/consultant-messages/${msg.id}/read`, { method: 'POST' })
      if (res.ok) {
        const { read_at } = await res.json()
        setThreads(prev => ({
          ...prev,
          [consultantId]: (prev[consultantId] ?? []).map(m =>
            m.id === msg.id ? { ...m, read_at } : m
          ),
        }))
      }
    }
  }

  async function handleMsgDownload(consultantId: string, msg: ConsultantMessage, att: { name: string; path: string }) {
    const res = await fetch(`/api/consultant-messages/${msg.id}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: att.path }),
    })
    if (!res.ok) { alert('Impossibile generare il link'); return }
    const { signedUrl, downloaded_at } = await res.json()
    if (downloaded_at) {
      setThreads(prev => ({
        ...prev,
        [consultantId]: (prev[consultantId] ?? []).map(m =>
          m.id === msg.id ? { ...m, downloaded_at } : m
        ),
      }))
    }
    window.open(signedUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="mt-6">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BriefcaseBusiness className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Consulenti del Lavoro</h2>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 h-9 px-3 rounded-sm text-sm font-medium border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Nuovo Consulente
        </button>
      </div>

      {loadingList && (
        <p className="text-sm text-muted-foreground">Caricamento...</p>
      )}
      {!loadingList && consultants.length === 0 && (
        <p className="text-sm text-muted-foreground">Nessun consulente creato.</p>
      )}

      {/* Consultant list */}
      <div className="space-y-2">
        {consultants.map(c => {
          const isOpen = expandedId === c.id
          const thread = threads[c.id] ?? []
          const hasUnread = thread.some(m => !m.sent_by_manager && !m.read_at)

          return (
            <div key={c.id} className="border border-border rounded-md overflow-hidden bg-card">
              {/* Row */}
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Left: name + meta */}
                <button
                  className="flex-1 min-w-0 flex flex-col items-start text-left"
                  onClick={() => handleAccordionToggle(c.id)}
                >
                  <div className="flex items-center gap-2">
                    {hasUnread && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                    <span className="text-sm font-medium truncate">{c.full_name}</span>
                    <span className="text-xs text-muted-foreground">({c.username})</span>
                  </div>
                  <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" />
                    Ultimo accesso: {fmtDate(c.last_active_at)}
                  </span>
                </button>

                {/* Right: edit / delete / expand */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(c)}
                    className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground"
                    title="Modifica"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(c)}
                    className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-destructive"
                    title="Elimina"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleAccordionToggle(c.id)}
                    className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground"
                  >
                    {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Accordion — private message thread */}
              {isOpen && (
                <div className="border-t border-border bg-muted/30 p-4 space-y-4">
                  {/* Compose toggle */}
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bacheca Privata</p>
                    <button
                      onClick={() => setComposeOpen(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <Send className="w-3 h-3" />
                      Nuovo messaggio
                    </button>
                  </div>

                  {/* Compose form */}
                  {composeOpen[c.id] && (
                    <div className="border border-border rounded-md p-3 space-y-2.5 bg-card">
                      <div className="space-y-1">
                        <Label className="text-xs">Oggetto</Label>
                        <Input
                          value={composeTitle[c.id] ?? ''}
                          onChange={e => setComposeTitle(prev => ({ ...prev, [c.id]: e.target.value }))}
                          placeholder="Oggetto"
                          className="h-8 text-sm rounded-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Messaggio</Label>
                        <textarea
                          value={composeBody[c.id] ?? ''}
                          onChange={e => setComposeBody(prev => ({ ...prev, [c.id]: e.target.value }))}
                          rows={3}
                          placeholder="Scrivi qui..."
                          className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Allegato <span className="text-muted-foreground font-normal">(opzionale)</span></Label>
                        <input
                          type="file"
                          onChange={e => setComposeFile(prev => ({ ...prev, [c.id]: e.target.files?.[0] ?? null }))}
                          className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-primary file:text-primary-foreground"
                        />
                      </div>
                      {composeError[c.id] && <p className="text-xs text-destructive">{composeError[c.id]}</p>}
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setComposeOpen(prev => ({ ...prev, [c.id]: false }))}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Annulla
                        </button>
                        <Button
                          size="sm"
                          onClick={() => handleSendMessage(c.id)}
                          disabled={composeSending[c.id] || !composeTitle[c.id]?.trim() || !composeBody[c.id]?.trim()}
                          className="h-7 text-xs"
                        >
                          {composeSending[c.id] ? 'Invio...' : 'Invia'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Message thread */}
                  {threadLoading[c.id] ? (
                    <p className="text-xs text-muted-foreground">Caricamento messaggi...</p>
                  ) : thread.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nessun messaggio ancora.</p>
                  ) : (
                    <div className="space-y-2">
                      {thread.map(msg => {
                        const isExpanded = msgExpanded[c.id] === msg.id
                        const fromConsultant = !msg.sent_by_manager
                        const unread = fromConsultant && !msg.read_at

                        return (
                          <div key={msg.id} className={`border rounded overflow-hidden ${unread ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'}`}>
                            <button
                              onClick={() => handleMsgExpand(c.id, msg)}
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  {unread && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                                  <p className="text-xs font-medium truncate">{msg.title}</p>
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                  {fromConsultant ? `Da ${c.full_name}` : 'Da te'} · {fmtDate(msg.created_at)}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {msg.attachments?.length > 0 && <Paperclip className="w-3 h-3 text-muted-foreground" />}
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                              </div>
                            </button>

                            {isExpanded && (
                              <div className="px-3 pb-3 pt-2 border-t border-border space-y-2">
                                <p className="text-xs whitespace-pre-wrap">{msg.body}</p>

                                {msg.attachments?.length > 0 && (
                                  <div className="space-y-1">
                                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Allegati</p>
                                    {msg.attachments.map((att, i) => (
                                      <button
                                        key={i}
                                        onClick={() => handleMsgDownload(c.id, msg, att)}
                                        className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                                      >
                                        <Paperclip className="w-3 h-3" />
                                        {att.name}
                                      </button>
                                    ))}
                                  </div>
                                )}

                                {/* Receipts */}
                                <div className="space-y-0.5 pt-0.5">
                                  {msg.read_at && msg.sent_by_manager && (
                                    <p className="text-[10px] text-muted-foreground">Letto il: {fmtDate(msg.read_at)}</p>
                                  )}
                                  {msg.downloaded_at && msg.sent_by_manager && (
                                    <p className="text-[10px] text-muted-foreground">Allegato scaricato il: {fmtDate(msg.downloaded_at)}</p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Create / Edit modal */}
      <Dialog open={modalOpen} onOpenChange={open => { if (!open) setModalOpen(false) }}>
        <DialogContent onInteractOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Modifica Consulente' : 'Nuovo Consulente del Lavoro'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome completo</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Es. Mario Rossi" className="h-10 rounded-sm" />
            </div>

            {!editTarget && (
              <>
                <div className="space-y-1.5">
                  <Label>Username</Label>
                  <Input value={formUsername} onChange={e => setFormUsername(e.target.value)} placeholder="Es. mario.rossi" className="h-10 rounded-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label>Password</Label>
                  <Input type="password" value={formPassword} onChange={e => setFormPassword(e.target.value)} placeholder="Min. 6 caratteri" className="h-10 rounded-sm" />
                </div>
              </>
            )}

            {editTarget && (
              <p className="text-xs text-muted-foreground">Username: <span className="font-mono">{editTarget.username}</span> (non modificabile)</p>
            )}

            <div className="space-y-1.5">
              <Label>Ristoranti autorizzati</Label>
              <div className="flex flex-wrap gap-2">
                {restaurants.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggleFormRestaurant(r.id)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      formRestaurants.includes(r.id)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-border text-foreground hover:bg-accent'
                    }`}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
              {formRestaurants.length === 0 && (
                <p className="text-xs text-muted-foreground">Nessun ristorante selezionato</p>
              )}
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formHours}
                onChange={e => setFormHours(e.target.checked)}
                className="w-4 h-4 rounded accent-primary"
              />
              <span className="text-sm">Visualizzazione report ore</span>
            </label>
          </div>

          {formError && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{formError}</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={formSaving} className="h-10 rounded-sm">
              Annulla
            </Button>
            <Button onClick={handleSave} disabled={formSaving} className="h-10 rounded-sm">
              {formSaving ? 'Salvataggio...' : editTarget ? 'Salva modifiche' : 'Crea consulente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Elimina consulente</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Stai per eliminare <strong>{deleteTarget?.full_name}</strong>. Questa azione è irreversibile e rimuoverà anche tutti i messaggi.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteLoading} className="h-10 rounded-sm">
              Annulla
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading} className="h-10 rounded-sm">
              {deleteLoading ? 'Eliminazione...' : 'Elimina'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
