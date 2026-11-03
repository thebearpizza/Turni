'use client'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// Solo gli elementi che una risposta finanziaria usa davvero (grassetto,
// elenchi, occasionalmente un numero); definiti fuori dal componente per
// non ricrearli a ogni render.
const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{children}</a>,
  code: ({ children }) => <code className="rounded bg-background/50 px-1 py-0.5 text-xs cassa-numeric">{children}</code>,
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  restaurantIds: string[]
  /** Nome di chi chiede, per il saluto. */
  nome?: string
}

// Domande pronte del design: restano sotto la chat finché non le usi.
const SUGGERIMENTI = [
  'Quale locale ha la media scontrino più bassa?',
  'Chi ha il margine più alto?',
  'Come va rispetto al periodo prima?',
]

const USCITA_MS = 320

// Assistente di Analisi (design Manager Analisi): pannello a destra su
// tablet, a tutto schermo su telefono; risponde sui dati dei locali
// filtrati in pagina. La conversazione non si salva: si azzera alla
// chiusura e a ogni domanda si rimanda l'intera chat (/api/cassa/analisi/ai).
export function AnalisiAiDialog({ open, onOpenChange, restaurantIds, nome }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [esce, setEsce] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  function chiudi() {
    setEsce(true)
    setTimeout(() => {
      onOpenChange(false)
      setEsce(false); setMessages([]); setInput(''); setError(null); setLoading(false)
    }, USCITA_MS)
  }

  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') chiudi() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  })

  async function invia(testo: string) {
    const domanda = testo.trim()
    if (!domanda || loading) return
    const prossimi: Message[] = [...messages, { role: 'user', content: domanda }]
    setMessages(prossimi)
    setInput('')
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/cassa/analisi/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_ids: restaurantIds, messages: prossimi }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Errore nella risposta dell\'assistente')
      setMessages(prev => [...prev, { role: 'assistant', content: json.risposta }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nella risposta dell\'assistente')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null
  const chiesti = new Set(messages.filter(m => m.role === 'user').map(m => m.content))
  const restanti = SUGGERIMENTI.filter(x => !chiesti.has(x))
  const bolla = 'max-w-[86%] rounded-[14px] px-3.5 py-2.5 text-[14px] leading-[1.5] text-pretty'

  return createPortal(
    <div className={cn('fixed inset-0 z-[80] transition-colors duration-300', esce ? 'bg-transparent' : 'bg-[rgba(15,20,30,.22)]')} onClick={chiudi}>
      <div
        role="dialog" aria-modal="true" aria-label="Assistente"
        onClick={e => e.stopPropagation()}
        className={cn('absolute inset-2 flex flex-col overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_20px_60px_rgba(20,30,50,.18)] sm:inset-auto sm:bottom-6 sm:right-6 sm:top-[84px] sm:w-[440px]', esce ? 'anim-swapout' : 'anim-swapin')}
      >
        <div className="flex flex-none items-center gap-2.5 border-b border-border px-[18px] py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[oklch(0.94_0.04_180)] text-[oklch(0.45_0.1_180)] dark:bg-[oklch(0.3_0.05_180)] dark:text-[oklch(0.8_0.08_180)]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>
          </div>
          <div className="flex flex-1 flex-col gap-px">
            <span className="text-base font-semibold">Assistente</span>
            <span className="text-xs text-muted-foreground">risponde sui dati dei filtri attivi</span>
          </div>
          <button type="button" onClick={chiudi} aria-label="Chiudi" className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
          </button>
        </div>
        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-[18px]">
          <div className={cn(bolla, 'self-start bg-secondary text-foreground')}>
            {nome ? `Ciao ${nome}, ` : ''}{nome ? 'chiedimi' : 'Chiedimi'} qualcosa su incassi, spese o differenze dei locali filtrati.
          </div>
          {messages.map((m, i) => m.role === 'user' ? (
            <div key={i} className={cn(bolla, 'anim-swapin self-end whitespace-pre-wrap bg-primary text-primary-foreground')}>{m.content}</div>
          ) : (
            <div key={i} className={cn(bolla, 'anim-swapin self-start bg-secondary text-foreground')}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{m.content}</ReactMarkdown>
            </div>
          ))}
          {loading && (
            <div className={cn(bolla, 'flex gap-1 self-start bg-secondary')} aria-label="Sto rispondendo">
              {[0, 1, 2].map(i => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 160}ms` }} />)}
            </div>
          )}
          {error && <p className="text-sm text-neg">{error}</p>}
        </div>
        <div className="flex flex-none flex-col gap-2.5 border-t border-border px-3.5 pb-3.5 pt-3">
          {restanti.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {restanti.map(x => (
                <button key={x} type="button" disabled={loading} onClick={() => invia(x)} className="rounded-full border border-line-strong px-3 py-[7px] text-[13px] font-medium active:scale-[0.97] disabled:opacity-50">{x}</button>
              ))}
            </div>
          )}
          <form onSubmit={e => { e.preventDefault(); invia(input) }} className="flex gap-2">
            <input
              value={input} onChange={e => setInput(e.target.value)} disabled={loading}
              placeholder="Chiedi qualcosa sui tuoi locali…"
              className="h-12 min-w-0 flex-1 rounded-full border border-line-strong bg-card px-[18px] text-[15px] outline-none placeholder:text-[oklch(0.55_0.01_250)] focus-visible:border-[oklch(0.58_0.12_180)]"
            />
            <button type="submit" aria-label="Invia" disabled={loading || !input.trim()} className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground active:scale-[0.96] disabled:opacity-50">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></svg>
            </button>
          </form>
        </div>
      </div>
    </div>,
    document.body
  )
}
