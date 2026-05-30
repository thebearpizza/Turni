'use client'
import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, Paperclip, Send } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import type { ConsultantMessage } from '@/types'

const TZ = 'Europe/Rome'

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
  const [file, setFile]               = useState<File | null>(null)
  const [sending, setSending]         = useState(false)
  const [sendError, setSendError]     = useState<string | null>(null)

  const loadMessages = useCallback(async () => {
    const res = await fetch(`/api/consultant-messages?consultantId=${userId}`)
    if (!res.ok) return
    const data: ConsultantMessage[] = await res.json()
    setMessages(data)
    // Derive managerId from the first message
    if (data.length > 0) setManagerId(data[0].manager_id)
    setLoading(false)
  }, [userId])

  useEffect(() => { loadMessages() }, [loadMessages])

  // Expand a message — marks it read if the current user is the recipient
  async function handleExpand(msg: ConsultantMessage) {
    const isAlreadyOpen = expandedId === msg.id
    setExpandedId(isAlreadyOpen ? null : msg.id)

    // Mark read if: message was sent by manager, consultant hasn't read it yet
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
      body: JSON.stringify({ path: attachment.path }),
    })
    if (!res.ok) { alert('Impossibile scaricare il file'); return }

    const { signedUrl, downloaded_at } = await res.json()

    // Update local state with downloaded_at timestamp
    if (downloaded_at) {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, downloaded_at } : m))
    }

    // Open the signed URL for download
    window.open(signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function handleSend() {
    if (!msgTitle.trim() || !msgBody.trim()) return
    if (!managerId) { setSendError('Nessun manager trovato'); return }
    setSending(true)
    setSendError(null)
    try {
      let attachments: Array<{ name: string; path: string }> = []

      if (file) {
        // Upload the file directly via a form submission to the upload API
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
        attachments = [{ name: file.name, path: uploaded.path }]
      }

      const res = await fetch('/api/consultant-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consultantId: managerId,  // when consultant sends, consultantId = managerId
          title: msgTitle,
          body: msgBody,
          attachments,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Errore invio')
      }
      setMsgTitle(''); setMsgBody(''); setFile(null); setShowCompose(false)
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
            <Label>Allegato <span className="text-muted-foreground font-normal">(opzionale)</span></Label>
            <input
              type="file"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-primary file:text-primary-foreground"
            />
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

      {messages.map(msg => {
        const isExpanded = expandedId === msg.id
        const fromMe = !msg.sent_by_manager
        return (
          <MessageRow
            key={msg.id}
            msg={msg}
            isExpanded={isExpanded}
            fromMe={fromMe}
            onExpand={() => handleExpand(msg)}
            onDownload={att => handleDownload(msg, att)}
          />
        )
      })}
    </div>
  )
}

function MessageRow({
  msg, isExpanded, fromMe, onExpand, onDownload,
}: {
  msg: ConsultantMessage
  isExpanded: boolean
  fromMe: boolean
  onExpand: () => void
  onDownload: (att: { name: string; path: string }) => void
}) {
  const unread = msg.sent_by_manager && !msg.read_at && !fromMe

  return (
    <div className={`border rounded-md overflow-hidden transition-colors ${unread ? 'border-primary/50 bg-primary/5' : 'border-border bg-card'}`}>
      {/* Header row — click to expand */}
      <button
        onClick={onExpand}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {unread && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
            <p className="text-sm font-medium truncate">{msg.title}</p>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fromMe ? 'Inviato da te' : 'Dal Manager'} · {fmtDate(msg.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {msg.attachments?.length > 0 && <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />}
          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          <p className="text-sm whitespace-pre-wrap">{msg.body}</p>

          {/* Attachments */}
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

          {/* Read / download receipts */}
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
