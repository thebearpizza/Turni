'use client'
import { Armchair, Ban, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PrenotazioneOrigine, PrenotazioneStato } from '@/types'

// Pastiglia rotonda a sinistra di ogni prenotazione: normalmente dice da
// quale libro visite arriva la prenotazione, ma appena il personale la
// muove (seduta, no show) prende il sopravvento lo stato — è
// l'informazione che serve a colpo d'occhio durante il servizio.
// È anche il comando che apre il cambio stato, come nel libro visite.

// Solo due icone, non quattro: F per TheFork (comprese le prenotazioni
// importate dal suo export), R per tutto il resto — Restoo, inserite a
// mano, e le vecchie importazioni di cui non si sa più la piattaforma —
// perché "dirette" è già come le si tratta ovunque nell'app (riepilogo
// PAX incluso), non serve una terza icona per dirlo di nuovo.
//
// Le origini restano su toni neutri di proposito: il colore è riservato
// allo stato (verde seduta, rosso no show), altrimenti una prenotazione
// solo confermata sembrerebbe già a tavolo.
const ORIGINE_STILE: Record<'thefork' | 'restoo', { classe: string; contenuto: React.ReactNode }> = {
  thefork: { classe: 'bg-foreground text-background',       contenuto: 'F' },
  restoo:  { classe: 'bg-muted-foreground text-background', contenuto: 'R' },
}

const BASE = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold'

export function StatoIcona({
  stato,
  origine,
  scontoPercentuale,
  className,
}: {
  stato: PrenotazioneStato
  origine: PrenotazioneOrigine
  // Lo sconto promozionale è una funzione di TheFork: se c'è, la
  // prenotazione viene da lì con certezza pratica, anche quando l'origine
  // registrata dice altro (es. una vecchia importazione senza piattaforma
  // nota) — vince sempre F.
  scontoPercentuale?: number | null
  className?: string
}) {
  if (stato === 'seduta') {
    return (
      <span className={cn(BASE, 'bg-[hsl(var(--cassa-positive))] text-white', className)}>
        <Armchair className="h-5 w-5" />
      </span>
    )
  }
  if (stato === 'no_show') {
    return (
      <span className={cn(BASE, 'bg-destructive text-destructive-foreground', className)}>
        <Ban className="h-5 w-5" />
      </span>
    )
  }
  if (stato === 'eliminata') {
    return (
      <span className={cn(BASE, 'bg-muted text-muted-foreground', className)}>
        <Trash2 className="h-4 w-4" />
      </span>
    )
  }

  const stile = ORIGINE_STILE[origine === 'thefork' || scontoPercentuale != null ? 'thefork' : 'restoo']
  return <span className={cn(BASE, stile.classe, className)}>{stile.contenuto}</span>
}
