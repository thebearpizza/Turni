'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Rotella } from '@/components/ui/rotella'
import { ICONA_X, bordoCampo, useRotella } from './comuni'

// Scheda "Modifica turno" (ModificaTurno.dc.html): nome e giorno, Inizio e
// Fine con la rotella ancorata sotto il campo (a sinistra / a destra), Tipo
// a segmenti, nota per il dipendente, Elimina · Annulla · Salva. La
// variante "capo" (Capo Servizio.dc.html) ha raggi da 12 px e pulsanti da
// 48 px.

export type TipoModifica = 'standard' | 'straordinario' | 'riposo'

export interface SalvaModifica { a: string; b: string; tipo: TipoModifica; nota: string }

export function ModificaTurno({
  nome, giorno, inizio, fine, tipo: tipo0 = 'standard', nota: nota0 = '', tipi,
  onClose, onSave, onDelete, etichettaElimina = 'Elimina', conNota = true, variante = 'foglio', raggio = '10px', padB = '24px', ombra = 'none', anim, occupato, className,
}: {
  nome: string; giorno: string; inizio: string; fine: string
  tipo?: TipoModifica; nota?: string
  /** Voci del Tipo: di default Standard e Straordinario come nel design. */
  tipi?: { k: TipoModifica; l: string }[]
  onClose: () => void; onSave: (v: SalvaModifica) => void; onDelete?: () => void
  etichettaElimina?: string
  /** La proposta IA non ha note: il campo si nasconde. */
  conNota?: boolean
  variante?: 'foglio' | 'capo'; raggio?: string; padB?: string; ombra?: string; anim?: string
  occupato?: boolean; className?: string
}) {
  const [a, setA] = useState(inizio || '18:00')
  const [b, setB] = useState(fine || '23:00')
  const [tipo, setTipo] = useState<TipoModifica>(tipo0)
  const [nota, setNota] = useState(nota0)
  const rot = useRotella()
  const capo = variante === 'capo'
  const rr = capo ? 'rounded-[12px]' : 'rounded-[6px]'
  const voci = tipi ?? [{ k: 'standard', l: 'Standard' }, { k: 'straordinario', l: 'Straordinario' }]
  const conOrari = tipo !== 'riposo'

  const campi: { k: 'a' | 'b'; l: string; v: string; set: (v: string) => void; lato: string }[] = [
    { k: 'a', l: 'Inizio', v: a, set: setA, lato: 'left-0' },
    { k: 'b', l: 'Fine', v: b, set: setB, lato: 'right-0' },
  ]

  return (
    <div
      className={cn('box-border flex h-full flex-col gap-5 border border-line-strong bg-card px-6 pt-[22px] text-foreground', capo && 'gap-3.5 px-4 pt-3.5', anim, className)}
      style={{ borderRadius: raggio, paddingBottom: padB, boxShadow: ombra }}
    >
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-lg font-semibold">{nome}</span>
          <span className="text-[13px] text-muted-foreground">{giorno}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Chiudi" className={cn('flex h-11 w-11 flex-none items-center justify-center text-muted-foreground', capo ? 'rounded-[12px]' : 'rounded-[6px]')}>{ICONA_X(18)}</button>
      </div>

      {conOrari && (
        <div className="grid grid-cols-2 gap-4">
          {campi.map(f => (
            <div key={f.k} className={cn('flex flex-col', capo ? 'gap-2' : 'gap-1.5')}>
              <span className="text-sm font-medium">{f.l}</span>
              <div
                data-kp="1" role="button" tabIndex={0}
                onClick={() => rot.apri(f.k)}
                className={cn('relative box-border flex h-12 cursor-pointer items-center px-3.5 font-mono text-xl font-medium', rr, bordoCampo(rot.k === f.k && !rot.esce))}
              >
                {f.v}
                {rot.k === f.k && (
                  <div className={cn('absolute top-[calc(100%+8px)] z-30', f.lato, rot.anim)} onClick={e => e.stopPropagation()}>
                    <Rotella key={f.k} value={f.v} onChange={f.set} onDone={rot.chiudi} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Tipo</span>
        <div className="flex gap-0.5 rounded-[7px] bg-[oklch(0.9_0.01_250)] p-[3px] dark:bg-[oklch(0.26_0.01_250)]">
          {voci.map(v => (
            <button
              key={v.k} type="button" onClick={() => setTipo(v.k)}
              className={cn('flex h-10 flex-1 items-center justify-center rounded-[5px] text-sm transition-[background-color] duration-200',
                tipo === v.k ? 'bg-card font-semibold shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'font-medium text-muted-foreground')}
            >
              {v.l}
            </button>
          ))}
        </div>
      </div>

      {conNota && <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Nota per il dipendente</span>
        <input
          value={nota} onChange={e => setNota(e.target.value)} placeholder="Facoltativa" maxLength={200}
          className={cn('h-12 border border-line-strong bg-transparent px-4 text-base outline-none placeholder:text-muted-foreground focus:border-[oklch(0.58_0.12_180)]', rr)}
        />
      </label>}

      <div className={cn('mt-auto grid pt-1', onDelete ? 'grid-cols-[auto_1fr_1.4fr]' : 'grid-cols-[1fr_1.4fr]', capo ? 'gap-2' : 'gap-3')}>
        {onDelete && (
          <button
            type="button" onClick={onDelete} disabled={occupato}
            className={cn('flex items-center justify-center bg-neg-tint text-sm font-semibold text-neg', rr, capo ? 'h-12 px-3.5' : 'h-[52px] px-[22px]')}
          >
            {etichettaElimina}
          </button>
        )}
        <button type="button" onClick={onClose} className={cn('flex items-center justify-center border border-line-strong text-[15px] font-medium', rr, capo ? 'h-12' : 'h-[52px]')}>Annulla</button>
        <button
          type="button" disabled={occupato}
          onClick={() => { rot.azzera(); onSave({ a, b, tipo, nota: nota.trim() }) }}
          className={cn('flex items-center justify-center bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-40', rr, capo ? 'h-12' : 'h-[52px]')}
        >
          Salva
        </button>
      </div>
    </div>
  )
}
