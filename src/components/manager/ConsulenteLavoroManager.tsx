'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  Plus, ChevronDown, ChevronUp, Trash2, Pencil, Paperclip, X,
  Clock, BriefcaseBusiness, Send, Eye, EyeOff, CornerDownLeft,
} from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { Profile, Restaurant, ConsultantMessage } from '@/types'
import { generateUnifiedPDF } from '@/lib/generateUnifiedPDF'
import { createClient } from '@/lib/supabase/client'

const TZ = 'Europe/Rome'
const MAX_BYTES = 10 * 1024 * 1024

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
  const [formName, setFormName]               = useState('')
  const [formUsername, setFormUsername]       = useState('')
  const [formPassword, setFormPassword]       = useState('')
  const [formNewPassword, setFormNewPassword] = useState('')
  const [showNewPwd, setShowNewPwd]           = useState(false)
  const [formRestaurants, setFormRestaurants] = useState<string[]>([])
  const [formHours, setFormHours]             = useState(false)
  const [formSaving, setFormSaving]           = useState(false)
  const [formError, setFormError]             = useState<string | null>(null)

  // Delete confirm
  const [deleteTarget, setDeleteTarget]   = useState<ConsultantProfile | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Per-consultant thread state
  const [threads, setThreads]   = useState<Record<string, ConsultantMessage[]>>({})
  const [threadLoading, setThreadLoading] = useState<Record<string, boolean>>({})

  // Compose message state (per consultant id → open)
  const [composeOpen, setComposeOpen]       = useState<Record<string, boolean>>({})
  const [composeTitle, setComposeTitle]     = useState<Record<string, string>>({})
  const [composeBody, setComposeBody]       = useState<Record<string, string>>({})
  const [composeFiles, setComposeFiles]     = useState<Record<string, File[]>>({})
  const [composeSending, setComposeSending] = useState<Record<string, boolean>>({})
  const [composeMerging, setComposeMerging] = useState<Record<string, boolean>>({})
  const [composeError, setComposeError]     = useState<Record<string, string | null>>({})

  // Message expand / delete / reply state
  const [msgExpanded, setMsgExpanded]   = useState<Record<string, string | null>>({})
  const [msgDeleting, setMsgDeleting]   = useState<Record<string, boolean>>({})
  const [deleteMsgTarget, setDeleteMsgTarget] = useState<{ consultantId: string; msg: ConsultantMessage } | null>(null)
  const [replyTo, setReplyTo]           = useState<Record<string, ConsultantMessage | null>>({})

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

  // Supabase Realtime — listen to all consultant_messages for this manager
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('consultant-messages-manager')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'consultant_messages', filter: `manager_id=eq.${managerId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const msg = payload.new as ConsultantMessage
            setThreads(prev => {
              const cId = msg.consultant_id
              if (!(cId in prev)) return prev          // thread not yet loaded — skip
              if (prev[cId].some(m => m.id === msg.id)) return prev  // duplicate guard
              return { ...prev, [cId]: [msg, ...prev[cId]] }
            })
          } else if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id: string }).id
            setThreads(prev => {
              const next: Record<string, ConsultantMessage[]> = {}
              for (const [cId, msgs] of Object.entries(prev)) {
                next[cId] = msgs.filter(m => m.id !== deletedId)
              }
              return next
            })
            setMsgExpanded(prev => {
              const next = { ...prev }
              for (const [cId, openId] of Object.entries(prev)) {
                if (openId === deletedId) next[cId] = null
              }
              return next
            })
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [managerId])

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
    setFormName(''); setFormUsername(''); setFormPassword(''); setFormNewPassword('')
    setShowNewPwd(false)
    setFormRestaurants([]); setFormHours(false)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(c: ConsultantProfile) {
    setEditTarget(c)
    setFormName(c.full_name)
    setFormUsername(c.username ?? '')
    setFormPassword('')
    setFormNewPassword('')
    setShowNewPwd(false)
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

        if (formNewPassword.trim()) {
          if (formNewPassword.length < 6) throw new Error('La password deve essere di almeno 6 caratteri')
          const pwRes = await fetch('/api/users/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: editTarget.id, password: formNewPassword }),
          })
          if (!pwRes.ok) { const e = await pwRes.json(); throw new Error(e.error) }
        }
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
  function handleReply(consultantId: string, msg: ConsultantMessage) {
    setReplyTo(prev => ({ ...prev, [consultantId]: msg }))
    setComposeOpen(prev => ({ ...prev, [consultantId]: true }))
    // Pre-fill subject only if compose is blank
    setComposeTitle(prev => ({
      ...prev,
      [consultantId]: prev[consultantId]?.trim() ? prev[consultantId] : `Re: ${msg.title}`,
    }))
  }

  async function handleSendMessage(consultantId: string) {
    const title = composeTitle[consultantId] ?? ''
    const body  = composeBody[consultantId] ?? ''
    if (!title.trim() || !body.trim()) return

    const filesToSend = composeFiles[consultantId] ?? []
    const total = filesToSend.reduce((sum, f) => sum + f.size, 0)
    if (total > MAX_BYTES) {
      setComposeError(prev => ({ ...prev, [consultantId]: 'Il limite massimo per gli allegati è di 10 MB totali' }))
      return
    }

    setComposeError(prev => ({ ...prev, [consultantId]: null }))

    try {
      const attachments: Array<{ name: string; path: string }> = []

      if (filesToSend.length > 0) {
        // Phase 1: merge & compress all files into one PDF client-side
        setComposeMerging(prev => ({ ...prev, [consultantId]: true }))
        const unifiedFile = await generateUnifiedPDF(filesToSend)
        setComposeMerging(prev => ({ ...prev, [consultantId]: false }))

        // Phase 2: upload the single unified PDF
        setComposeSending(prev => ({ ...prev, [consultantId]: true }))
        const fd = new FormData()
        fd.append('file', unifiedFile)
        fd.append('consultantId', consultantId)
        const uploadRes = await fetch('/api/consultant-messages/upload', { method: 'POST', body: fd })
        if (!uploadRes.ok) {
          const e = await uploadRes.json()
          throw new Error(e.error ?? 'Errore upload')
        }
        const uploaded = await uploadRes.json()
        attachments.push({ name: unifiedFile.name, path: uploaded.path })
      } else {
        setComposeSending(prev => ({ ...prev, [consultantId]: true }))
      }

      const res = await fetch('/api/consultant-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consultantId,
          title,
          body,
          attachments,
          reply_to_id: replyTo[consultantId]?.id ?? null,
        }),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error ?? 'Errore invio')
      }
      setComposeTitle(prev => ({ ...prev, [consultantId]: '' }))
      setComposeBody(prev => ({ ...prev, [consultantId]: '' }))
      setComposeFiles(prev => ({ ...prev, [consultantId]: [] }))
      setComposeOpen(prev => ({ ...prev, [consultantId]: false }))
      setReplyTo(prev => ({ ...prev, [consultantId]: null }))
      await loadThread(consultantId)
    } catch (e) {
      setComposeMerging(prev => ({ ...prev, [consultantId]: false }))
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

  async function handleMsgDelete(consultantId: string, msgId: string) {
    setMsgDeleting(prev => ({ ...prev, [msgId]: true }))
    const res = await fetch(`/api/consultant-messages?id=${msgId}`, { method: 'DELETE' })
    if (res.ok) {
      setThreads(prev => ({
        ...prev,
        [consultantId]: (prev[consultantId] ?? []).filter(m => m.id !== msgId),
      }))
      // Collapse if the deleted message was open
      setMsgExpanded(prev => ({
        ...prev,
        [consultantId]: prev[consultantId] === msgId ? null : prev[consultantId],
      }))
    }
    setMsgDeleting(prev => ({ ...prev, [msgId]: false }))
    setDeleteMsgTarget(null)
  }

  async function handleMsgDownload(consultantId: string, msg: ConsultantMessage, att: { name: string; path: string }) {
    const res = await fetch(`/api/consultant-messages/${msg.id}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: att.path, name: att.name }),
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
    const a = document.createElement('a')
    a.href = signedUrl
    a.download = att.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
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
                      {/* Reply context banner */}
                      {replyTo[c.id] && (
                        <div className="flex items-start gap-2 rounded-sm bg-primary/5 border border-primary/20 px-3 py-2 text-xs">
                          <CornerDownLeft className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <span className="text-muted-foreground">In risposta a: </span>
                            <span className="font-medium">&ldquo;{replyTo[c.id]!.title}&rdquo;</span>
                            <p className="text-muted-foreground truncate mt-0.5">
                              {replyTo[c.id]!.body.length > 80
                                ? replyTo[c.id]!.body.slice(0, 80) + '…'
                                : replyTo[c.id]!.body}
                            </p>
                          </div>
                          <button
                            onClick={() => setReplyTo(prev => ({ ...prev, [c.id]: null }))}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                            title="Annulla risposta"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
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
                        <Label className="text-xs">Allegati <span className="text-muted-foreground font-normal">(opzionale, max 10 MB totali — unificati in un unico PDF)</span></Label>
                        <input
                          type="file"
                          multiple
                          disabled={composeMerging[c.id] || composeSending[c.id]}
                          onChange={e => {
                            const incoming = Array.from(e.target.files ?? [])
                            // Reset immediately so the same file can be re-selected and
                            // subsequent picks don't accumulate inside the DOM input itself.
                            e.target.value = ''
                            const accumulated = [...(composeFiles[c.id] ?? []), ...incoming]
                            const total = accumulated.reduce((sum, f) => sum + f.size, 0)
                            if (total > MAX_BYTES) {
                              setComposeError(prev => ({ ...prev, [c.id]: `Il limite massimo è 10 MB (attuale: ${(total / 1024 / 1024).toFixed(1)} MB)` }))
                              return
                            }
                            setComposeError(prev => ({ ...prev, [c.id]: null }))
                            setComposeFiles(prev => ({ ...prev, [c.id]: accumulated }))
                          }}
                          className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-primary file:text-primary-foreground disabled:opacity-50"
                        />
                        {(composeFiles[c.id]?.length ?? 0) > 0 && !composeMerging[c.id] && (
                          <ul className="mt-1 space-y-1">
                            {composeFiles[c.id].map((file, idx) => (
                              <li key={idx} className="flex items-center justify-between gap-2 rounded bg-muted/60 px-2 py-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <Paperclip className="w-3 h-3 shrink-0 text-muted-foreground" />
                                  <span className="text-[10px] truncate">{file.name}</span>
                                  <span className="text-[10px] text-muted-foreground shrink-0">({(file.size / 1024).toFixed(0)} KB)</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setComposeFiles(prev => ({
                                    ...prev,
                                    [c.id]: (prev[c.id] ?? []).filter((_, i) => i !== idx),
                                  }))}
                                  className="shrink-0 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                  title="Rimuovi"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </li>
                            ))}
                            <p className="text-[10px] text-muted-foreground pt-0.5">
                              Totale: {(composeFiles[c.id].reduce((s, f) => s + f.size, 0) / 1024).toFixed(0)} KB · verranno unificati in un PDF
                            </p>
                          </ul>
                        )}
                        {composeMerging[c.id] && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400 animate-pulse">
                            Elaborazione e unificazione file in corso...
                          </p>
                        )}
                      </div>
                      {composeError[c.id] && <p className="text-xs text-destructive">{composeError[c.id]}</p>}
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setComposeOpen(prev => ({ ...prev, [c.id]: false }))}
                          disabled={composeMerging[c.id] || composeSending[c.id]}
                          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Annulla
                        </button>
                        <Button
                          size="sm"
                          onClick={() => handleSendMessage(c.id)}
                          disabled={composeMerging[c.id] || composeSending[c.id] || !composeTitle[c.id]?.trim() || !composeBody[c.id]?.trim()}
                          className="h-7 text-xs"
                        >
                          {composeMerging[c.id] ? 'Elaborazione...' : composeSending[c.id] ? 'Invio...' : 'Invia'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Message thread */}
                  {threadLoading[c.id] ? (
                    <p className="text-xs text-muted-foreground">Caricamento messaggi...</p>
                  ) : thread.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nessun messaggio ancora.</p>
                  ) : (() => {
                    // Build threaded display order: top-level newest-first,
                    // replies oldest-first directly below their parent.
                    const topLevel = thread
                      .filter(m => !m.reply_to_id)
                      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    const replyMap: Record<string, ConsultantMessage[]> = {}
                    thread.filter(m => !!m.reply_to_id).forEach(m => {
                      const pid = m.reply_to_id!
                      if (!replyMap[pid]) replyMap[pid] = []
                      replyMap[pid].push(m)
                    })
                    Object.values(replyMap).forEach(arr =>
                      arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                    )
                    const displayList = topLevel.flatMap(msg => [
                      { msg, isReply: false },
                      ...(replyMap[msg.id] ?? []).map(r => ({ msg: r, isReply: true })),
                    ])

                    return (
                      <div className="space-y-2">
                        {displayList.map(({ msg, isReply }) => {
                          const isExpanded = msgExpanded[c.id] === msg.id
                          const fromConsultant = !msg.sent_by_manager
                          const unread = fromConsultant && !msg.read_at

                          return (
                            <div
                              key={msg.id}
                              className={isReply ? 'ml-6 pl-3 border-l-2 border-primary/20' : ''}
                            >
                              <div className={`border rounded overflow-hidden ${unread ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'}`}>
                                <div className="flex items-center gap-1 pr-2">
                                  {/* Expand trigger */}
                                  <button
                                    onClick={() => handleMsgExpand(c.id, msg)}
                                    className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        {unread && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                                        {isReply && <CornerDownLeft className="w-3 h-3 text-primary/50 shrink-0" />}
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
                                  {/* Reply */}
                                  <button
                                    onClick={() => handleReply(c.id, msg)}
                                    className="shrink-0 p-1.5 rounded transition-colors text-muted-foreground hover:text-primary"
                                    title="Rispondi"
                                  >
                                    <CornerDownLeft className="w-3.5 h-3.5" />
                                  </button>
                                  {/* Delete */}
                                  <button
                                    onClick={() => setDeleteMsgTarget({ consultantId: c.id, msg })}
                                    disabled={msgDeleting[msg.id]}
                                    className="shrink-0 p-1.5 rounded transition-colors disabled:opacity-50 text-destructive hover:text-destructive dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                                    title="Elimina messaggio"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

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
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
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
              <>
                <p className="text-xs text-muted-foreground">Username: <span className="font-mono">{editTarget.username}</span> (non modificabile)</p>
                <div className="space-y-1.5">
                  <Label>Nuova password <span className="text-muted-foreground font-normal">(opzionale)</span></Label>
                  <div className="relative">
                    <Input
                      type={showNewPwd ? 'text' : 'password'}
                      value={formNewPassword}
                      onChange={e => setFormNewPassword(e.target.value)}
                      placeholder="Lascia vuoto per non modificare"
                      className="h-10 rounded-sm pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPwd(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </>
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

      {/* Delete message confirmation */}
      <Dialog open={!!deleteMsgTarget} onOpenChange={open => { if (!open) setDeleteMsgTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Elimina messaggio</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Sei sicuro di voler eliminare <strong>&ldquo;{deleteMsgTarget?.msg.title}&rdquo;</strong>?
            {(deleteMsgTarget?.msg.attachments?.length ?? 0) > 0
              ? " L'allegato verrà rimosso definitivamente."
              : ' Questa azione è irreversibile.'}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteMsgTarget(null)}
              disabled={!!deleteMsgTarget && msgDeleting[deleteMsgTarget.msg.id]}
              className="h-10 rounded-sm"
            >
              Annulla
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMsgTarget && handleMsgDelete(deleteMsgTarget.consultantId, deleteMsgTarget.msg.id)}
              disabled={!!deleteMsgTarget && msgDeleting[deleteMsgTarget.msg.id]}
              className="h-10 rounded-sm"
            >
              {deleteMsgTarget && msgDeleting[deleteMsgTarget.msg.id] ? 'Eliminazione...' : 'Conferma'}
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
