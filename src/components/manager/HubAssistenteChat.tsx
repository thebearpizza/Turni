'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Loader2, Send, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// Stessi elementi di AnalisiAiDialog.tsx (l'altro assistente testuale
// dell'app): grassetto, elenchi, occasionalmente un numero — definiti
// fuori dal componente per non ricrearli a ogni render.
const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{children}</a>,
  code: ({ children }) => <code className="rounded bg-background/50 px-1 py-0.5 text-xs cassa-numeric">{children}</code>,
}

// Schermata di chat dell'assistente (Task 4) — raggiunta dalla barra IA
// della Home (HubAiBar) con la domanda già in query string (?q=...): la
// invia da sola al primo render, poi pulisce l'URL così un refresh della
// pagina non la re-invia. La cronologia vera vive lato server
// (hub_ai_messages, letta/scritta da /api/hub/assistente): qui si tiene
// solo la lista visualizzata di QUESTA visita, stesso comportamento
// "riparte da zero a ogni apertura" di AnalisiAiDialog — il modello
// mantiene comunque continuità tra una visita e l'altra leggendo lo
// storico salvato, anche se le bolle non vengono ripresentate.
export function HubAssistenteChat() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inviataIniziale = useRef(false)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  async function invia(testo: string) {
    const domanda = testo.trim()
    if (!domanda || loading) return
    setMessages(prev => [...prev, { role: 'user', content: domanda }])
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/hub/assistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testo: domanda }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Errore nella risposta dell\'assistente AI')
      setMessages(prev => [...prev, { role: 'assistant', content: json.risposta }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nella risposta dell\'assistente AI')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (inviataIniziale.current) return
    const domanda = searchParams.get('q')
    if (domanda?.trim()) {
      inviataIniziale.current = true
      invia(domanda)
      router.replace('/hub/assistente')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={() => router.push('/hub')}
          aria-label="Torna alla Home"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-semibold">Assistente</span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">Chiedi qualcosa sui tuoi locali — turni, cassa o acquisti.</p>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            {m.role === 'user' ? (
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                {m.content}
              </p>
            ) : (
              <div className="max-w-[85%] rounded-2xl bg-accent px-3.5 py-2 text-sm text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                  {m.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-accent px-3.5 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <form
        onSubmit={e => { e.preventDefault(); invia(input) }}
        className="flex items-center gap-2 border-t border-border px-4 py-3"
      >
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Scrivi un'altra domanda…"
          disabled={loading}
        />
        <Button type="submit" size="icon" disabled={loading || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  )
}
