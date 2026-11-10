'use client'
import { Fragment, useState } from 'react'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { confirmAiDraft, discardAiDraft, updateDraftTurn, rejectDraftTurn } from '@/app/actions/aiTurni'
import { TINTA_TURNO, tipoTurno } from '@/lib/turnColors'
import type { AiScheduleDraft, AiScheduleDraftTurn } from '@/types'
import { chiediConferma } from '@/components/shared/Conferma'
import { ModificaTurno, type SalvaModifica } from '@/components/turni/ModificaTurno'
import {
  FoglioTurni, Velo, USCITA, WD, etichettaSettimana, giorniSettimana, giornoLungo, hm, numeroGiorno,
  pesoReparto, toM, useApertura, useTelefono, nomeBreve,
} from '@/components/turni/comuni'

// Proposta della IA da rivedere prima di confermarla, con la stessa griglia
// e gli stessi colori della settimana di MTTurni. Tocca un turno per
// modificarlo o toglierlo; un turno tolto (barrato) si ripristina con un
// tocco. "Conferma turni" li rende subito visibili ai dipendenti.

interface Props {
  draft:    AiScheduleDraft & { turns: AiScheduleDraftTurn[] }
  staff:    { id: string; full_name: string; department: string | null }[]
  onClose:  () => void
  onConfirmed: () => void
}

export function AiScheduleDraftView({ draft, staff, onClose, onConfirmed }: Props) {
  const tel = useTelefono()
  const [turns, setTurns] = useState<AiScheduleDraftTurn[]>(draft.turns)
  const [occupato, setOccupato] = useState(false)
  const [esce, setEsce] = useState(false)
  const modifica = useApertura<AiScheduleDraftTurn>()
  const giorni = giorniSettimana(draft.week_start)

  const esci = (dopo: () => void) => { setEsce(true); setTimeout(dopo, USCITA) }

  async function salva(t: AiScheduleDraftTurn, v: SalvaModifica) {
    const riposo = v.tipo === 'riposo'
    const upd = { start_time: riposo ? '00:00' : v.a, end_time: riposo ? '00:00' : v.b, is_rest_day: riposo, is_extraordinary: v.tipo === 'straordinario' }
    setOccupato(true)
    try {
      await updateDraftTurn(t.id, upd)
      setTurns(p => p.map(x => x.id === t.id ? { ...x, ...upd, status: 'modified' } : x))
      modifica.chiudi()
    } catch (e) {
      toast({ title: 'Modifica non riuscita', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setOccupato(false) }
  }
  async function togli(t: AiScheduleDraftTurn) {
    setOccupato(true)
    try {
      await rejectDraftTurn(t.id)
      setTurns(p => p.map(x => x.id === t.id ? { ...x, status: 'rejected' } : x))
      modifica.chiudi()
    } catch (e) {
      toast({ title: 'Operazione non riuscita', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setOccupato(false) }
  }
  async function ripristina(t: AiScheduleDraftTurn) {
    try {
      await updateDraftTurn(t.id, { status: 'pending' })
      setTurns(p => p.map(x => x.id === t.id ? { ...x, status: 'pending' } : x))
    } catch (e) {
      toast({ title: 'Ripristino non riuscito', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }
  async function conferma() {
    setOccupato(true)
    try {
      const { created } = await confirmAiDraft(draft.id)
      toast({ title: `${created} turni confermati, già visibili ai dipendenti` })
      esci(onConfirmed)
    } catch (e) {
      toast({ title: 'Conferma non riuscita', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setOccupato(false) }
  }
  async function scarta() {
    if (!(await chiediConferma({ titolo: 'Scartare la proposta?', testo: "L'azione non può essere annullata.", conferma: 'Scarta' }))) return
    try {
      await discardAiDraft(draft.id)
      toast({ title: 'Proposta scartata' })
      esci(onClose)
    } catch (e) {
      toast({ title: 'Operazione non riuscita', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  // Righe: lo staff nello scope più i jolly di altro reparto presenti nella proposta.
  const persone = new Map<string, { id: string; nome: string; rep: string | null; jolly: boolean }>()
  for (const s of staff) persone.set(s.id, { id: s.id, nome: s.full_name, rep: s.department, jolly: false })
  for (const t of turns) if (!persone.has(t.user_id) && t.profile) persone.set(t.user_id, { id: t.user_id, nome: t.profile.full_name, rep: t.original_department, jolly: true })
  const conTurni = new Set(turns.map(t => t.user_id))
  const gruppi = new Map<string, { id: string; nome: string; rep: string | null; jolly: boolean }[]>()
  for (const p of persone.values()) if (conTurni.has(p.id)) gruppi.set(p.rep ?? 'Senza reparto', [...(gruppi.get(p.rep ?? 'Senza reparto') ?? []), p])
  const ordinati = [...gruppi.entries()].sort(([a], [b]) => pesoReparto(a) - pesoReparto(b) || a.localeCompare(b))
  const attivi = turns.filter(t => t.status !== 'rejected').length
  const cols = tel ? '84px repeat(7,minmax(0,1fr))' : '170px repeat(7,minmax(0,1fr))'
  const ed = modifica.dati

  return (
    <>
      <FoglioTurni
        aperto esce={esce} onChiudi={() => esci(onClose)} larghezza={1200} altoTablet={48}
        titolo="Proposta della IA" sotto={`Settimana ${etichettaSettimana(draft.week_start)} · ${attivi} turni`}
      >
        {(draft.warnings ?? []).length > 0 && (
          <div className="flex flex-col gap-1 rounded-[10px] bg-warn-tint p-3 text-warn">
            <span className="text-sm font-semibold">{draft.warnings.length} avvisi di copertura</span>
            {draft.warnings.map((w, i) => <span key={i} className="text-[13px]"><b className="font-medium">{w.day} · {w.department} · {w.slot_name}:</b> {w.message}</span>)}
          </div>
        )}
        <div className="overflow-hidden rounded-[12px] border border-border">
          <div className="grid border-b border-border bg-[oklch(0.97_0.01_250)] dark:bg-[oklch(0.23_0.01_250)]" style={{ gridTemplateColumns: cols }}>
            <span />
            {giorni.map((g, i) => (
              <div key={g} className={cn('flex border-l border-[oklch(0.93_0.01_250)] dark:border-border', tel ? 'flex-col items-center py-1.5' : 'items-baseline gap-1.5 px-2.5 py-2')}>
                <span className="text-xs font-medium text-muted-foreground">{WD[i]}</span>
                <span className="font-mono text-[15px] font-semibold">{numeroGiorno(g)}</span>
              </div>
            ))}
          </div>
          {ordinati.map(([rep, righe]) => (
            <Fragment key={rep}>
              <div className="border-b border-[oklch(0.93_0.01_250)] bg-[oklch(0.96_0.01_250)] px-4 py-[7px] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground dark:border-border dark:bg-[oklch(0.22_0.01_250)]">{rep}</div>
              {righe.map(p => (
                <div key={p.id} className="grid min-h-14 border-b border-[oklch(0.93_0.01_250)] dark:border-border" style={{ gridTemplateColumns: cols }}>
                  <div className="flex min-w-0 flex-col justify-center px-2.5 sm:px-4">
                    <span className="truncate text-[13px] font-medium sm:text-sm">{tel ? nomeBreve(p.nome) : p.nome}</span>
                    {p.jolly && <span className="truncate text-xs text-muted-foreground">jolly</span>}
                  </div>
                  {giorni.map(g => {
                    const fs = turns.filter(t => t.user_id === p.id && t.date === g).sort((a, b) => a.start_time.localeCompare(b.start_time))
                    return (
                      <div key={g} className="flex min-w-0 flex-col justify-center gap-1 border-l border-[oklch(0.93_0.01_250)] px-0.5 py-1 dark:border-border sm:p-1.5">
                        {fs.map(t => {
                          const via = t.status === 'rejected'
                          return (
                            <button
                              key={t.id} type="button" onClick={() => via ? ripristina(t) : modifica.apri(t)}
                              className={cn('flex items-center justify-center overflow-hidden whitespace-nowrap rounded-[6px] border font-mono font-medium active:scale-[0.96]', TINTA_TURNO[tipoTurno(t)],
                                tel ? 'flex-col text-[10px] tracking-[-.02em]' : 'text-xs', via && 'line-through opacity-35')}
                              style={{ height: tel ? (fs.length > 1 ? 34 : 46) : (fs.length > 1 ? 22 : 46) }}
                              title={via ? 'Tocca per ripristinare' : t.warning ?? undefined}
                            >
                              {t.is_rest_day ? <span className="font-sans">{tel ? 'Rip.' : 'Riposo'}</span>
                                : tel ? <><span>{hm(toM(t.start_time))}</span><span>{hm(toM(t.end_time))}</span></>
                                : <span>{hm(toM(t.start_time))}–{hm(toM(t.end_time))}{t.status === 'modified' ? ' *' : ''}</span>}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              ))}
            </Fragment>
          ))}
          {ordinati.length === 0 && <div className="py-10 text-center text-[13px] text-muted-foreground">Nessun turno generato</div>}
        </div>
        <span className="text-[13px] text-muted-foreground">Tocca un turno per modificarlo o toglierlo; tocca un turno barrato per ripristinarlo.</span>
        <div className="grid grid-cols-[1fr_2fr] gap-2.5">
          <button type="button" onClick={scarta} disabled={occupato} className="flex h-[52px] items-center justify-center rounded-[6px] bg-neg-tint text-[15px] font-semibold text-neg">Scarta proposta</button>
          <button
            type="button" onClick={conferma} disabled={occupato || attivi === 0}
            className="flex h-[52px] items-center justify-center rounded-[6px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-40"
          >
            {occupato ? 'Conferma…' : `Conferma ${attivi} turni`}
          </button>
        </div>
      </FoglioTurni>

      <Velo aperto={!!ed} esce={modifica.esce} onChiudi={modifica.chiudi} altoTablet={220}>
        {ed && (
          <div onClick={e => e.stopPropagation()} style={{ width: tel ? '100%' : 'min(520px, 100%)' }}>
            <ModificaTurno
              key={ed.id}
              nome={persone.get(ed.user_id)?.nome ?? ''} giorno={giornoLungo(ed.date)}
              inizio={ed.is_rest_day ? '' : hm(toM(ed.start_time))} fine={ed.is_rest_day ? '' : hm(toM(ed.end_time))}
              tipo={ed.is_rest_day ? 'riposo' : ed.is_extraordinary ? 'straordinario' : 'standard'}
              tipi={[{ k: 'standard', l: 'Standard' }, { k: 'straordinario', l: 'Straordinario' }, { k: 'riposo', l: 'Riposo' }]}
              raggio={tel ? '20px 20px 0 0' : '10px'} padB={tel ? 'calc(44px + env(safe-area-inset-bottom))' : '24px'}
              ombra="0 20px 60px rgba(20,30,50,.2)" anim={modifica.esce ? 'anim-swapout' : 'anim-swapin'} occupato={occupato}
              etichettaElimina="Togli" conNota={false}
              onClose={modifica.chiudi} onSave={v => salva(ed, v)} onDelete={() => togli(ed)}
            />
          </div>
        )}
      </Velo>
    </>
  )
}
