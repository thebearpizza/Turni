'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Rotella } from '@/components/ui/rotella'
import {
  FoglioTurni, Pillola, PulsantiFine, Segmento, ICONA_PIU, ICONA_X, WD,
  bordoCampo, durata, giornoLungo, numeroGiorno, useRotella, useTelefono,
} from './comuni'

// Foglio "Nuovo turno" (MTTurni, nw): dipendente, giorni della settimana
// visualizzata, con più giorni "Stesso orario" / "Orario diverso", Ripeti
// per 1/2/4/8 settimane, fasce con turno spezzato, rotella sotto le fasce,
// totale e "Crea N turni".

export type TipoNuovo = 'standard' | 'straordinario' | 'riposo'
export interface Fascia { a: string; b: string }
export interface RichiestaNuovo {
  userId: string
  tipo: TipoNuovo
  /** Per giorno (0=lunedì): le fasce da creare. */
  voci: { giorno: number; fasce: Fascia[] }[]
  settimane: number
}

export function FoglioNuovoTurno({ esce, onChiudi, sotto, dipendenti, giorni, iniziale, onCrea }: {
  esce: boolean; onChiudi: () => void; sotto: string
  dipendenti: { id: string; nome: string; rep: string }[]
  giorni: string[]
  iniziale: { emp: string | null; giorni: number[] }
  onCrea: (r: RichiestaNuovo) => Promise<boolean>
}) {
  const tel = useTelefono()
  const [emp, setEmp] = useState<string | null>(iniziale.emp)
  const [sel, setSel] = useState<number[]>(iniziale.giorni)
  const [diff, setDiff] = useState(false)
  const [rw, setRw] = useState(1)
  const [tipo, setTipo] = useState<TipoNuovo>('standard')
  const [f, setF] = useState<Fascia[]>([{ a: '18:00', b: '23:00' }])
  const [fd, setFd] = useState<Record<number, Fascia[]>>({})
  const [occupato, setOccupato] = useState(false)
  const rot = useRotella()

  const riposo = tipo === 'riposo'
  const dif = diff && sel.length > 1 && !riposo
  const gs: (number | 'all')[] = dif ? [...sel].sort((x, y) => x - y) : ['all']
  const lista = (g: number | 'all') => g === 'all' ? f : (fd[g] ?? f)
  const aggiorna = (g: number | 'all', fn: (l: Fascia[]) => Fascia[]) => {
    if (g === 'all') setF(fn(f))
    else setFd(p => ({ ...p, [g]: fn(p[g] ?? f) }))
  }
  const W = dif ? 1 : rw
  const n = sel.length * W
  const ok = !!emp && sel.length > 0
  let tm = 0
  gs.forEach(g => lista(g).forEach(x => { tm += durata(x.a, x.b) }))
  const totale = 'Totale ' + Math.floor(tm / 60) + 'h ' + String(tm % 60).padStart(2, '0') + 'm' + (sel.length > 1 ? (dif ? ' su ' : ' per ') + sel.length + ' giorni' : '')

  // Valore della fascia sotto la rotella aperta ("g:i:a").
  const kSel = (() => {
    if (!rot.k) return null
    const [g, i, c] = rot.k.split(':')
    const x = lista(g === 'all' ? 'all' : +g)[+i]
    return x ? { g: g === 'all' ? 'all' as const : +g, i: +i, c: c as 'a' | 'b', v: x[c as 'a' | 'b'] } : null
  })()

  async function salva() {
    if (!ok || !emp || occupato) return
    setOccupato(true)
    const fatto = await onCrea({ userId: emp, tipo, voci: [...sel].sort((x, y) => x - y).map(d => ({ giorno: d, fasce: riposo ? [] : (dif ? lista(d) : f) })), settimane: W })
    setOccupato(false)
    if (fatto) onChiudi()
  }

  return (
    <FoglioTurni aperto esce={esce} onChiudi={onChiudi} titolo="Nuovo turno" sotto={sotto} larghezza={600} altoTablet={160}>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Dipendente</span>
        <div className="flex max-h-[132px] flex-wrap gap-1.5 overflow-y-auto overscroll-contain">
          {dipendenti.map(e => (
            <Pillola key={e.id} attiva={e.id === emp} onClick={() => setEmp(e.id)}>
              {e.nome}<span className="text-[11px] font-normal opacity-70">{e.rep}</span>
            </Pillola>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Giorni</span>
        <div className="grid grid-cols-7 gap-1.5">
          {giorni.map((g, d) => {
            const on = sel.includes(d)
            return (
              <button
                key={g} type="button" onClick={() => setSel(p => on ? p.filter(x => x !== d) : [...p, d])}
                className={cn('flex h-[52px] flex-col items-center justify-center gap-px rounded-[8px] border active:scale-[0.96]',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-card dark:border-line-strong')}
              >
                <span className="text-[11px] font-medium opacity-80">{WD[d]}</span>
                <span className="font-mono text-[15px] font-semibold">{numeroGiorno(g)}</span>
              </button>
            )
          })}
        </div>
        {/* Tipo del turno: nel prototipo il campo c'è (st) ma non il
            controllo; senza, non si potrebbe più segnare un riposo singolo. */}
        <Segmento
          className="mt-1"
          voci={[{ k: 'standard', l: 'Standard' }, { k: 'straordinario', l: 'Straordinario' }, { k: 'riposo', l: 'Riposo' }]}
          valore={tipo} onCambia={v => { rot.azzera(); setTipo(v) }}
        />
        {sel.length > 1 && !riposo && (
          <Segmento
            className="mt-1"
            voci={[{ k: false, l: 'Stesso orario' }, { k: true, l: 'Orario diverso' }]}
            valore={diff} onCambia={v => { rot.chiudi(); setDiff(v) }}
          />
        )}
        {!dif && sel.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            <span className="text-sm font-medium">Ripeti</span>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 4, 8].map(x => (
                <Pillola key={x} attiva={rw === x} onClick={() => setRw(x)}>{x === 1 ? 'Solo questa settimana' : `Per ${x} settimane`}</Pillola>
              ))}
            </div>
          </div>
        )}
      </div>

      {!riposo && (
        <div className={cn('-mx-1.5 flex flex-col gap-3.5 overflow-y-auto overscroll-contain px-1.5', !tel && 'max-h-[340px]')}>
          {gs.map((g, gi) => {
            const L = lista(g)
            const separa = g !== 'all' && gi < gs.length - 1
            return (
              <div key={String(g)} className={cn('flex flex-col gap-2', separa && 'border-b border-[oklch(0.92_0.01_250)] pb-3.5 dark:border-border')}>
                {g !== 'all' && <span className="text-sm font-semibold">{giornoLungo(giorni[g])}</span>}
                {L.map((x, i) => {
                  const kk = `${g}:${i}`
                  return (
                    <div key={i} className="grid grid-cols-[1fr_1fr_44px] items-end gap-2.5">
                      {(['a', 'b'] as const).map(c => (
                        <div key={c} className="flex flex-col gap-1.5">
                          <span className="text-[13px] font-medium">{c === 'a' ? (i ? 'Inizio spezzato' : 'Inizio') : 'Fine'}</span>
                          <button
                            type="button" data-kp="1" onClick={() => rot.apri(`${kk}:${c}`)}
                            className={cn('box-border flex h-14 items-center justify-center rounded-[6px] font-mono text-[22px] font-medium', bordoCampo(rot.k === `${kk}:${c}` && !rot.esce))}
                          >
                            {x[c]}
                          </button>
                        </div>
                      ))}
                      <button
                        type="button" aria-label="Rimuovi fascia" disabled={L.length < 2}
                        onClick={() => { rot.chiudi(); aggiorna(g, l => l.filter((_, j) => j !== i)) }}
                        className="flex h-14 w-11 items-center justify-center rounded-[6px] text-muted-foreground disabled:opacity-25"
                      >
                        {ICONA_X(18)}
                      </button>
                    </div>
                  )
                })}
                <button
                  type="button" onClick={() => aggiorna(g, l => [...l, { a: '19:00', b: '23:30' }])}
                  className="flex h-10 items-center gap-1.5 self-start rounded-[8px] border border-dashed border-[oklch(0.75_0.01_250)] px-3 text-[13px] font-medium active:scale-[0.97] dark:border-line-strong"
                >
                  {ICONA_PIU(14)}Aggiungi turno spezzato
                </button>
              </div>
            )
          })}
        </div>
      )}

      {kSel && !riposo && (
        <div data-kp="1" className={cn('flex justify-center', rot.anim)}>
          <Rotella
            key={rot.k ?? 'x'} value={kSel.v} onDone={rot.chiudi}
            onChange={v => aggiorna(kSel.g, l => l.map((x, j) => j === kSel.i ? { ...x, [kSel.c]: v } : x))}
          />
        </div>
      )}

      {!riposo && <span className="text-sm font-medium">{totale}</span>}

      <PulsantiFine onAnnulla={onChiudi} onConferma={salva} attivo={ok} occupato={occupato} etichetta={n > 1 ? `Crea ${n} turni` : 'Crea turno'} />
    </FoglioTurni>
  )
}
