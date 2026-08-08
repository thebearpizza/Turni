'use client'
import { useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { addDays, format, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Clock, Loader2, X } from 'lucide-react'
import { ORIGINE_LABEL } from '@/lib/cassa/prenotazioniAgenda'
import type { BozzaCoda } from '@/components/cassa/PrenotazioneFormDialog'

// Coda di completamento, ma sfogliabile giorno per giorno come l'agenda
// stessa — non solo un elenco piatto. Il conteggio totale (su tutti i
// locali gestiti, comprese le date future) vive nella stringa sopra il
// titolo "Prenotazioni"; questo dialog si apre solo cliccandola, mai da
// solo: un promemoria che appare senza essere chiesto stanca, un contatore
// sempre visibile no.

const TZ = 'Europe/Rome'

function oggiRoma(): string {
  return formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
}

function etichettaGiorno(data: string): string {
  const label = format(parseISO(data), 'EEE, d MMM', { locale: it })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function diffGiorni(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
}

interface RestaurantOption { id: string; name: string }

export interface VoceCoda { logId: string; voce: BozzaCoda }

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  voci:         VoceCoda[]
  restaurants:  RestaurantOption[]
  onCompleta:   (voce: BozzaCoda) => void
  // Chiamato dopo aver scartato una voce, per far ricalcolare subito il
  // contatore sopra il titolo — il realtime arriva comunque, ma con un
  // giro di rete di ritardo.
  onCambiato:   () => void
}

export function PrenotazioniRiepilogoCodaDialog({ open, onOpenChange, voci, restaurants, onCompleta, onCambiato }: Props) {
  const [giorno, setGiorno] = useState(oggiRoma)
  const [inCorso, setInCorso] = useState<string | null>(null)

  async function ignora(logId: string) {
    setInCorso(logId)
    const supabase = createClient()
    await supabase.from('prenotazioni_email_log').update({ esito: 'ignorata' }).eq('id', logId)
    setInCorso(null)
    onCambiato()
  }

  const nomeLocale = (id: string) => restaurants.find(r => r.id === id)?.name ?? id

  const delGiorno = voci
    .filter(v => v.voce.data === giorno)
    .sort((a, b) => nomeLocale(a.voce.restaurant_id).localeCompare(nomeLocale(b.voce.restaurant_id)))

  // Il giorno più vicino con qualcosa in coda, quando quello aperto è
  // vuoto: è quello che trasforma "non c'è nulla" in "guarda lì invece".
  // A parità di distanza vince il futuro sul passato — è quello ancora
  // utile da completare in tempo.
  const dateDisponibili = [...new Set(voci.map(v => v.voce.data))].filter(d => d !== giorno)
  const dataPiuVicina = dateDisponibili.reduce<string | null>((migliore, d) => {
    if (!migliore) return d
    const diffD = diffGiorni(d, giorno)
    const diffM = diffGiorni(migliore, giorno)
    if (diffD < diffM) return d
    if (diffD === diffM && d > migliore) return d
    return migliore
  }, null)

  function completa(voce: BozzaCoda) {
    onOpenChange(false)
    onCompleta(voce)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cassa cassa-perforated-top max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="cassa-display text-lg">Prenotazioni da completare</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          <span className="cassa-numeric font-medium">{voci.length}</span> in coda in totale, su tutti i locali —
          comprese le date future. TheFork non scrive l&apos;orario in queste notifiche: il resto dei dati c&apos;è già.
        </p>

        {/* Stesso calendario dell'agenda: frecce per scorrere i giorni,
            la data al centro apre il calendario di sistema. */}
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Giorno precedente"
            onClick={() => setGiorno(g => format(addDays(parseISO(g), -1), 'yyyy-MM-dd'))}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>

          <div className="relative min-w-0 flex-1">
            <div className="flex h-9 items-center justify-center rounded-md bg-primary px-2 text-sm font-medium text-primary-foreground">
              {etichettaGiorno(giorno)}
            </div>
            <input
              type="date"
              aria-label="Scegli il giorno"
              value={giorno}
              onChange={e => { if (e.target.value) setGiorno(e.target.value) }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Giorno successivo"
            onClick={() => setGiorno(g => format(addDays(parseISO(g), 1), 'yyyy-MM-dd'))}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        {delGiorno.length === 0 ? (
          dataPiuVicina ? (
            <button
              type="button"
              onClick={() => setGiorno(dataPiuVicina)}
              className="flex w-full items-center gap-2 rounded-md border border-[hsl(var(--cassa-copper))]/40 bg-[hsl(var(--cassa-copper))]/10 px-3 py-2.5 text-left text-sm"
            >
              <Clock className="h-4 w-4 shrink-0 text-[hsl(var(--cassa-copper))]" />
              <span className="flex-1">Nessuna in coda in questo giorno.</span>
              <span className="shrink-0 font-medium text-[hsl(var(--cassa-copper))]">
                Vai al {etichettaGiorno(dataPiuVicina)}
              </span>
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">Nessuna prenotazione in coda. Tutto a posto.</p>
          )
        ) : (
          <div className="space-y-2">
            {delGiorno.map(({ logId, voce }) => (
              <div key={logId} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--cassa-copper))]" />
                <div className="min-w-0 flex-1">
                  <div className="break-words font-medium leading-tight">
                    {[voce.nome, voce.cognome].filter(Boolean).join(' ')}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <span>· <span className="cassa-numeric">{voce.persone}</span> pax</span>
                    <span>· {nomeLocale(voce.restaurant_id)}</span>
                    <span>· {ORIGINE_LABEL[voce.origine] ?? voce.origine}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" size="sm" onClick={() => completa(voce)}>
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
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
