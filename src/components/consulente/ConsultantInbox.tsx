'use client'
import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import type { ConsultantMessage } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'

const TZ = 'Europe/Rome'
const MAX_BYTES = 10 * 1024 * 1024

function fmtDate(iso: string | null) {
  if (!iso) return null
  return formatInTimeZone(new Date(iso), TZ, 'd MMM · HH:mm', { locale: it })
}

function useTelefono() {
  return useSyncExternalStore(
    cb => { const mq = window.matchMedia('(max-width: 639px)'); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb) },
    () => window.matchMedia('(max-width: 639px)').matches,
    () => false
  )
}

const SWAPIN = 'swapin 680ms cubic-bezier(0.22,1,0.36,1) both'
const SWAPOUT = 'swapout 320ms cubic-bezier(0.4,0,1,1) both'
const Clip = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" /></svg>
)
const IconaX = ({ s = 20 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
)
const Piu = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M5 12h14" /><path d="M12 5v14" /></svg>
)
const Rispondi = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 14l-5-5 5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v5" /></svg>
)

interface Props {
  userId: string
  // Manager di riferimento risolto dal server (dai ristoranti assegnati al
  // consulente): senza, un consulente la cui casella è ancora vuota non
  // avrebbe alcun destinatario per il primo messaggio.
  initialManagerId?: string | null
}

// Messaggi del consulente con il manager, nello stesso linguaggio della
// scheda Report (MTReport): lista in un riquadro con scroll interno, voci
// a 68px con badge a pillola, nuovo messaggio in un foglio che entra con
// swapin come il foglio "Salva giorno".
export function ConsultantInbox({ userId, initialManagerId = null }: Props) {
  const tel = useTelefono()
  const [composeEsce, setComposeEsce] = useState(false)
  const tC = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  function apriCompose() { if (tC.current) clearTimeout(tC.current); setComposeEsce(false); setShowCompose(true) }
  function chiudiCompose(forza = false) {
    if (sending && !forza) return
    setComposeEsce(true)
    if (tC.current) clearTimeout(tC.current)
    tC.current = setTimeout(() => { setShowCompose(false); setComposeEsce(false); setReplyToMsg(null); setSendError(null) }, 320)
  }
  const [messages, setMessages]       = useState<ConsultantMessage[]>([])
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState(false)
  const [expandedId, setExpandedId]   = useState<string | null>(null)
  const [managerId, setManagerId]     = useState<string | null>(initialManagerId)

  // Compose state
  const [showCompose, setShowCompose] = useState(false)
  const [msgTitle, setMsgTitle]       = useState('')
  const [msgBody, setMsgBody]         = useState('')
  const [files, setFiles]             = useState<File[]>([])
  const [sending, setSending]         = useState(false)
  const [sendError, setSendError]     = useState<string | null>(null)
  const [replyToMsg, setReplyToMsg]   = useState<ConsultantMessage | null>(null)

  const loadMessages = useCallback(async () => {
    setLoadError(false)
    const res = await fetch(`/api/consultant-messages?consultantId=${userId}`)
    if (!res.ok) { setLoading(false); setLoadError(true); return }
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

  // La lista mostra un solo livello di annidamento (messaggi in cima,
  // risposte indentate sotto): rispondere a una risposta deve quindi
  // agganciarsi sempre alla radice della conversazione, altrimenti quel
  // messaggio finirebbe con un reply_to_id che punta a un elemento non in
  // cima alla lista e non verrebbe mai disegnato.
  function rootOf(msg: ConsultantMessage): ConsultantMessage {
    let current = msg
    while (current.reply_to_id) {
      const parent = messages.find(m => m.id === current.reply_to_id)
      if (!parent) break
      current = parent
    }
    return current
  }

  function handleReply(msg: ConsultantMessage) {
    // Il banner "In risposta a" mostra il messaggio su cui si è premuto
    // Rispondi (per contesto), ma reply_to_id salvato è quello della radice.
    setReplyToMsg(msg)
    apriCompose()
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
    if (!res.ok) { toast({ title: 'Download dell’allegato non riuscito', variant: 'destructive' }); return }

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
    // Gli allegati si aggiungono a quelli già scelti (si tolgono uno per uno).
    const selected = [...files, ...Array.from(e.target.files ?? [])]
    e.target.value = ''
    const total = selected.reduce((sum, f) => sum + f.size, 0)
    if (total > MAX_BYTES) {
      setSendError('Il limite massimo per gli allegati è di 10 MB totali')
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
          reply_to_id: replyToMsg ? rootOf(replyToMsg).id : null,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Errore invio')
      }
      setMsgTitle(''); setMsgBody(''); setFiles([])
      toast({ title: 'Messaggio inviato al manager' })
      setSending(false)
      chiudiCompose(true)
      await loadMessages()
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Errore invio'
      setSendError(m)
      toast({ title: `Invio non riuscito · ${m}`, variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  useEffect(() => () => { if (tC.current) clearTimeout(tC.current) }, [])

  const campo = 'box-border w-full rounded-[6px] border border-line-strong bg-card px-3.5 text-[15px] outline-none transition-colors focus:border-[oklch(0.58_0.12_180)]'
  const thread = (() => {
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
  })()

  return (
    <div className="box-border flex h-full flex-col gap-3 px-4 sm:px-8">
      <div className="flex flex-none items-center gap-2.5">
        <span className="flex-1 text-[15px] font-semibold">Messaggi con il manager</span>
        <button type="button" onClick={() => { setReplyToMsg(null); apriCompose() }}
          className="flex h-10 flex-none items-center gap-2 rounded-[8px] border border-line-strong px-[14px] text-sm font-medium transition-transform active:scale-[0.97]">
          <Piu /> Nuovo messaggio
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-border bg-card"
        style={{ animation: 'swapin 520ms cubic-bezier(0.22,1,0.36,1) backwards' }}>
        {loadError ? (
          <div className="anim-swapin flex flex-1 flex-col items-center justify-center gap-1 px-[18px] py-12 text-center text-pretty">
            <span className="text-[15px] font-semibold text-[oklch(0.45_0.1_25)] dark:text-neg">Caricamento non riuscito</span>
            <span className="text-[13px] text-muted-foreground">Impossibile caricare i messaggi. Riprova.</span>
            <button type="button" onClick={() => { setLoading(true); loadMessages() }} className="mt-3 flex h-11 items-center gap-2 rounded-[12px] border border-line-strong bg-card px-[18px] text-sm font-semibold transition-transform duration-150 active:scale-[0.97]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></svg>
              Riprova
            </button>
          </div>
        ) : loading ? (
          <div className="flex flex-col">
            {[64, 48, 72, 40].map(w => (
              <div key={w} className="flex min-h-[68px] flex-col justify-center gap-2 border-b border-border px-[18px]">
                <div className="h-3.5 rounded-[6px] bg-[linear-gradient(90deg,var(--sk-a)_25%,var(--sk-b)_50%,var(--sk-a)_75%)] bg-[length:200%_100%] [animation:sk-sh_1.4s_linear_infinite]" style={{ width: `${w}%` }} />
                <div className="h-2.5 w-28 rounded-[5px] bg-[linear-gradient(90deg,var(--sk-a)_25%,var(--sk-b)_50%,var(--sk-a)_75%)] bg-[length:200%_100%] [animation:sk-sh_1.4s_linear_infinite]" />
              </div>
            ))}
          </div>
        ) : thread.length === 0 ? (
          <div className="anim-swapin flex flex-1 flex-col items-center justify-center gap-1 px-[18px] py-12 text-center text-pretty">
            <span className="text-[15px] font-semibold">Nessun messaggio</span>
            <span className="text-[13px] text-muted-foreground">Il manager ti contatterà da qui. Puoi anche scrivergli tu.</span>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {thread.map(({ msg, isReply }, i) => (
              <MessageRow
                key={msg.id}
                msg={msg}
                ritardo={i * 70}
                isExpanded={expandedId === msg.id}
                fromMe={!msg.sent_by_manager}
                isReply={isReply}
                onExpand={() => handleExpand(msg)}
                onDownload={att => handleDownload(msg, att)}
                onReply={() => handleReply(msg)}
              />
            ))}
          </div>
        )}
      </div>

      {showCompose && createPortal(
        <div onClick={() => chiudiCompose()} className={cn('fixed inset-0 z-[70] box-border flex justify-center', tel ? 'items-end pt-[72px]' : 'items-start px-4 pt-[150px]')}
          style={{ background: composeEsce ? 'rgba(15,20,30,0)' : 'rgba(15,20,30,.28)', transition: 'background 320ms' }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Nuovo messaggio"
            className={cn('box-border flex max-h-full flex-col overflow-y-auto overscroll-contain border border-border bg-card text-foreground shadow-[0_20px_60px_rgba(20,30,50,.18)]',
              tel ? 'w-full rounded-t-[20px] pb-[calc(env(safe-area-inset-bottom)+20px)]' : 'w-[560px] max-w-full rounded-[14px]')}
            style={{ animation: composeEsce ? SWAPOUT : SWAPIN }}>
            <div className="flex items-center gap-3 border-b border-border px-[22px] py-[18px]">
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-xl font-semibold">{replyToMsg ? 'Rispondi' : 'Nuovo messaggio'}</span>
                <span className="text-sm text-muted-foreground">Al manager dei tuoi locali</span>
              </div>
              <button type="button" onClick={() => chiudiCompose()} aria-label="Chiudi" className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-transform active:scale-[0.96]"><IconaX /></button>
            </div>
            <div className="flex flex-col gap-4 px-[22px] py-[18px]">
              {replyToMsg && (
                <div className="flex items-start gap-2.5 rounded-[8px] bg-secondary px-3 py-2.5">
                  <span className="mt-0.5 text-muted-foreground"><Rispondi /></span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">In risposta a “{replyToMsg.title}”</span>
                    <span className="block truncate text-xs text-muted-foreground">{replyToMsg.body}</span>
                  </div>
                  <button type="button" onClick={() => setReplyToMsg(null)} aria-label="Annulla risposta" className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-muted-foreground"><IconaX s={14} /></button>
                </div>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">Oggetto</span>
                <input value={msgTitle} onChange={e => setMsgTitle(e.target.value)} placeholder="Oggetto del messaggio" className={cn(campo, 'h-[52px]')} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">Messaggio</span>
                <textarea value={msgBody} onChange={e => setMsgBody(e.target.value)} placeholder="Scrivi qui…" rows={5} className={cn(campo, 'resize-none py-3 leading-snug')} />
              </label>
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-medium">Allegati <span className="font-normal text-muted-foreground">· facoltativi, max 10 MB in tutto</span></span>
                {files.map((f, i) => (
                  <div key={i} className="flex h-11 items-center gap-2 rounded-[8px] border border-border px-3 text-[13px]">
                    <span className="text-muted-foreground"><Clip /></span>
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                    <button type="button" onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))} aria-label={`Togli ${f.name}`} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground"><IconaX s={14} /></button>
                  </div>
                ))}
                <input ref={fileRef} type="file" multiple onChange={handleFileChange} className="hidden" />
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex h-10 items-center gap-1.5 self-start rounded-[8px] border border-dashed border-[oklch(0.75_0.01_250)] px-3 text-[13px] font-medium transition-transform active:scale-[0.97] dark:border-line-strong">
                  <Piu /> Aggiungi allegato
                </button>
              </div>
              {sendError && <span className="text-[13px] font-medium text-[oklch(0.45_0.1_25)] dark:text-neg">{sendError}</span>}
              <div className="grid grid-cols-[1fr_2fr] gap-2.5">
                <button type="button" onClick={() => chiudiCompose()} disabled={sending} className="flex h-[52px] items-center justify-center rounded-[6px] border border-line-strong text-[15px] font-medium transition-transform active:scale-[0.98]">Annulla</button>
                <button type="button" onClick={handleSend} disabled={sending || !msgTitle.trim() || !msgBody.trim()}
                  className={cn('flex h-[52px] items-center justify-center rounded-[6px] bg-primary text-[15px] font-semibold text-primary-foreground transition-transform active:scale-[0.98]', (sending || !msgTitle.trim() || !msgBody.trim()) && 'opacity-50')}>
                  {sending ? 'Invio…' : 'Invia'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function MessageRow({
  msg, isExpanded, fromMe, isReply, ritardo, onExpand, onDownload, onReply,
}: {
  msg: ConsultantMessage
  isExpanded: boolean
  fromMe: boolean
  isReply?: boolean
  ritardo: number
  onExpand: () => void
  onDownload: (att: { name: string; path: string }) => void
  onReply: () => void
}) {
  const unread = msg.sent_by_manager && !msg.read_at && !fromMe
  const nAll = msg.attachments?.length ?? 0

  return (
    <div className={cn('border-b border-border', unread && 'bg-[oklch(0.985_0.01_75)] dark:bg-warn-tint/40')}
      style={{ animation: 'inrise 600ms cubic-bezier(0.16,1,0.3,1) both', animationDelay: `${ritardo}ms` }}>
      <button type="button" onClick={onExpand} aria-expanded={isExpanded}
        className={cn('grid min-h-[68px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-3 pr-[18px] text-left transition-transform active:scale-[0.99]', isReply ? 'pl-10' : 'pl-[18px]')}>
        <span className="truncate text-[15px] font-medium">{msg.title}</span>
        <span className="flex justify-end">
          {unread
            ? <span className="rounded-full bg-warn-tint px-[9px] py-[3px] text-[10px] font-semibold uppercase tracking-[.05em] text-warn">Da leggere</span>
            : nAll > 0 ? <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground"><Clip />{nAll}</span> : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">{isReply ? 'Risposta · ' : ''}{fromMe ? 'Inviato da te' : 'Dal manager'} · {fmtDate(msg.created_at)}</span>
        <span className="flex justify-end">
          {unread && nAll > 0 && <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground"><Clip />{nAll}</span>}
        </span>
      </button>

      {isExpanded && (
        <div className={cn('anim-swapin flex flex-col gap-3 pb-4 pr-[18px]', isReply ? 'pl-10' : 'pl-[18px]')}>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.body}</p>
          {nAll > 0 && (
            <div className="flex flex-wrap gap-2">
              {msg.attachments.map((att, i) => (
                <button key={i} type="button" onClick={() => onDownload(att)}
                  className="flex h-10 max-w-full items-center gap-2 rounded-[8px] border border-line-strong px-3 text-[13px] font-medium transition-transform active:scale-[0.97]">
                  <Clip /><span className="truncate">{att.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {msg.read_at && !fromMe && <span className="font-mono text-[11px] text-muted-foreground">letto {fmtDate(msg.read_at)}</span>}
            {msg.downloaded_at && !fromMe && <span className="font-mono text-[11px] text-muted-foreground">allegato scaricato {fmtDate(msg.downloaded_at)}</span>}
            <span className="flex-1" />
            <button type="button" onClick={onReply}
              className="flex h-10 items-center gap-2 rounded-[8px] bg-primary px-[14px] text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.97]">
              <Rispondi /> Rispondi
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
