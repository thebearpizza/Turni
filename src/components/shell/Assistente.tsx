'use client'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { IconaChiudi, IconaInvia, IconaScintilla } from './icone'

// Assistente nell'intestazione (Manager/Direttore Smartphone e Tablet):
// foglio sopra la pagina con velo, conversazione a bolle, domande
// suggerite che spariscono una volta fatte, campo a pillola con invio.
// Stesso motore della chat dell'Hub (/api/hub/assistente).

interface Messaggio { ruolo: 'utente' | 'assistente'; testo: string; errore?: boolean }

const MD: Components = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{children}</a>,
}

export function Assistente({ uscita, onClose, nome, locale, singolo }: {
  uscita: boolean; onClose: () => void; nome: string; locale?: string; singolo: boolean
}) {
  const [msg, setMsg] = useState<Messaggio[]>([])
  const [testo, setTesto] = useState('')
  const [attesa, setAttesa] = useState(false)
  const lista = useRef<HTMLDivElement>(null)
  const primoNome = nome.split(' ')[0]

  const suggerite = singolo
    ? ['Chi è in ritardo oggi?', 'Ci sono fatture da controllare?']
    : ['Chi è in ritardo oggi?', 'Quanto abbiamo incassato questo mese?', 'Ci sono fatture da controllare?']
  const fatte = new Set(msg.filter(m => m.ruolo === 'utente').map(m => m.testo))

  useEffect(() => {
    lista.current?.scrollTo({ top: lista.current.scrollHeight, behavior: 'smooth' })
  }, [msg, attesa])

  async function invia(domanda: string) {
    const d = domanda.trim()
    if (!d || attesa) return
    setMsg(p => [...p, { ruolo: 'utente', testo: d }])
    setTesto('')
    setAttesa(true)
    try {
      const res = await fetch('/api/hub/assistente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: d }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Errore nella risposta dell\'assistente AI')
      setMsg(p => [...p, { ruolo: 'assistente', testo: json.risposta }])
    } catch (e) {
      setMsg(p => [...p, { ruolo: 'assistente', testo: e instanceof Error ? e.message : 'Errore nella risposta dell\'assistente AI', errore: true }])
    } finally {
      setAttesa(false)
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] transition-[background-color] duration-300"
      style={{ backgroundColor: uscita ? 'rgba(15,20,30,0)' : 'rgba(15,20,30,.22)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className={cn(
          'absolute flex flex-col overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_20px_60px_rgba(20,30,50,.18)]',
          'inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+8px)] top-[calc(env(safe-area-inset-top)+10px)]',
          'sm:left-auto sm:right-6 sm:top-[calc(env(safe-area-inset-top)+56px)] sm:bottom-6 sm:w-[440px]',
          uscita ? 'anim-swapout' : 'anim-swapin'
        )}
      >
        <div className="flex flex-none items-center gap-2.5 border-b border-border px-[18px] py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[oklch(0.94_0.04_180)] text-[oklch(0.45_0.1_180)] dark:bg-[oklch(0.28_0.04_180)] dark:text-[oklch(0.75_0.1_180)]">
            <IconaScintilla size={18} doppia={false} />
          </div>
          <div className="flex flex-1 flex-col gap-px">
            <span className="text-base font-semibold">Assistente</span>
            <span className="text-xs text-muted-foreground">
              {singolo ? `turni, presenze e acquisti ${locale ? `di ${locale}` : 'del tuo locale'}` : 'turni, presenze, cassa e acquisti di tutti i locali'}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Chiudi" className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground active:scale-[0.96]">
            <IconaChiudi />
          </button>
        </div>
        <div ref={lista} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-[18px]">
          <div className="max-w-[86%] self-start rounded-[14px] bg-[oklch(0.95_0.01_250)] px-3.5 py-2.5 text-sm leading-normal text-pretty dark:bg-secondary">
            {singolo
              ? `Ciao ${primoNome}, chiedimi qualcosa su turni, presenze o acquisti del locale.`
              : `Ciao ${primoNome}, chiedimi qualcosa su turni, presenze, cassa o acquisti dei tuoi locali.`}
          </div>
          {msg.map((m, i) => (
            <div
              key={i}
              className={cn('anim-swapin max-w-[86%] rounded-[14px] px-3.5 py-2.5 text-sm leading-normal text-pretty',
                m.ruolo === 'utente' ? 'self-end whitespace-pre-wrap bg-primary text-primary-foreground' : 'self-start bg-[oklch(0.95_0.01_250)] dark:bg-secondary',
                m.errore && 'text-neg')}
            >
              {m.ruolo === 'assistente' && !m.errore ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{m.testo}</ReactMarkdown> : m.testo}
            </div>
          ))}
          {attesa && (
            <div className="flex gap-1 self-start rounded-[14px] bg-[oklch(0.95_0.01_250)] px-3.5 py-3.5 dark:bg-secondary" aria-label="Sto pensando">
              {[0, 1, 2].map(i => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 160}ms` }} />)}
            </div>
          )}
        </div>
        <div className="flex flex-none flex-col gap-2.5 border-t border-border px-3.5 pb-3.5 pt-3">
          {suggerite.some(s => !fatte.has(s)) && (
            <div className="flex flex-wrap gap-1.5">
              {suggerite.filter(s => !fatte.has(s)).map(s => (
                <button key={s} type="button" onClick={() => invia(s)} disabled={attesa} className="rounded-full border border-[oklch(0.88_0.01_250)] px-3 py-[7px] text-[13px] font-medium active:scale-[0.97] disabled:opacity-50 dark:border-line-strong">
                  {s}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={e => { e.preventDefault(); invia(testo) }} className="flex gap-2">
            <input
              value={testo}
              onChange={e => setTesto(e.target.value)}
              placeholder={singolo ? 'Chiedi qualcosa sul tuo locale…' : 'Chiedi qualcosa sui tuoi locali…'}
              className="h-12 min-w-0 flex-1 rounded-full border border-line-strong bg-card px-[18px] text-[15px] outline-none placeholder:text-[oklch(0.55_0.01_250)] focus:border-[var(--cassa)]"
            />
            <button type="submit" aria-label="Invia" disabled={attesa || !testo.trim()} className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground active:scale-[0.96] disabled:opacity-50">
              <IconaInvia />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
