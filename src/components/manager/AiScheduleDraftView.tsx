'use client'
import { useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { TimeInput } from '@/components/ui/time-input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { X, CheckCircle2, AlertTriangle, ArrowRightLeft, Zap, Coffee } from 'lucide-react'
import { confirmAiDraft, discardAiDraft, updateDraftTurn, rejectDraftTurn } from '@/app/actions/aiTurni'
import type { AiScheduleDraft, AiScheduleDraftTurn, AiScheduleWarning } from '@/types'

interface Props {
  draft:    AiScheduleDraft & { turns: AiScheduleDraftTurn[] }
  staff:    { id: string; full_name: string; department: string | null }[]
  onClose:  () => void
  onConfirmed: () => void
}

type TurnStatus = AiScheduleDraftTurn['status']

const TURN_BADGE: Record<string, string> = {
  standard:    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800',
  extraordinary: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800',
  rest:        'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800',
  cross:       'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800',
  rejected:    'opacity-30 line-through bg-zinc-100 text-zinc-400 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-500',
}

function getTurnBadge(t: AiScheduleDraftTurn): string {
  if (t.status === 'rejected') return TURN_BADGE.rejected
  if (t.is_rest_day) return TURN_BADGE.rest
  if (t.is_cross_dept) return TURN_BADGE.cross
  if (t.is_extraordinary) return TURN_BADGE.extraordinary
  return TURN_BADGE.standard
}

// ── thCls / tdCls — stesse classi dell'app ────────────────────────────────
const thCls = 'px-2 py-1.5 text-center font-semibold bg-zinc-900 text-white dark:bg-zinc-800 whitespace-nowrap text-xs'
const tdCls = 'px-1 py-1 text-center text-xs border border-zinc-200 dark:border-zinc-700 align-top'
const tdNameCls = 'px-2 py-1 text-left text-xs font-medium border border-zinc-200 dark:border-zinc-700 whitespace-nowrap sticky left-0 bg-white dark:bg-zinc-950 z-10'

export function AiScheduleDraftView({ draft, staff, onClose, onConfirmed }: Props) {
  const [turns, setTurns] = useState<AiScheduleDraftTurn[]>(draft.turns)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  // ── Edit modal ────────────────────────────────────────────────────────
  const [editingTurn, setEditingTurn] = useState<AiScheduleDraftTurn | null>(null)
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [editIsRest, setEditIsRest] = useState(false)
  const [editSaving, setEditSaving] = useState(false)

  function openEdit(t: AiScheduleDraftTurn) {
    setEditingTurn(t)
    setEditStart(t.start_time.slice(0, 5))
    setEditEnd(t.end_time.slice(0, 5))
    setEditIsRest(t.is_rest_day)
  }

  async function handleEditSave() {
    if (!editingTurn) return
    setEditSaving(true)
    try {
      await updateDraftTurn(editingTurn.id, {
        start_time: editIsRest ? '00:00' : editStart,
        end_time:   editIsRest ? '00:00' : editEnd,
        is_rest_day: editIsRest,
        status: 'modified',
      })
      setTurns(prev => prev.map(t => t.id === editingTurn.id
        ? { ...t, start_time: editIsRest ? '00:00' : editStart, end_time: editIsRest ? '00:00' : editEnd, is_rest_day: editIsRest, status: 'modified' }
        : t
      ))
      setEditingTurn(null)
    } finally {
      setEditSaving(false)
    }
  }

  async function handleReject(turnId: string) {
    await rejectDraftTurn(turnId)
    setTurns(prev => prev.map(t => t.id === turnId ? { ...t, status: 'rejected' } : t))
  }

  async function handleRestore(turnId: string) {
    await updateDraftTurn(turnId, { status: 'pending' })
    setTurns(prev => prev.map(t => t.id === turnId ? { ...t, status: 'pending' } : t))
  }

  async function handleConfirm() {
    setConfirming(true); setConfirmError(null)
    try {
      await confirmAiDraft(draft.id)
      onConfirmed()
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : 'Errore durante la conferma')
    } finally {
      setConfirming(false)
    }
  }

  async function handleDiscard() {
    if (!confirm('Scartare questa bozza? L\'azione non può essere annullata.')) return
    await discardAiDraft(draft.id)
    onClose()
  }

  // ── Dati per la griglia ───────────────────────────────────────────────
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    addDays(parseISO(draft.week_start + 'T00:00:00'), i)
  )

  const turnsByUserDate: Record<string, AiScheduleDraftTurn[]> = {}
  for (const t of turns) {
    const key = `${t.user_id}|${t.date}`
    if (!turnsByUserDate[key]) turnsByUserDate[key] = []
    turnsByUserDate[key].push(t)
  }

  // Staff con almeno un turno nella bozza (o presenti nello staff)
  const draftUserIds = new Set(turns.map(t => t.user_id))
  const gridStaff = staff.filter(s => draftUserIds.has(s.id))

  const activeWarnings: AiScheduleWarning[] = draft.warnings ?? []
  const pendingCount = turns.filter(t => t.status !== 'rejected').length

  return (
    <div className="space-y-5">
      {/* Header bozza */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Bozza turni IA</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Settimana {format(parseISO(draft.week_start + 'T00:00:00'), 'd MMM', { locale: it })} –{' '}
            {format(addDays(parseISO(draft.week_start + 'T00:00:00'), 6), 'd MMM yyyy', { locale: it })}
            {' '}· {pendingCount} turni
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDiscard}>Scarta bozza</Button>
          <Button size="sm" onClick={handleConfirm} disabled={confirming || pendingCount === 0}>
            <CheckCircle2 className="w-4 h-4" />
            {confirming ? 'Pubblicazione…' : 'Conferma e Pubblica'}
          </Button>
        </div>
      </div>

      {confirmError && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{confirmError}</p>
      )}

      {/* Warning panel */}
      {activeWarnings.length > 0 && (
        <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4" />
            {activeWarnings.length} avvisi di copertura
          </div>
          <ul className="space-y-1 pl-5">
            {activeWarnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-700 dark:text-amber-400">
                <span className="font-medium">{w.day} · {w.department} · {w.slot_name}:</span> {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded-sm border ${TURN_BADGE.standard}`} /> Turno
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded-sm border ${TURN_BADGE.extraordinary}`} /> Straordinario
        </span>
        <span className="flex items-center gap-1.5">
          <ArrowRightLeft className="w-3 h-3 text-purple-600" /> Jolly (altro reparto)
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded-sm border ${TURN_BADGE.rest}`} /> Riposo
        </span>
        <span className="flex items-center gap-1.5 ml-auto text-[10px] italic">
          Click cella → modifica · × → rimuovi
        </span>
      </div>

      {/* Griglia — stessa struttura di TurniManagerClient */}
      <div className="w-full rounded-md border bg-card overflow-auto">
        <table className="border-collapse text-xs w-full" style={{ minWidth: 'max-content' }}>
          <thead>
            <tr>
              <th className={`${thCls} sticky left-0 z-20 text-left min-w-[150px]`}>Dipendente</th>
              {weekDays.map(day => (
                <th key={format(day, 'yyyy-MM-dd')} className={`${thCls} min-w-[100px]`}>
                  <div className="capitalize">{format(day, 'EEE', { locale: it })}</div>
                  <div className="font-normal opacity-80">{format(day, 'd/MM', { locale: it })}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gridStaff.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-6 text-muted-foreground text-xs">
                  Nessun turno generato
                </td>
              </tr>
            ) : gridStaff.map(member => (
              <tr key={member.id} className="even:bg-zinc-50 dark:even:bg-zinc-900/20">
                <td className={tdNameCls}>
                  {member.full_name}
                  {member.department && (
                    <span className="block text-[10px] font-normal text-muted-foreground">{member.department}</span>
                  )}
                </td>
                {weekDays.map(day => {
                  const dateStr = format(day, 'yyyy-MM-dd')
                  const cellTurns = turnsByUserDate[`${member.id}|${dateStr}`] ?? []
                  return (
                    <td key={dateStr} className={`${tdCls} p-1`}>
                      <div className="flex flex-col gap-1 items-stretch min-w-[80px]">
                        {cellTurns.map(turn => (
                          <div
                            key={turn.id}
                            className={`flex items-center justify-between gap-0.5 rounded-sm border px-1 py-0.5 text-[10px] font-medium cursor-pointer group ${getTurnBadge(turn)}`}
                          >
                            <span onClick={() => openEdit(turn)} className="flex-1 flex items-center gap-0.5 min-w-0">
                              {turn.is_cross_dept && <ArrowRightLeft className="w-2.5 h-2.5 shrink-0" />}
                              {turn.is_extraordinary && <Zap className="w-2.5 h-2.5 shrink-0" />}
                              {turn.is_rest_day ? 'Riposo' : `${turn.start_time.slice(0, 5)}–${turn.end_time.slice(0, 5)}`}
                              {turn.status === 'modified' && <span className="opacity-60">*</span>}
                            </span>
                            {turn.status !== 'rejected' ? (
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); handleReject(turn.id) }}
                                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-destructive transition-opacity"
                                aria-label="Rimuovi"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); handleRestore(turn.id) }}
                                className="text-[9px] opacity-60 hover:opacity-100"
                              >
                                ↩
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Edit turn modal ──────────────────────────────────────────── */}
      <Dialog open={!!editingTurn} onOpenChange={open => { if (!open) setEditingTurn(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Modifica turno</DialogTitle>
            {editingTurn && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {staff.find(s => s.id === editingTurn.user_id)?.full_name} · {editingTurn.date}
              </p>
            )}
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5">
              <Label>Giorno di riposo</Label>
              <Switch checked={editIsRest} onCheckedChange={setEditIsRest} />
            </div>
            {!editIsRest && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Ora inizio</Label>
                  <TimeInput value={editStart} onChange={setEditStart} />
                </div>
                <div className="space-y-1.5">
                  <Label>Ora fine</Label>
                  <TimeInput value={editEnd} onChange={setEditEnd} />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTurn(null)}>Annulla</Button>
            <Button onClick={handleEditSave} disabled={editSaving || (!editIsRest && (!editStart || !editEnd))}>
              {editSaving ? 'Salvataggio…' : 'Salva'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
