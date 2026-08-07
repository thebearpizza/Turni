'use client'
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Clock, Users, User, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPax, nomeCompleto, normalizzaOrario } from '@/lib/cassa/prenotazioniAgenda'
import { StatoIcona } from '@/components/cassa/PrenotazioneIcona'
import type { Prenotazione, PrenotazioneStato } from '@/types'

// Elenco di stati proposto in funzione di dove si trova la prenotazione:
// da "confermata" si può andare ovunque, mentre una già seduta può solo
// tornare confermata (un cliente a tavolo non è un no show e non si
// cancella) — le stesse due liste del libro visite.
const OPZIONI: Record<PrenotazioneStato, PrenotazioneStato[]> = {
  confermata: ['confermata', 'seduta', 'no_show', 'eliminata'],
  seduta:     ['confermata', 'seduta'],
  no_show:    ['confermata', 'seduta', 'no_show', 'eliminata'],
  eliminata:  ['confermata', 'seduta', 'no_show', 'eliminata'],
}

export const STATO_LABEL: Record<PrenotazioneStato, string> = {
  confermata: 'Confermata',
  seduta:     'Seduta',
  no_show:    'No show',
  eliminata:  'Eliminata',
}

interface Props {
  prenotazione: Prenotazione | null
  onOpenChange: (open: boolean) => void
  onCambiaStato: (p: Prenotazione, stato: PrenotazioneStato) => Promise<void>
}

export function PrenotazioneStatoDialog({ prenotazione, onOpenChange, onCambiaStato }: Props) {
  const [inCorso, setInCorso] = useState<PrenotazioneStato | null>(null)
  const [errore, setErrore] = useState<string | null>(null)

  async function scegli(stato: PrenotazioneStato) {
    if (!prenotazione || inCorso) return
    if (stato === prenotazione.stato) { onOpenChange(false); return }
    setInCorso(stato)
    setErrore(null)
    try {
      await onCambiaStato(prenotazione, stato)
      onOpenChange(false)
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Aggiornamento non riuscito')
    } finally {
      setInCorso(null)
    }
  }

  return (
    <Dialog
      open={!!prenotazione}
      onOpenChange={open => { if (!open) { setErrore(null); onOpenChange(false) } }}
    >
      <DialogContent className="cassa cassa-perforated-top">
        <DialogHeader>
          <DialogTitle className="sr-only">Stato della prenotazione</DialogTitle>
        </DialogHeader>

        {prenotazione && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="cassa-numeric font-medium">{normalizzaOrario(prenotazione.orario)}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="cassa-numeric font-medium">{formatPax(prenotazione)}</span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{nomeCompleto(prenotazione)}</span>
              </span>
            </div>

            <div className="space-y-2">
              {OPZIONI[prenotazione.stato].map(stato => {
                const selezionato = stato === prenotazione.stato
                return (
                  <button
                    key={stato}
                    type="button"
                    onClick={() => scegli(stato)}
                    disabled={!!inCorso}
                    aria-current={selezionato}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60',
                      selezionato
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card hover:bg-accent'
                    )}
                  >
                    <StatoIcona stato={stato} origine={prenotazione.origine} />
                    <span className="flex-1 font-medium">{STATO_LABEL[stato]}</span>
                    {inCorso === stato && <Loader2 className="h-4 w-4 animate-spin" />}
                  </button>
                )
              })}
            </div>

            {errore && <p className="text-sm text-destructive">{errore}</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
