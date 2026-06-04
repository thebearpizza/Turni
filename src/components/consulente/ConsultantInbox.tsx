'use client'
import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, Paperclip, Send, CornerDownLeft, X } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import type { ConsultantMessage } from '@/types'
import { createClient } from '@/lib/supabase/client'

const TZ = 'Europe/Rome'
const MAX_BYTES = 10 * 1024 * 1024

function fmtDate(iso: string | null) {
  if (!iso) return null
  return formatInTimeZone(new Date(iso), TZ, 'dd-MM-yyyy HH:mm', { locale: it })
}

interface Props {
  userId: string
}

export function ConsultantInbox({ userId }: Props) {
  const [messages, setMessages]       = useState<ConsultantMessage[]>([])
  const [loading, setLoading]         = useState(true)
  const [expandedId, setExpandedId]   = useState<string | null>(null)
  const [managerId, setManagerId]     = useState<string | null>(null)

  // Compose state
  const [showCompose, setShowCompose] = useState(false)
  const [msgTitle, setMsgTitle]       = useState('')
  const [msgBody, setMsgBody]         = useState('')
  const [files, setFiles]             = useState<File[]>([])
  const [sending, setSending]         = useState(false)
  const [sendError, setSendError]     = useState<string | null>(null)
  const [replyToMsg, setReplyToMsg]   = useState<ConsultantMessage | null>(null)

  const loadMessages = useCallback(async () => {
    const res = await fetch(`/api/consultant-messages?consultantId=${userId}`)
    if (!res.ok) return
    const data: ConsultantMessage[] = await res.json()
    setMessages(data)
    if (data.length > 0) setManagerId(data[0].manager_id)
    setLoading(false)
  }, [userId])

  useEffect(() => { loadMessages() }, [loadMessages])

  // Supabase Realtime — reflect manager inserts and deletes without a page refresh
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('consultant-messages-inbox')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'consultant_messages', filter: `consultant_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const msg = payload.new as ConsultantMessage
            setMessages(prev => {
              if (prev.some(m => m.id === msg.id)) return prev  // duplicate guard
              return [msg, ...prev]
            })
            setManagerId(prev => prev ?? msg.manager_id)
          } else if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id: string }).id
            setMessages(prev => prev.filter(m => m.id !== deletedId))
            setExpandedId(prev => (prev === deletedId ? null : prev))
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])

  function handleReply(msg: ConsultantMessage) {
    setReplyToMsg(msg)
    setShowCompose(true)
    setMsgTitle(prev => prev.trim() ? prev : `Re: ${msg.title}`)
  }

  async function handleExpand(msg: ConsultantMessage) {
    const isAlreadyOpen = expandedId === msg.id
    setExpandedId(isAlreadyOpen ? null : msg.id)

    if (!isAlreadyOpen && msg.sent_by_manager && !msg.read_at) {
      const res = await fetch(`/api/consultant-messages/${msg.id}/read`, { method: 'POST' })
      if (res.ok) {
        const { read_at } = await res.json()
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read_at } : m))
      }
    }
  }

  async function handleDownload(msg: ConsultantMessage, attachment: { name: string; path: string }) {
    const res = await fetch(`/api/consultant-messages/${msg.id}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: attachment.path, name: attachment.name }),
    })
    if (!res.ok) { alert('Impossibile scaricare il file'); return }

    const { signedUrl, downloaded_at } = await res.json()

    if (downloaded_at) {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, downloaded_at } : m))
    }

    const a = document.createElement('a')
    a.href = signedUrl
    a.download = attachment.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    const total = selected.reduce((sum, f) => sum + f.size, 0)
    if (total > MAX_BYTES) {
      setSendError('Il limite massimo per gli allegati è di 10 MB totali')
      e.target.value = ''
      return
    }
    setSendError(null)
    setFiles(selected)
  }

  async function handleSend() {
    if (!msgTitle.trim() || !msgBody.trim()) return
    if (!managerId) { setSendError('Nessun manager trovato'); return }

    const total = files.reduce((sum, f) => sum + f.size, 0)
    if (total > MAX_BYTES) {
      setSendError('Il limite massimo per gli allegati è di 10 MB totali')
      return
    }

    setSending(true)
    setSendError(null)
    try {
      const attachments: Array<{ name: string; path: string }> = []

      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('consultantId', userId)

        const uploadRes = await fetch('/api/consultant-messages/upload', {
          method: 'POST',
          body: formData,
        })
        if (!uploadRes.ok) {
          const err = await uploadRes.json()
          throw new Error(err.error ?? 'Errore upload file')
        }
        const uploaded = await uploadRes.json()
        attachments.push({ name: file.name, path: uploaded.path })
      }

      const res = await fetch('/api/consultant-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consultantId: managerId,
          title: msgTitle,
          body: msgBody,
          attachments,
          reply_to_id: replyToMsg?.id ?? null,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Errore invio')
      }
      setMsgTitle(''); setMsgBody(''); setFiles([]); setShowCompose(false); setReplyToMsg(null)
      await loadMessages()
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Errore invio')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Caricamento messaggi...</p>
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Messaggi con il Manager</h2>
        <Button size="sm" variant="outline" onClick={() => setShowCompose(v => !v)}>
          <Send className="w-3.5 h-3.5 mr-1.5" />
          Nuovo messaggio
        </Button>
      </div>

      {showCompose && (
        <div className="border border-border rounded-md p-4 space-y-3 bg-card">
          {/* Reply context banner */}
          {replyToMsg && (
            <div className="flex items-start gap-2 rounded-sm bg-primary/5 border border-primary/20 px-3 py-2 text-xs">
              <CornerDownLeft className="w-3 h-3 text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className="text-muted-foreground">In risposta a: </span>
                <span className="font-medium">&ldquo;{replyToMsg.title}&rdquo;</span>
                <p className="text-muted-foreground truncate mt-0.5">
                  {replyToMsg.body.length > 80 ? replyToMsg.body.slice(0, 80) + '…' : replyToMsg.body}
                </p>
              </div>
              <button
                onClick={() => setReplyToMsg(null)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="Annulla risposta"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Oggetto</Label>
            <Input value={msgTitle} onChange={e => setMsgTitle(e.target.value)} placeholder="Oggetto del messaggio" className="h-9 rounded-sm" />
          </div>
          <div className="space-y-1.5">
            <Label>Messaggio</Label>
            <textarea
              value={msgBody}
              onChange={e => setMsgBody(e.target.value)}
              placeholder="Scrivi qui..."
              rows={4}
              className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              Allegati <span className="text-muted-foreground font-normal">(opzionale, max 10 MB totali)</span>
            </Label>
            <input
              type="file"
              multiple
              onChange={handleFileChange}
              className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-primary file:text-primary-foreground"
            />
            {files.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {files.length} file{files.length > 1 ? '' : ''} · {(files.reduce((s, f) => s + f.size, 0) / 1024).toFixed(0)} KB
              </p>
            )}
          </div>
          {sendError && <p className="text-xs text-destructive">{sendError}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowCompose(false)}>Annulla</Button>
            <Button size="sm" onClick={handleSend} disabled={sending || !msgTitle.trim() || !msgBody.trim()}>
              {sending ? 'Invio...' : 'Invia'}
            </Button>
          </div>
        </div>
      )}

      {messages.length === 0 && (
        <p className="text-sm text-muted-foreground">Nessun messaggio ancora. Il manager ti contatterà da qui.</p>
      )}

      {(() => {
        const topLevel = messages
          .filter(m => !m.reply_to_id)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        const replyMap: Record<string, ConsultantMessage[]> = {}
        messages.filter(m => !!m.reply_to_id).forEach(m => {
          const pid = m.reply_to_id!
          if (!replyMap[pid]) replyMap[pid] = []
          replyMap[pid].push(m)
        })
        Object.values(replyMap).forEach(arr =>
          arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        )
        return topLevel.flatMap(msg => [
          { msg, isReply: false },
          ...(replyMap[msg.id] ?? []).map(r => ({ msg: r, isReply: true })),
        ])
      })().map(({ msg, isReply }) => {
        const isExpanded = expandedId === msg.id
        const fromMe = !msg.sent_by_manager
        return (
          <div key={msg.id} className={isReply ? 'ml-6 border-l-2 border-primary/20 pl-3' : ''}>
            <MessageRow
              msg={msg}
              isExpanded={isExpanded}
              fromMe={fromMe}
              isReply={isReply}
              onExpand={() => handleExpand(msg)}
              onDownload={att => handleDownload(msg, att)}
              onReply={() => handleReply(msg)}
            />
          </div>
        )
      })}
    </div>
  )
}

function MessageRow({
  msg, isExpanded, fromMe, isReply, onExpand, onDownload, onReply,
}: {
  msg: ConsultantMessage
  isExpanded: boolean
  fromMe: boolean
  isReply?: boolean
  onExpand: () => void
  onDownload: (att: { name: string; path: string }) => void
  onReply: () => void
}) {
  const unread = msg.sent_by_manager && !msg.read_at && !fromMe

  return (
    <div className={`border rounded-md overflow-hidden transition-colors ${unread ? 'border-primary/50 bg-primary/5' : 'border-border bg-card'}`}>
      <div className="flex items-center gap-1 pr-2">
        <button
          onClick={onExpand}
          className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {unread && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
              {isReply && <CornerDownLeft className="w-3.5 h-3.5 text-primary/50 shrink-0" />}
              <p className="text-sm font-medium truncate">{msg.title}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {fromMe ? 'Inviato da te' : 'Dal Manager'} · {fmtDate(msg.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {msg.attachments?.length > 0 && <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />}
            {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </button>
        {/* Reply button */}
        <button
          onClick={onReply}
          className="shrink-0 p-1.5 rounded transition-colors text-muted-foreground hover:text-primary"
          title="Rispondi"
        >
          <CornerDownLeft className="w-4 h-4" />
        </button>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          <p className="text-sm whitespace-pre-wrap">{msg.body}</p>

          {msg.attachments?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Allegati</p>
              {msg.attachments.map((att, i) => (
                <button
                  key={i}
                  onClick={() => onDownload(att)}
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  {att.name}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-0.5 pt-1">
            {msg.read_at && !fromMe && (
              <p className="text-[11px] text-muted-foreground">Letto il: {fmtDate(msg.read_at)}</p>
            )}
            {msg.downloaded_at && !fromMe && (
              <p className="text-[11px] text-muted-foreground">Allegato scaricato il: {fmtDate(msg.downloaded_at)}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
