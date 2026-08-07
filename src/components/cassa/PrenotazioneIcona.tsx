'use client'
import { Armchair, Ban, Trash2, Phone, FileUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PrenotazioneOrigine, PrenotazioneStato } from '@/types'

// Pastiglia rotonda a sinistra di ogni prenotazione: normalmente dice da
// quale libro visite arriva la prenotazione, ma appena il personale la
// muove (seduta, no show) prende il sopravvento lo stato — è
// l'informazione che serve a colpo d'occhio durante il servizio.
// È anche il comando che apre il cambio stato, come nel libro visite.

// Le origini restano su toni neutri di proposito: il colore è riservato
// allo stato (verde seduta, rosso no show), altrimenti una prenotazione
// solo confermata sembrerebbe già a tavolo.
const ORIGINE_STILE: Record<PrenotazioneOrigine, { classe: string; contenuto: React.ReactNode }> = {
  thefork: { classe: 'bg-foreground text-background',                       contenuto: 'F' },
  restoo:  { classe: 'bg-muted-foreground text-background',                 contenuto: 'R' },
  manuale: { classe: 'bg-secondary text-secondary-foreground border border-border', contenuto: <Phone className="h-4 w-4" /> },
  import:  { classe: 'bg-secondary text-secondary-foreground border border-border', contenuto: <FileUp className="h-4 w-4" /> },
}

const BASE = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold'

export function StatoIcona({
  stato,
  origine,
  className,
}: {
  stato: PrenotazioneStato
  origine: PrenotazioneOrigine
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

  const stile = ORIGINE_STILE[origine]
  return <span className={cn(BASE, stile.classe, className)}>{stile.contenuto}</span>
}
