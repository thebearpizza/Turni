'use client'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Send, Sparkles } from 'lucide-react'
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
}

// Domande di partenza — solo per orientare chi apre il dialog per la
// prima volta su cosa può chiedere (i tre casi d'uso citati: andamento,
// un periodo preciso, previsione): scompaiono al primo messaggio, non
// sono un filtro persistente come le pillole ristorante altrove in app.
const SUGGERIMENTI = [
  'Come sta andando questo mese?',
  'Previsione entrate a fine mese',
  'Previsione entrate a fine anno',
]

// Chat testuale sopra i dati di Analisi — stesso ambito (ristoranti)
// attualmente filtrato in pagina. Nessuna cronologia salvata: il
// componente rimanda l'intera conversazione a ogni domanda (vedi
// /api/cassa/analisi/ai), e la perde alla chiusura, coerente con un
// widget "fai una domanda rapida" piuttosto che un assistente persistente.
export function AnalisiAiDialog({ open, onOpenChange, restaurantIds }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) { setMessages([]); setInput(''); setError(null); setLoading(false) }
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

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
      if (!res.ok) throw new Error(json.error ?? 'Errore nella risposta dell\'assistente AI')
      setMessages(prev => [...prev, { role: 'assistant', content: json.risposta }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nella risposta dell\'assistente AI')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cassa cassa-perforated-top flex max-h-[85vh] max-w-lg flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="cassa-display flex items-center gap-2 text-lg">
            <Sparkles className="h-4 w-4 text-primary" /> Chiedi all&apos;AI
          </DialogTitle>
        </DialogHeader>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Fai una domanda sull&apos;andamento del periodo — un giorno preciso, un mese, o una previsione di incasso.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGERIMENTI.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => invia(s)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
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
          className="flex items-center gap-2 border-t border-border pt-3"
        >
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Es. come è andato il 15 luglio?"
            disabled={loading}
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
