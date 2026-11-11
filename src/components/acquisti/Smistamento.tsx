'use client'
import { cn } from '@/lib/utils'
import type { ArticoloTipologia } from '@/types'
import { TIPOLOGIE, ORDINE_TIPOLOGIE, type Locale } from './comuni'

// Pezzi comuni allo smistamento per locale delle fatture XML (riepilogo
// dell'import e coda "Da assegnare"), nello stesso linguaggio delle
// pillole del foglio Scansiona/Importa (MTAcquisti, "Locale").

/** Badge teal "IA": un esito dell'IA si riconosce a colpo d'occhio. */
export function BadgeIa({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full bg-[oklch(0.93_0.04_180)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.05em] text-[oklch(0.4_0.08_180)] dark:bg-[oklch(0.3_0.05_180)] dark:text-[oklch(0.85_0.06_180)]', className)}>IA</span>
  )
}

/** Griglia dei locali con pallino colorato; toccare quello scelto lo toglie se `azzerabile`. */
export function GrigliaLocali({ tel, locali, scelto, onScegli, azzerabile }: {
  tel: boolean; locali: Locale[]; scelto: string | null; onScegli: (id: string | null) => void; azzerabile?: boolean
}) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${tel ? 2 : Math.min(4, Math.max(2, locali.length))},1fr)` }}>
      {locali.map(l => {
        const on = l.id === scelto
        return (
          <button key={l.id} type="button" onClick={() => onScegli(on && azzerabile ? null : l.id)}
            className={cn('flex h-11 min-w-0 items-center justify-center gap-2 rounded-[8px] border px-2 text-sm font-medium transition-colors duration-200 active:scale-[0.97]', on ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-card dark:border-line-strong')}>
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: on ? '#fff' : l.colore }} /><span className="truncate">{l.nome}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Pillole della tipologia di un articolo nuovo (proposta dall'IA, da controllare). */
export function SceltaTipologia({ valore, onScegli }: { valore: ArticoloTipologia; onScegli: (t: ArticoloTipologia) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {ORDINE_TIPOLOGIE.map(t => (
        <button key={t} type="button" onClick={() => onScegli(t)}
          className={cn('flex h-10 min-w-0 items-center justify-center rounded-[8px] border px-1 text-[13px] font-medium transition-colors duration-200 active:scale-[0.97]', valore === t ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-white dark:border-line-strong dark:bg-card')}>
          <span className="truncate">{TIPOLOGIE[t].l}</span>
        </button>
      ))}
    </div>
  )
}
