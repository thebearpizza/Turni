'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Clock, X } from 'lucide-react'
import { ORIGINE_LABEL } from '@/lib/cassa/prenotazioniAgenda'
import type { BozzaCoda } from '@/components/cassa/PrenotazioneFormDialog'

// Prenotazioni riconosciute nella mail ma senza orario (tipicamente le
// notifiche TheFork, che non lo scrivono da nessuna parte): invece di
// perderle in un log diagnostico, restano qui finché il manager non le
// completa o le scarta. "Completa" apre il modulo di creazione già
// precompilato con tutto ciò che si sa — manca solo l'orario.

interface RigaLog {
  id:         string
  created_at: string
  payload:    { parziale?: BozzaCoda | null } | null
}

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  restaurantId: string
  onCompleta:   (voce: BozzaCoda) => void
  // Chiamato dopo aver scartato una voce, per far ricalcolare subito il
  // contatore nel pulsante che apre questo dialog — il realtime arriva
  // comunque, ma con un giro di rete di ritardo.
  onCambiato:   () => void
}

export function PrenotazioniCodaDialog({ open, onOpenChange, restaurantId, onCompleta, onCambiato }: Props) {
  const [righe, setRighe] = useState<RigaLog[] | null>(null)
  const [caricamento, setCaricamento] = useState(false)
  const [inCorso, setInCorso] = useState<string | null>(null)
  const [errore, setErrore] = useState<string | null>(null)

  const carica = useCallback(async () => {
    setCaricamento(true)
    setErrore(null)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('prenotazioni_email_log')
      .select('id, created_at, payload')
      .eq('esito', 'incompleta')
      .eq('payload->parziale->>restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
    setErrore(error?.message ?? null)
    setRighe((data ?? []) as RigaLog[])
    setCaricamento(false)
  }, [restaurantId])

  useEffect(() => { if (open) carica() }, [open, carica])

  async function ignora(logId: string) {
    setInCorso(logId)
    setErrore(null)
    const supabase = createClient()
    const { error } = await supabase.from('prenotazioni_email_log').update({ esito: 'ignorata' }).eq('id', logId)
    setInCorso(null)
    if (error) { setErrore(error.message); return }
    setRighe(prev => prev?.filter(r => r.id !== logId) ?? null)
    onCambiato()
  }

  const voci = (righe ?? [])
    .map(r => (r.payload?.parziale ? { logId: r.id, voce: { ...r.payload.parziale, logId: r.id } } : null))
    .filter((x): x is { logId: string; voce: BozzaCoda } => x !== null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cassa cassa-perforated-top max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="cassa-display text-lg">Prenotazioni da completare</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          TheFork non scrive l&apos;orario in queste notifiche: il resto dei dati c&apos;è già —
          tocca Completa per aggiungere solo quello.
        </p>

        {caricamento && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Caricamento…
          </p>
        )}

        {!caricamento && voci.length === 0 && (
          <p className="text-sm text-muted-foreground">Nessuna prenotazione da completare.</p>
        )}

        <div className="space-y-2">
          {voci.map(({ logId, voce }) => (
            <div key={logId} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--cassa-copper))]" />
              <div className="min-w-0 flex-1">
                <div className="break-words font-medium leading-tight">
                  {[voce.nome, voce.cognome].filter(Boolean).join(' ')}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  <span className="cassa-numeric">{voce.data}</span>
                  <span>· <span className="cassa-numeric">{voce.persone}</span> persone</span>
                  <span>· {ORIGINE_LABEL[voce.origine] ?? voce.origine}</span>
                  {voce.sconto_percentuale != null && (
                    <span className="text-[hsl(var(--cassa-copper))]">· −{voce.sconto_percentuale}%</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button type="button" size="sm" onClick={() => onCompleta(voce)}>
                  Completa
                </Button>
                <button
                  type="button"
                  onClick={() => ignora(logId)}
                  disabled={inCorso === logId}
                  aria-label="Ignora questa prenotazione"
                  className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-50"
                >
                  {inCorso === logId ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>

        {errore && <p className="text-sm text-destructive">{errore}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
