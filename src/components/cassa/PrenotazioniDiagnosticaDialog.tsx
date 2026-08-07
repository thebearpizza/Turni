'use client'
import { useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'

// "La casella è collegata e l'app la legge?" — con dei fatti, non con
// una supposizione. Questa integrazione fallisce in silenzio: credenziali
// assenti, credenziali dell'account sbagliato, oppure notifiche che il
// gestionale non manda affatto. A schermo i tre casi sono identici
// (agenda vuota), quindi vanno distinti qui.

interface Diagnostica {
  configurazione: { gmail: boolean; ai: boolean; cronSecret: boolean }
  collegamento: {
    ok: boolean
    casella?: string
    motivo?: string
    trovate?: number
    finestraGiorni?: number
    anteprime?: Array<{ mittente: string; oggetto: string; ricevutaAt: string | null }>
  }
  registro: {
    mailLavorate: number
    prenotazioniDaMail: number
    ultime: Array<{ oggetto: string | null; mittente: string | null; esito: string; errore: string | null; created_at: string }>
  }
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
  const l = dati?.collegamento
  const r = dati?.registro
  const tuttoPronto = !!c?.gmail && !!c?.ai && !!c?.cronSecret && !!l?.ok

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cassa cassa-perforated-top max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="cassa-display text-lg">Collegamento casella mail</DialogTitle>
        </DialogHeader>

        {!dati && !inCorso && (
          <p className="text-sm text-muted-foreground">
            Controlla se l&apos;app riesce a leggere la casella su cui TheFork e Restoo
            mandano le notifiche di prenotazione, e cosa ci trova davvero.
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
                ? 'La casella è collegata e l’app la legge.'
                : 'La lettura della casella NON è attiva: nessuna prenotazione può entrare da sé.'}
            </div>

            <section className="space-y-1.5">
              <h3 className="cassa-display text-sm">Configurazione</h3>
              <Riga ok={!!c?.gmail} testo={c?.gmail ? 'Credenziali Gmail presenti' : 'Credenziali Gmail assenti (GMAIL_CLIENT_ID / SECRET / REFRESH_TOKEN)'} />
              <Riga ok={!!c?.ai}    testo={c?.ai ? 'Chiave AI presente' : 'Chiave AI assente: le mail non potrebbero essere interpretate'} />
              <Riga ok={!!c?.cronSecret} testo={c?.cronSecret ? 'Segreto dello scheduler presente' : 'CRON_SECRET assente: lo scheduler non può avviare la sincronizzazione'} />
            </section>

            <section className="space-y-1.5">
              <h3 className="cassa-display text-sm">Collegamento</h3>
              {l?.ok ? (
                <>
                  <Riga ok testo={<>Casella letta: <span className="font-medium">{l.casella}</span></>} />
                  <Riga
                    ok={(l.trovate ?? 0) > 0}
                    testo={
                      (l.trovate ?? 0) > 0
                        ? <>Trovate <span className="cassa-numeric">{l.trovate}</span> mail dai due gestionali negli ultimi {l.finestraGiorni} giorni</>
                        : <>Nessuna mail dai due gestionali negli ultimi {l.finestraGiorni} giorni: controlla che le notifiche siano attive in TheFork e Restoo</>
                    }
                  />
                  {!!l.anteprime?.length && (
                    <ul className="mt-1 space-y-1 rounded-md border border-border p-2">
                      {l.anteprime.map((a, i) => (
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
                <Riga ok={false} testo={l?.motivo ?? 'Collegamento non riuscito'} />
              )}
            </section>

            <section className="space-y-1.5">
              <h3 className="cassa-display text-sm">Cosa è entrato finora</h3>
              <Riga
                ok={(r?.mailLavorate ?? 0) > 0}
                testo={
                  (r?.mailLavorate ?? 0) > 0
                    ? <><span className="cassa-numeric">{r?.mailLavorate}</span> mail lavorate · <span className="cassa-numeric">{r?.prenotazioniDaMail}</span> prenotazioni entrate da mail</>
                    : <>Nessuna mail ancora lavorata: la sincronizzazione non è mai stata eseguita</>
                }
              />
              {!!r?.ultime.length && (
                <ul className="mt-1 space-y-1 rounded-md border border-border p-2">
                  {r.ultime.map((u, i) => (
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
              )}
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
