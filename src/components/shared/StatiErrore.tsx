'use client'
import { cn } from '@/lib/utils'

// Stati di errore del design (Errori.dc.html), da usare in tutte le
// schermate al posto di messaggi improvvisati:
// - ErroreSezione (1a): la sezione non si è caricata. Stessa forma dello
//   stato vuoto, titolo in rosso, "Riprova" secondario. Riprova → la
//   sezione rimostra lo scheletro → di nuovo dati o errore.
// - ErroreLettura (1c): la lettura AI (fattura, report di chiusura) non è
//   riuscita. Riquadro rosso nel modulo al posto dei campi letti, con
//   "Riprova" e "Compila a mano".
// Le azioni di invio non riuscite usano invece il toast (toast() con
// variant 'destructive' e, se serve, action { label: 'Riprova' }).

/** Testi del codice per la lettura AI, nelle tre varianti del prototipo. */
export const MESSAGGI_LETTURA = {
  tempo: 'La lettura ha superato il tempo massimo. Riprova con meno pagine per volta, oppure compila i dati a mano.',
  errore: 'Errore nella lettura della fattura, riprova o compila i dati a mano.',
  sovraccarico: 'Assistente AI sovraccarico in questo momento, riprova tra poco.',
} as const

const ICONA_RIPROVA = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" />
  </svg>
)

const PALLINO_X = (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>
)

export function ErroreSezione({ messaggio, onRiprova, titolo = 'Caricamento non riuscito', className }: {
  /** Es. "Caricamento delle spese non riuscito. Riprova." */
  messaggio: string
  onRiprova?: () => void
  titolo?: string
  className?: string
}) {
  return (
    <div role="alert" className={cn('anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center text-pretty', className)}>
      <span className="text-[15px] font-semibold text-neg">{titolo}</span>
      <span className="text-[13px] text-muted-foreground">{messaggio}</span>
      {onRiprova && (
        <button
          type="button"
          onClick={onRiprova}
          className="mt-3 flex h-11 items-center gap-2 rounded-[12px] border border-line-strong bg-white px-[18px] text-sm font-semibold text-foreground transition-transform active:scale-[0.97] dark:bg-card"
        >
          {ICONA_RIPROVA}
          Riprova
        </button>
      )}
    </div>
  )
}

export function ErroreLettura({ messaggio, onRiprova, onManuale, className }: {
  messaggio: string
  onRiprova: () => void
  onManuale: () => void
  className?: string
}) {
  return (
    <div role="alert" className={cn('anim-swapin flex flex-col gap-3 rounded-[12px] bg-neg-tint p-3.5', className)}>
      <div className="flex items-start gap-2.5">
        <span className="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full bg-neg">{PALLINO_X}</span>
        <span className="text-sm font-medium leading-[1.45] text-neg text-pretty">{messaggio}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onRiprova} className="h-11 rounded-[12px] bg-primary text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.97]">Riprova</button>
        <button type="button" onClick={onManuale} className="h-11 rounded-[12px] border border-line-strong bg-white text-sm font-semibold text-foreground transition-transform active:scale-[0.97] dark:bg-card">Compila a mano</button>
      </div>
    </div>
  )
}

/** "Lettura in corso…" (stato intermedio dopo Riprova). */
export function LetturaInCorso({ testo = 'Lettura in corso…', className }: { testo?: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5 rounded-[12px] bg-[oklch(0.97_0.01_250)] p-3.5 text-sm font-medium text-muted-foreground dark:bg-secondary', className)}>
      <svg width="18" height="18" viewBox="0 0 18 18" className="animate-spin" aria-hidden>
        <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" />
        <path d="M9 2a7 7 0 0 1 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {testo}
    </div>
  )
}
