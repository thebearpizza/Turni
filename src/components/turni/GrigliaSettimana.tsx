'use client'
import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import { TINTA_TURNO, tipoTurno } from '@/lib/turnColors'
import type { Turn } from '@/types'
import { ICONA_PERSONA, ICONA_PIU, WD, hm, toM, numeroGiorno, ore, durataTurno } from './comuni'

// Griglia della settimana (MTTurni, isWeek): dipendenti × giorni raggruppati
// per reparto con intestazione fissa, turni come blocchi colorati per tipo,
// cella vuota tratteggiata con il +, colonna Monte ore su tablet. Sul
// telefono nomi brevi, ore/obiettivo sotto il nome, orari in colonna.

export interface RigaGriglia {
  id: string
  nome: string
  nomeBreve: string
  sotto: string
  obiettivo: number // ore settimanali
  celle: Turn[][] // 7 giorni, già ordinati per inizio
}
export interface GruppoGriglia { n: string; righe: RigaGriglia[] }

const SF_TESTA = 'bg-[oklch(0.97_0.01_250)] dark:bg-[oklch(0.23_0.01_250)]'
const SF_GRUPPO = 'bg-[oklch(0.96_0.01_250)] dark:bg-[oklch(0.22_0.01_250)]'
const BORDO_FINE = 'border-[oklch(0.93_0.01_250)] dark:border-[oklch(0.27_0.01_250)]'
const OGGI_CELLA = 'bg-[oklch(0.985_0.012_180)] dark:bg-[oklch(0.25_0.02_180)]'
const OGGI_TESTA = 'bg-[oklch(0.96_0.02_180)] dark:bg-[oklch(0.27_0.03_180)]'

export function GrigliaSettimana({ tel, giorni, oggi, gruppi, onTurno, onVuota, onGiorno }: {
  tel: boolean
  giorni: string[]
  oggi: string
  gruppi: GruppoGriglia[]
  onTurno: (t: Turn) => void
  onVuota: (userId: string, data: string) => void
  onGiorno?: (i: number) => void
}) {
  const cols = tel ? '84px repeat(7,minmax(0,1fr))' : '190px repeat(7,minmax(0,1fr)) 92px'
  const conTurno = (i: number) => gruppi.reduce((s, g) => s + g.righe.filter(r => r.celle[i].some(t => !t.is_rest_day)).length, 0)

  return (
    <div className="anim-swapin flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-border bg-card">
      <div className={cn('grid flex-none border-b border-border', SF_TESTA)} style={{ gridTemplateColumns: cols }}>
        <span className={cn('self-center text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground', tel ? 'px-2.5' : 'px-4 py-2.5')}>{tel ? '' : 'Dipendente'}</span>
        {giorni.map((g, i) => {
          const cnt = conTurno(i)
          const cls = cn('flex border-l', BORDO_FINE, g === oggi && OGGI_TESTA, tel ? 'flex-col items-center py-1.5' : 'items-baseline gap-1.5 px-2.5 py-2')
          const dentro = (
            <>
              <span className="text-xs font-medium text-muted-foreground">{WD[i]}</span>
              <span className="font-mono text-[15px] font-semibold">{numeroGiorno(g)}</span>
              {!tel && <span className="flex-1" />}
              {!tel && <span className="flex items-center gap-[3px] whitespace-nowrap font-mono text-[11px] font-medium text-[oklch(0.55_0.01_250)]" title={`${cnt} in turno`}>{ICONA_PERSONA}{cnt}</span>}
            </>
          )
          return onGiorno && !tel
            ? <button key={g} type="button" onClick={() => onGiorno(i)} className={cn(cls, 'text-left active:scale-[0.98]')}>{dentro}</button>
            : <div key={g} className={cls}>{dentro}</div>
        })}
        {!tel && <span className={cn('border-l px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground', BORDO_FINE)}>Monte ore</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {gruppi.length === 0 && (
          <div className="flex flex-col items-center gap-1 px-[18px] py-12 text-center">
            <span className="text-[15px] font-semibold">Nessun dipendente</span>
            <span className="text-[13px] text-muted-foreground">Non ci sono dipendenti in questo locale o reparto.</span>
          </div>
        )}
        {gruppi.map(g => (
          <Fragment key={g.n}>
            <div className={cn('sticky top-0 z-[2] flex items-center gap-2 border-b py-[7px] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground', SF_GRUPPO, BORDO_FINE, tel ? 'px-2.5' : 'px-4')}>
              {g.n}<span className="font-mono text-[11px] font-medium tracking-normal">{g.righe.length}</span>
            </div>
            {g.righe.map(r => {
              const tot = r.celle.flat().reduce((s, t) => s + durataTurno(t), 0)
              const oltre = tot > r.obiettivo * 60 + 120
              return (
                <div key={r.id} className={cn('grid border-b', BORDO_FINE, tel ? 'min-h-14' : 'min-h-[62px]')} style={{ gridTemplateColumns: cols }}>
                  <div className={cn('flex min-w-0 flex-col justify-center gap-px', tel ? 'pl-2.5 pr-1.5' : 'px-4')}>
                    <span className={cn('truncate font-medium', tel ? 'text-[13px]' : 'text-sm')}>{tel ? r.nomeBreve : r.nome}</span>
                    <span className="truncate whitespace-nowrap text-xs text-muted-foreground first-letter:uppercase">{tel ? `${ore(tot)} / ${r.obiettivo}h` : r.sotto}</span>
                  </div>
                  {r.celle.map((fs, i) => {
                    const molti = fs.length > 1
                    const h = tel ? (molti ? 34 : 46) : (molti ? 22 : 46)
                    return (
                      <div key={i} className={cn('flex min-w-0 flex-col justify-center gap-1 border-l', BORDO_FINE, tel ? 'px-0.5 py-1' : 'p-1.5', giorni[i] === oggi && OGGI_CELLA)}>
                        {fs.map(t => (
                          <button
                            key={t.id} type="button" onClick={() => onTurno(t)}
                            className={cn('flex items-center justify-center overflow-hidden whitespace-nowrap rounded-[6px] border font-mono font-medium active:scale-[0.96]', TINTA_TURNO[tipoTurno(t)],
                              tel ? 'flex-col text-[10px] tracking-[-.02em]' : 'gap-1 text-xs')}
                            style={{ height: h }}
                          >
                            {t.is_rest_day
                              ? <span className="font-sans">{tel ? 'Rip.' : 'Riposo'}</span>
                              : tel
                                ? <><span>{hm(toM(t.start_time))}</span><span>{hm(toM(t.end_time))}</span></>
                                : <span>{hm(toM(t.start_time))}–{hm(toM(t.end_time))}</span>}
                          </button>
                        ))}
                        {fs.length === 0 && (
                          <button
                            type="button" onClick={() => onVuota(r.id, giorni[i])} aria-label="Aggiungi turno"
                            className="flex h-[46px] items-center justify-center rounded-[6px] border border-dashed border-[oklch(0.86_0.01_250)] text-[oklch(0.65_0.01_250)] hover:bg-[oklch(0.97_0.01_250)] hover:text-[oklch(0.4_0.01_250)] active:scale-[0.96] dark:border-line-strong dark:hover:bg-[oklch(0.24_0.01_250)] dark:hover:text-foreground"
                          >
                            {ICONA_PIU(16, 2)}
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {!tel && (
                    <div className={cn('flex flex-col items-end justify-center gap-px border-l px-3', BORDO_FINE)}>
                      <span className={cn('font-mono text-[15px] font-semibold', oltre && 'text-neg')}>{ore(tot)}</span>
                      <span className="text-[11px] text-muted-foreground">su {r.obiettivo}h</span>
                    </div>
                  )}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
