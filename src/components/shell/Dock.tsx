'use client'
import Link from 'next/link'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { Area } from './navigazione'
import { PERCORSI_SCHEDE } from './icone'

// Barre in basso del design:
// - pillola: dock flottante (voci 66×52 sul telefono, 112×56 sul tablet),
//   voce attiva su ink, sfumatura del fondo dietro (Manager/Direttore);
// - schede: icone Phosphor con etichetta, voce attiva in azzurro Turni
//   (Dipendente v2, Capo Servizio);
// - cassa: sul telefono il dock a pillola con le voci spente in grigio
//   (Cassiere e Dipendente 3b), sul tablet due schede con l'indicatore
//   teal sopra la voce attiva (Chiusura Tablet v2).

export function ContatoreBadge({ n, invertito, className }: { n: number; invertito?: boolean; className?: string }) {
  if (!n) return null
  return (
    <span className={cn(
      'box-border flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] px-[5px] font-mono text-[10.5px] font-semibold',
      invertito ? 'bg-primary-foreground text-primary' : 'bg-[oklch(0.55_0.15_25)] text-white',
      className
    )}>
      {n > 99 ? '99+' : n}
    </span>
  )
}

interface DockProps {
  aree: Area[]
  attiva: string | null
  hrefArea: (a: Area) => string
  badgeArea: (a: Area) => number
  /** Click su una voce (per chiudere i pannelli aperti). */
  onVoce: (a: Area) => void
}

/**
 * Voce attiva "ottimistica": la voce toccata si accende subito, senza
 * aspettare che la pagina nuova arrivi dal server; quando la navigazione
 * cambia davvero l'area attiva si torna a quella vera.
 */
function useAttivaSubito(attiva: string | null) {
  const [premuta, setPremuta] = useState<string | null>(null)
  const [ultima, setUltima] = useState(attiva)
  if (ultima !== attiva) { setUltima(attiva); setPremuta(null) }
  return [premuta ?? attiva, setPremuta] as const
}

export function DockPillola({ aree, attiva: vera, hrefArea, badgeArea, onVoce, spente }: DockProps & { spente?: boolean }) {
  const [attiva, premi] = useAttivaSubito(vera)
  const molte = aree.length > 3
  return (
    <div
      data-guscio-entra=""
      className={cn(
        'pointer-events-none z-[35] flex justify-center',
        spente
          ? 'relative flex-none pb-[max(26px,env(safe-area-inset-bottom))] pt-2.5'
          : 'absolute inset-x-0 bottom-0 pb-[max(26px,env(safe-area-inset-bottom))] pt-3 sm:pb-[max(22px,env(safe-area-inset-bottom))] sm:pt-[18px]'
      )}
      // Niente sfumatura a tutta larghezza dietro la dock (troppo
      // invadente): il contenuto scorre sotto e si intravede attraverso la
      // pillola smerigliata.
      style={{ ['--ritardo' as string]: '180ms' }}
    >
      <nav className="pointer-events-auto relative flex gap-1 rounded-[16px] border border-border bg-card/80 p-1.5 shadow-[0_8px_30px_rgba(20,30,50,.14)] backdrop-blur-xl backdrop-saturate-150">
        {aree.map(a => {
          const att = a.key === attiva
          const b = att ? 0 : badgeArea(a)
          return (
            <Link
              key={a.key}
              href={hrefArea(a)}
              onClick={() => { premi(a.key); onVoce(a) }}
              aria-current={att ? 'page' : undefined}
              className={cn(
                'relative flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[11px] text-[13px] font-medium transition-[background-color,color] duration-200 active:scale-[0.97]',
                molte ? 'h-[52px] w-[66px] sm:h-14 sm:w-[112px] sm:text-sm' : 'h-[52px] w-[112px] sm:h-14 sm:text-sm',
                att ? 'bg-primary text-primary-foreground' : spente ? 'text-muted-foreground' : 'text-foreground'
              )}
            >
              {a.label}
              {b > 0 && <ContatoreBadge n={b} className="absolute right-1 top-1 sm:static" />}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

export function BarraSchede({ aree, attiva: vera, hrefArea, badgeArea, onVoce, conPallino }: DockProps & { conPallino: (a: Area) => boolean }) {
  const [attiva, premi] = useAttivaSubito(vera)
  return (
    <nav
      data-guscio-entra=""
      className="relative z-[35] grid flex-none border-t border-border bg-card px-2 pb-[max(30px,env(safe-area-inset-bottom))] pt-1.5"
      style={{ ['--ritardo' as string]: '180ms', gridTemplateColumns: `repeat(${aree.length}, minmax(0, 1fr))` }}
    >
      {aree.map(a => {
        const att = a.key === attiva
        const pallino = !att && conPallino(a) && badgeArea(a) > 0
        const d = a.icona !== 'nessuna' ? PERCORSI_SCHEDE[a.icona] : null
        return (
          <Link
            key={a.key}
            href={hrefArea(a)}
            onClick={() => { premi(a.key); onVoce(a) }}
            aria-current={att ? 'page' : undefined}
            className={cn('relative flex h-[52px] flex-col items-center justify-center gap-1 text-[11px] transition-colors active:scale-[0.97]',
              att ? 'font-semibold text-turni' : 'font-medium text-muted-foreground')}
          >
            {d && <svg width="24" height="24" viewBox="0 0 256 256" fill="currentColor" aria-hidden><path d={d} /></svg>}
            {a.label}
            {pallino && <span className="absolute left-[calc(50%+8px)] top-1.5 box-content h-2 w-2 rounded-full border-2 border-card bg-[var(--neg-strong)]" />}
          </Link>
        )
      })}
    </nav>
  )
}

export function BarraCassaTablet({ aree, attiva: vera, hrefArea, onVoce }: DockProps) {
  const [attiva, premi] = useAttivaSubito(vera)
  return (
    <nav data-guscio-entra="" style={{ ['--ritardo' as string]: '180ms' }} className="relative z-[35] grid flex-none grid-cols-2 border-t border-border bg-card pb-[max(20px,env(safe-area-inset-bottom))] pt-1.5">
      {aree.map(a => {
        const att = a.key === attiva
        return (
          <Link
            key={a.key}
            href={hrefArea(a)}
            onClick={() => { premi(a.key); onVoce(a) }}
            aria-current={att ? 'page' : undefined}
            className={cn('flex h-14 flex-col items-center justify-center gap-1 text-[13px] active:scale-[0.98]', att ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}
          >
            <span className={cn('h-[3px] rounded-[2px]', att ? 'w-7 bg-cassa' : 'w-7 bg-transparent')} />
            {a.label}
          </Link>
        )
      })}
    </nav>
  )
}
