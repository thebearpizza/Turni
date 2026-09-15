'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Sparkles, Send } from 'lucide-react'

const SUGGERIMENTI = [
  'Quanto ho speso in merce questo mese?',
  'Chi lavora domani sera?',
  'Ci sono richieste di assenza da approvare?',
  'Ci sono chiusure cassa mancanti questo mese?',
]

// Barra fissa in fondo alla Home Manager (Task 4) — un ingresso
// trasversale all'assistente, non una quarta area: sta fuori dalle
// HubAreaCard, sempre visibile. Non tiene la conversazione qui: all'invio
// apre la schermata di chat dedicata (/hub/assistente) con la domanda
// già passata in query string, che la invia da sola al primo render —
// vedi HubAssistenteChat.
export function HubAiBar() {
  const router = useRouter()
  const [testo, setTesto] = useState('')

  function vaiConDomanda(domanda: string) {
    const pulita = domanda.trim()
    if (!pulita) return
    router.push(`/hub/assistente?q=${encodeURIComponent(pulita)}`)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {SUGGERIMENTI.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => vaiConDomanda(s)}
              className="shrink-0 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={e => { e.preventDefault(); vaiConDomanda(testo) }}
          className="flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1.5 shadow-sm"
        >
          <Sparkles className="ml-1 h-4 w-4 shrink-0 text-primary" />
          <Input
            value={testo}
            onChange={e => setTesto(e.target.value)}
            placeholder="Chiedi qualcosa sui tuoi locali…"
            className="border-none bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button type="submit" size="icon" className="shrink-0 rounded-full" disabled={!testo.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}
