'use client'
import { useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'

// "Le prenotazioni entrano davvero?" — con dei fatti, non con una
// supposizione. Ci sono due vie d'ingresso possibili (polling Gmail,
// webhook CloudMailin) ed entrambe falliscono in silenzio nello stesso
// modo: credenziali assenti, indirizzo sbagliato, oppure notifiche che
// il gestionale non manda affatto. A schermo, in tutti i casi, l'agenda
// resta semplicemente vuota — quindi la verifica va fatta qui.

interface RigaLog {
  oggetto: string | null
  mittente: string | null
  esito: string
  errore: string | null
  created_at: string
}

interface CanaleStato {
  mailLavorate: number
  ultime: RigaLog[]
}

interface Diagnostica {
  configurazione: { gmail: boolean; webhook: boolean; ai: boolean; cronSecret: boolean }
  gmail: {
    ok: boolean
    casella?: string
    motivo?: string
    trovate?: number
    finestraGiorni?: number
    anteprime?: Array<{ mittente: string; oggetto: string; ricevutaAt: string | null }>
  } | null
  canali: { gmail: CanaleStato; cloudmailin: CanaleStato }
}

function Riga({ ok, testo }: { ok: boolean; testo: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--cassa-positive))]" />
        : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
      <span className="min-w-0 flex-1">{testo}</span>
    </div>
  )
}

function ListaLog({ righe }: { righe: RigaLog[] }) {
  if (!righe.length) return null
  return (
    <ul className="mt-1 space-y-1 rounded-md border border-border p-2">
      {righe.map((u, i) => (
        <li key={i} className="flex items-start gap-2 text-xs">
          {u.esito === 'errore'
            ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
            : <Mail className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 break-words">
            <span className="font-medium">{u.oggetto}</span>
            <span className="text-muted-foreground"> · {u.esito}</span>
            {u.errore && <span className="text-destructive"> · {u.errore}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function PrenotazioniDiagnosticaDialog({
  open, onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [dati, setDati] = useState<Diagnostica | null>(null)
  const [inCorso, setInCorso] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  async function controlla() {
    setInCorso(true)
    setErrore(null)
    try {
      const res = await fetch('/api/cassa/prenotazioni/diagnostica')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Controllo non riuscito')
      setDati(json as Diagnostica)
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Controllo non riuscito')
    } finally {
      setInCorso(false)
    }
  }

  const c = dati?.configurazione
  const gmailAttivo = !!c?.gmail && !!dati?.gmail?.ok
  const webhookAttivo = !!c?.webhook
  // "Pronto" non richiede entrambe le vie: basta che almeno una sia
  // davvero funzionante e che l'AI (necessaria a entrambe) sia presente.
  const tuttoPronto = !!c?.ai && (gmailAttivo || webhookAttivo)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cassa cassa-perforated-top max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="cassa-display text-lg">Ingresso prenotazioni da mail</DialogTitle>
        </DialogHeader>

        {!dati && !inCorso && (
          <p className="text-sm text-muted-foreground">
            Controlla se l&apos;app riceve davvero le notifiche di prenotazione da TheFork e Restoo,
            via casella Gmail o via webhook, e cosa ha visto finora.
          </p>
        )}

        {inCorso && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Controllo in corso…
          </p>
        )}

        {dati && (
          <div className="space-y-4">
            <div
              className={cn(
                'rounded-md border px-3 py-2 text-sm font-medium',
                tuttoPronto
                  ? 'border-[hsl(var(--cassa-positive))]/40 bg-[hsl(var(--cassa-positive-bg))] text-[hsl(var(--cassa-positive))]'
                  : 'border-destructive/40 bg-[hsl(var(--cassa-negative-bg))] text-destructive'
              )}
            >
              {tuttoPronto
                ? 'Almeno una via d’ingresso è attiva.'
                : 'Nessuna via d’ingresso è attiva: nessuna prenotazione può entrare da sé.'}
            </div>

            <Riga ok={!!c?.ai} testo={c?.ai ? 'Chiave AI presente' : 'Chiave AI assente: nessuna mail potrebbe essere interpretata, su nessuna via'} />

            {/* ── Webhook CloudMailin ── */}
            <section className="space-y-1.5">
              <h3 className="cassa-display text-sm">Webhook (CloudMailin)</h3>
              <Riga ok={webhookAttivo} testo={webhookAttivo ? 'Segreto del webhook configurato' : 'PRENOTAZIONI_WEBHOOK_SECRET assente: il webhook rifiuta ogni chiamata'} />
              <Riga
                ok={dati.canali.cloudmailin.mailLavorate > 0}
                testo={
                  dati.canali.cloudmailin.mailLavorate > 0
                    ? <><span className="cassa-numeric">{dati.canali.cloudmailin.mailLavorate}</span> mail ricevute via webhook</>
                    : <>Nessuna mail mai ricevuta via webhook{webhookAttivo ? ': verifica l’indirizzo impostato in TheFork/Restoo' : ''}</>
                }
              />
              <ListaLog righe={dati.canali.cloudmailin.ultime} />
            </section>

            {/* ── Gmail ── */}
            <section className="space-y-1.5">
              <h3 className="cassa-display text-sm">Casella Gmail</h3>
              {!c?.gmail ? (
                <Riga ok={false} testo="Credenziali Gmail assenti — via non configurata (non è un problema se usi solo il webhook)" />
              ) : dati.gmail?.ok ? (
                <>
                  <Riga ok testo={<>Casella letta: <span className="font-medium">{dati.gmail.casella}</span></>} />
                  <Riga
                    ok={(dati.gmail.trovate ?? 0) > 0}
                    testo={
                      (dati.gmail.trovate ?? 0) > 0
                        ? <>Trovate <span className="cassa-numeric">{dati.gmail.trovate}</span> mail dai due gestionali negli ultimi {dati.gmail.finestraGiorni} giorni</>
                        : <>Nessuna mail dai due gestionali negli ultimi {dati.gmail.finestraGiorni} giorni</>
                    }
                  />
                  {!!dati.gmail.anteprime?.length && (
                    <ul className="mt-1 space-y-1 rounded-md border border-border p-2">
                      {dati.gmail.anteprime.map((a, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs">
                          <Mail className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 break-words">
                            <span className="font-medium">{a.oggetto}</span>
                            <span className="text-muted-foreground"> · {a.mittente}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <Riga ok={false} testo={dati.gmail?.motivo ?? 'Collegamento non riuscito'} />
              )}
              <Riga
                ok={dati.canali.gmail.mailLavorate > 0}
                testo={
                  dati.canali.gmail.mailLavorate > 0
                    ? <><span className="cassa-numeric">{dati.canali.gmail.mailLavorate}</span> mail lavorate finora</>
                    : 'Nessuna mail ancora lavorata dal polling'
                }
              />
              <ListaLog righe={dati.canali.gmail.ultime} />
            </section>
          </div>
        )}

        {errore && <p className="text-sm text-destructive">{errore}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={inCorso}>
            Chiudi
          </Button>
          <Button type="button" onClick={controlla} disabled={inCorso}>
            {inCorso ? <><Loader2 className="h-4 w-4 animate-spin" /> Controllo…</> : dati ? 'Ricontrolla' : 'Controlla'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
