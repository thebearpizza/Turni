'use client'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { Foglio, IconaChiudi } from './Foglio'

interface Messaggio { role: 'user' | 'assistant'; content: string }

// Domande pronte del prototipo: spariscono man mano che si fanno.
const SUGGERIMENTI = ['Chi è in ritardo oggi?', 'Quanto abbiamo incassato questo mese?', 'Ci sono fatture da controllare?']

const MD: Components = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{children}</a>,
  code: ({ children }) => <code className="font-mono text-xs">{children}</code>,
}

const SCINTILLA = <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />

// Assistente del manager (Manager Smartphone / Tablet): pannello sopra la
// pagina (sul telefono quasi a tutto schermo, sul tablet a destra largo
// 440), saluto, bolle, domande pronte e campo a pillola. La cronologia
// vera vive lato server (/api/hub/assistente); qui solo la visita corrente.
export function AssistenteChat({ nome, uscita, onChiudi, domandaIniziale, sottotitolo }: {
  nome: string
  uscita: boolean
  onChiudi: () => void
  domandaIniziale?: string | null
  sottotitolo?: string
}) {
  const [messaggi, setMessaggi] = useState<Messaggio[]>([])
  const [testo, setTesto] = useState('')
  const [attesa, setAttesa] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const scorri = useRef<HTMLDivElement>(null)
  const iniziale = useRef(false)

  useEffect(() => {
    scorri.current?.scrollTo({ top: scorri.current.scrollHeight, behavior: 'smooth' })
  }, [messaggi, attesa])

  async function invia(t: string) {
    const domanda = t.trim()
    if (!domanda || attesa) return
    setMessaggi(p => [...p, { role: 'user', content: domanda }])
    setTesto('')
    setAttesa(true)
    setErrore(null)
    try {
      const res = await fetch('/api/hub/assistente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: domanda }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "L'assistente non ha risposto. Riprova.")
      setMessaggi(p => [...p, { role: 'assistant', content: json.risposta }])
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "L'assistente non ha risposto. Riprova.")
    } finally {
      setAttesa(false)
    }
  }

  // Domanda arrivata da un link (?q=...): si invia da sola una volta.
  useEffect(() => {
    if (iniziale.current || !domandaIniziale?.trim()) return
    iniziale.current = true
    const t = setTimeout(() => invia(domandaIniziale), 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domandaIniziale])

  const fatte = new Set(messaggi.filter(m => m.role === 'user').map(m => m.content))
  const bolla = 'max-w-[86%] rounded-[14px] px-3.5 py-2.5 text-sm leading-normal text-pretty'

  return (
    <Foglio uscita={uscita} onChiudi={onChiudi} etichetta="Assistente"
      className="absolute inset-x-2 bottom-2 top-[60px] overflow-hidden rounded-[16px] sm:left-auto sm:right-6 sm:top-[84px] sm:bottom-6 sm:w-[440px]">
      <div className="flex flex-none items-center gap-2.5 border-b border-border px-[18px] py-4">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[oklch(0.94_0.04_180)] text-[oklch(0.45_0.1_180)] dark:bg-[oklch(0.28_0.04_180)] dark:text-[oklch(0.8_0.08_180)]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{SCINTILLA}</svg>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-base font-semibold">Assistente</span>
          <span className="truncate text-xs text-muted-foreground">{sottotitolo ?? 'turni, presenze, cassa e acquisti di tutti i locali'}</span>
        </div>
        <button type="button" onClick={onChiudi} aria-label="Chiudi" className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-muted-foreground active:scale-[0.96]"><IconaChiudi /></button>
      </div>
      <div ref={scorri} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-[18px]">
        <div className={cn(bolla, 'self-start bg-[oklch(0.95_0.01_250)] dark:bg-secondary')}>
          Ciao {nome.split(' ')[0]}, chiedimi qualcosa su turni, presenze, cassa o acquisti dei tuoi locali.
        </div>
        {messaggi.map((m, i) => m.role === 'user' ? (
          <div key={i} className={cn(bolla, 'anim-swapin self-end whitespace-pre-wrap bg-primary text-primary-foreground')}>{m.content}</div>
        ) : (
          <div key={i} className={cn(bolla, 'anim-swapin self-start bg-[oklch(0.95_0.01_250)] dark:bg-secondary')}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{m.content}</ReactMarkdown>
          </div>
        ))}
        {attesa && (
          <div className={cn(bolla, 'flex gap-1 self-start bg-[oklch(0.95_0.01_250)] dark:bg-secondary')} aria-label="L'assistente sta scrivendo">
            {[0, 1, 2].map(i => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 160}ms` }} />)}
          </div>
        )}
        {errore && <p className="self-start text-[13px] text-neg">{errore}</p>}
      </div>
      <form onSubmit={e => { e.preventDefault(); invia(testo) }} className="flex flex-none flex-col gap-2.5 border-t border-border px-3.5 pb-3.5 pt-3">
        {SUGGERIMENTI.some(s => !fatte.has(s)) && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGERIMENTI.filter(s => !fatte.has(s)).map(s => (
              <button key={s} type="button" onClick={() => invia(s)} disabled={attesa}
                className="min-h-10 rounded-full border border-[oklch(0.88_0.01_250)] px-3 py-[7px] text-[13px] font-medium active:scale-[0.97] disabled:opacity-60 dark:border-border">{s}</button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input value={testo} onChange={e => setTesto(e.target.value)} placeholder="Chiedi qualcosa sui tuoi locali…" disabled={attesa}
            className="h-12 min-w-0 flex-1 rounded-full border border-line-strong bg-transparent px-[18px] text-[15px] outline-none placeholder:text-[oklch(0.55_0.01_250)] focus:border-[oklch(0.58_0.12_180)]" />
          <button type="submit" aria-label="Invia" disabled={attesa || !testo.trim()}
            className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground active:scale-[0.96] disabled:opacity-50">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></svg>
          </button>
        </div>
      </form>
    </Foglio>
  )
}
