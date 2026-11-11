'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Rotella } from '@/components/ui/rotella'
import type { StandardShift } from '@/types'
import { FoglioTurni, Pillola, PulsantiFine, WD, bordoCampo, hm, toM, useRotella, useTelefono } from './comuni'

// Foglio "Turni fissi" (MTTurni, fx): per il dipendente scelto la settimana
// tipo (Lavoro con orario / Riposo / Nessuno per ogni giorno), la rotella
// sotto la tabella e "Popola dalla settimana visualizzata" per 1/2/4/8
// settimane. I giorni che hanno già un turno vengono saltati.
// In più rispetto al prototipo, la pillola "Tutti" applica i turni fissi
// già salvati di tutti i dipendenti (l'ex "Popola settimana").

export type ModoGiorno = 'work' | 'rip' | 'off'
export interface GiornoSchema { on: ModoGiorno; a: string; b: string }
type FissoConRiposo = StandardShift & { is_rest_day?: boolean }

/** day_of_week del database (0=domenica) per la riga d (0=lunedì). */
export const dowDi = (d: number) => (d + 1) % 7

function schemaDa(standard: FissoConRiposo[], userId: string): GiornoSchema[] {
  return WD.map((_, d) => {
    const s = standard.filter(x => x.user_id === userId && x.day_of_week === dowDi(d)).sort((x, y) => x.start_time.localeCompare(y.start_time))
    if (!s.length) return { on: 'off', a: '18:00', b: '23:00' }
    if (s[0].is_rest_day) return { on: 'rip', a: '18:00', b: '23:00' }
    return { on: 'work', a: hm(toM(s[0].start_time)), b: hm(toM(s[0].end_time)) }
  })
}

export function FoglioTurniFissi({ esce, onChiudi, sotto, dipendenti, standard, onSalva, onPopolaTutti }: {
  esce: boolean; onChiudi: () => void; sotto: string
  dipendenti: { id: string; nome: string; rep: string }[]
  standard: StandardShift[]
  onSalva: (userId: string, schema: GiornoSchema[], toccati: number[], settimane: number) => Promise<boolean>
  onPopolaTutti: (settimane: number) => Promise<boolean>
}) {
  const tel = useTelefono()
  const [emp, setEmp] = useState<string | null>(null)
  const [w, setW] = useState(4)
  const [schemi, setSchemi] = useState<Record<string, GiornoSchema[]>>({})
  const [toccati, setToccati] = useState<Record<string, number[]>>({})
  const [occupato, setOccupato] = useState(false)
  const rot = useRotella()

  const tutti = emp === '*'
  const fe = emp && !tutti ? emp : null
  const pat = fe ? (schemi[fe] ?? schemaDa(standard, fe)) : []
  const upd = (d: number, o: Partial<GiornoSchema>) => {
    if (!fe) return
    setSchemi(p => ({ ...p, [fe]: (p[fe] ?? schemaDa(standard, fe)).map((x, j) => j === d ? { ...x, ...o } : x) }))
    setToccati(p => ({ ...p, [fe]: [...new Set([...(p[fe] ?? []), d])] }))
  }
  const kd = rot.k?.startsWith('fx:') ? rot.k.split(':') : null
  const rv = kd && pat[+kd[1]] ? pat[+kd[1]][kd[2] as 'a' | 'b'] : '18:00'
  const etichettaW = w === 1 ? '1 settimana' : `${w} settimane`
  const cols = tel ? '44px minmax(0,1fr)' : '44px auto minmax(0,1fr)'

  async function salva() {
    if (!emp || occupato) return
    setOccupato(true)
    const fatto = tutti ? await onPopolaTutti(w) : await onSalva(emp, pat, (toccati[emp] ?? []).map(dowDi), w)
    setOccupato(false)
    if (fatto) onChiudi()
  }

  return (
    <FoglioTurni aperto esce={esce} onChiudi={() => { rot.azzera(); onChiudi() }} titolo="Turni fissi" sotto={sotto} larghezza={600} altoTablet={160}>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Dipendente</span>
        <div className="flex max-h-[132px] flex-wrap gap-1.5 overflow-y-auto overscroll-contain">
          <Pillola attiva={tutti} onClick={() => { rot.chiudi(); setEmp('*') }}>Tutti<span className="text-[11px] font-normal opacity-70">turni fissi salvati</span></Pillola>
          {dipendenti.map(e => (
            <Pillola key={e.id} attiva={e.id === emp} onClick={() => { rot.chiudi(); setEmp(e.id) }}>
              {e.nome}<span className="text-[11px] font-normal opacity-70">{e.rep}</span>
            </Pillola>
          ))}
        </div>
      </div>

      {emp && (
        <>
          {fe && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Settimana tipo</span>
              <div className="overflow-hidden rounded-[10px] border border-border">
                {pat.map((x, d) => (
                  <div key={d} className={cn('grid items-center gap-x-2.5 gap-y-2 px-2.5 py-2', d > 0 && 'border-t border-[oklch(0.93_0.01_250)] dark:border-border')} style={{ gridTemplateColumns: cols }}>
                    <span className="text-[13px] font-semibold">{WD[d]}</span>
                    <div className="flex gap-0.5 justify-self-start rounded-[8px] bg-[oklch(0.93_0.01_250)] p-[3px] dark:bg-[oklch(0.26_0.01_250)]">
                      {([['work', 'Lavoro'], ['rip', 'Riposo'], ['off', 'Nessuno']] as const).map(([k, l]) => (
                        <button
                          key={k} type="button" onClick={() => { rot.chiudi(); upd(d, { on: k }) }}
                          className={cn('flex h-10 items-center rounded-[6px] px-2.5 text-[12.5px] font-medium', x.on === k ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-muted-foreground')}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                    {x.on === 'work' && (
                      <div className="grid grid-cols-2 gap-1.5" style={{ gridColumn: tel ? '2 / -1' : 'auto' }}>
                        {(['a', 'b'] as const).map(c => (
                          <button
                            key={c} type="button" data-kp="1" onClick={() => rot.apri(`fx:${d}:${c}`)}
                            className={cn('box-border flex h-10 items-center justify-center rounded-[6px] font-mono text-[15px] font-medium', bordoCampo(rot.k === `fx:${d}:${c}` && !rot.esce))}
                          >
                            {x[c]}
                          </button>
                        ))}
                      </div>
                    )}
                    {x.on === 'rip' && !tel && <span className="text-[13px] text-neg">Riposo</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {kd && fe && (
            <div data-kp="1" className={cn('flex justify-center', rot.anim)}>
              <Rotella key={rot.k ?? 'x'} value={rv} onDone={rot.chiudi} onChange={v => upd(+kd[1], { [kd[2]]: v })} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Popola dalla settimana visualizzata</span>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 4, 8].map(n => <Pillola key={n} attiva={w === n} onClick={() => setW(n)}>{n === 1 ? '1 settimana' : `${n} settimane`}</Pillola>)}
            </div>
          </div>
          <span className="text-pretty text-[13px] text-muted-foreground">
            {tutti ? 'Si applicano i turni fissi salvati di tutti i dipendenti. I turni già presenti vengono saltati.' : 'I giorni che hanno già un turno modificato a mano vengono saltati.'}
          </span>
        </>
      )}

      <PulsantiFine onAnnulla={() => { rot.azzera(); onChiudi() }} onConferma={salva} attivo={!!emp} occupato={occupato} etichetta={`Popola ${etichettaW}`} />
    </FoglioTurni>
  )
}
