'use client'
import { useEffect, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Clock } from 'lucide-react'
import { ORIGINE_LABEL } from '@/lib/cassa/prenotazioniAgenda'
import type { BozzaCoda } from '@/components/cassa/PrenotazioneFormDialog'

// Promemoria giornaliero, non solo un contatore da notare per caso: una
// volta al giorno, alla prima apertura della tab, si controlla se c'è
// qualcosa in coda — su TUTTI i locali gestiti e TUTTE le date, comprese
// quelle future, non solo quella aperta in agenda in quel momento — e se
// sì lo si mostra subito. Il badge "da completare" nella barra esiste già
// per guardarlo su richiesta; questo è il contrario: arriva da solo,
// così una prenotazione futura rimasta in coda non si perde di vista solo
// perché nessuno ha aperto quel giorno in agenda.

const TZ = 'Europe/Rome'
const CHIAVE_STORAGE = 'cassa-prenotazioni-riepilogo-coda-ultima-data'

function oggiRoma(): string {
  return formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
}

interface RestaurantOption { id: string; name: string }

interface RigaLog {
  id:      string
  payload: { parziale?: BozzaCoda | null } | null
}

interface Props {
  restaurants: RestaurantOption[]
  onCompleta:  (voce: BozzaCoda) => void
}

export function PrenotazioniRiepilogoCodaDialog({ restaurants, onCompleta }: Props) {
  const [open, setOpen] = useState(false)
  const [voci, setVoci] = useState<{ logId: string; voce: BozzaCoda }[]>([])

  useEffect(() => {
    if (restaurants.length === 0) return
    if (typeof window === 'undefined') return

    const oggi = oggiRoma()
    if (window.localStorage.getItem(CHIAVE_STORAGE) === oggi) return

    let annullato = false
    const supabase = createClient()
    supabase
      .from('prenotazioni_email_log')
      .select('id, payload')
      .eq('esito', 'incompleta')
      .in('payload->parziale->>restaurant_id', restaurants.map(r => r.id))
      .then(({ data }) => {
        if (annullato) return
        // Segnato come "visto" indipendentemente dall'esito: non deve
        // ripresentarsi più volte nello stesso giorno solo perché in
        // quel momento la coda era vuota.
        window.localStorage.setItem(CHIAVE_STORAGE, oggi)

        const trovate = ((data ?? []) as RigaLog[])
          .map(r => (r.payload?.parziale ? { logId: r.id, voce: { ...r.payload.parziale, logId: r.id } } : null))
          .filter((x): x is { logId: string; voce: BozzaCoda } => x !== null)
          // Per data della prenotazione, non per arrivo della mail: è
          // l'ordine in cui interessa smaltirle, dalla più vicina.
          .sort((a, b) => a.voce.data.localeCompare(b.voce.data))

        if (trovate.length > 0) { setVoci(trovate); setOpen(true) }
      })
    return () => { annullato = true }
  }, [restaurants])

  const nomeLocale = (id: string) => restaurants.find(r => r.id === id)?.name ?? id

  function completa(voce: BozzaCoda) {
    setOpen(false)
    onCompleta(voce)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="cassa cassa-perforated-top max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="cassa-display text-lg">Riepilogo prenotazioni in coda</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          <span className="cassa-numeric font-medium">{voci.length}</span> prenotazion{voci.length === 1 ? 'e' : 'i'} senza
          orario, su tutti i locali — comprese quelle per giorni futuri.
        </p>

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
                  <span>· <span className="cassa-numeric">{voce.persone}</span> pax</span>
                  <span>· {nomeLocale(voce.restaurant_id)}</span>
                  <span>· {ORIGINE_LABEL[voce.origine] ?? voce.origine}</span>
                </div>
              </div>
              <Button type="button" size="sm" onClick={() => completa(voce)}>
                Completa
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
