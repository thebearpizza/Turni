'use client'
import { useState } from 'react'
import { BellRing, Loader2 } from 'lucide-react'

// Comando diagnostico: manda una notifica di prova ai propri dispositivi e
// mostra l'esito a schermo. Senza, l'unico modo per sapere se le push
// funzionano è aspettare un evento vero e sperare — che è esattamente come
// il problema è rimasto invisibile per settimane.
export function PushTestButton({ className }: { className?: string }) {
  const [inCorso, setInCorso] = useState(false)
  const [esito, setEsito] = useState<string | null>(null)

  async function prova() {
    setInCorso(true)
    setEsito(null)
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      const json = await res.json()
      setEsito(json.error ?? json.messaggio ?? 'Esito sconosciuto')
    } catch {
      setEsito('Richiesta non riuscita: controlla la connessione.')
    } finally {
      setInCorso(false)
    }
  }

  return (
    <div className={className}>
      <button
        onClick={prova}
        disabled={inCorso}
        className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        {inCorso ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
        Prova notifiche
      </button>
      {esito && <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{esito}</p>}
    </div>
  )
}
