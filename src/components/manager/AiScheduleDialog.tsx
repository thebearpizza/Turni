'use client'
import { useState, useCallback } from 'react'
import { startOfWeek, addDays, addWeeks, format } from 'date-fns'
import { it } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ChevronLeft, ChevronRight, Sparkles, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import {
  generateAiSchedule, checkExistingTurns,
  type GenerateParams,
} from '@/app/actions/aiTurni'
import type { Department, AiScheduleDraft, AiScheduleDraftTurn, ExtraordinaryClosure } from '@/types'
import { DEPARTMENTS, WEEK_DAYS_SHORT } from '@/types'

// Re-export GenerateParams for use in parent
export type { GenerateParams }

interface Props {
  open:              boolean
  onClose:           () => void
  restaurantId:      string
  currentDept:       Department | null  // null = tutti (manager/direttore)
  currentUserRole:   string
  currentIsDirettore: boolean
  onDraftCreated:    (draft: AiScheduleDraft & { turns: AiScheduleDraftTurn[] }) => void
}

type Step = 'params' | 'notes' | 'generating' | 'done'
type ExistingMode = 'integrate' | 'replace' | null

const DAYS_ORDERED = [1, 2, 3, 4, 5, 6, 0] as const  // Lun→Dom

export function AiScheduleDialog({
  open, onClose, restaurantId, currentDept, currentUserRole, currentIsDirettore, onDraftCreated,
}: Props) {
  const isManager = currentUserRole === 'manager'
  const isDirettore = currentUserRole === 'capo_servizio' && currentIsDirettore

  // ── Selezione settimana ───────────────────────────────────────────────
  const [weekOffset, setWeekOffset] = useState(1)  // default: prossima settimana
  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 })
  const weekStartStr = format(weekStart, 'yyyy-MM-dd')
  const weekLabel = `${format(weekStart, 'd MMM', { locale: it })} – ${format(addDays(weekStart, 6), 'd MMM yyyy', { locale: it })}`

  // ── Reparti ───────────────────────────────────────────────────────────
  const assignableDepts: Department[] = (isManager || isDirettore)
    ? DEPARTMENTS
    : (currentDept ? [currentDept] : [])
  const [selectedDepts, setSelectedDepts] = useState<Department[]>(assignableDepts)

  function toggleDept(d: Department) {
    setSelectedDepts(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
    )
  }

  // ── Turni esistenti ───────────────────────────────────────────────────
  const [existingCount, setExistingCount] = useState<number | null>(null)
  const [existingMode, setExistingMode] = useState<ExistingMode>(null)

  // ── Chiusure straordinarie ────────────────────────────────────────────
  const [showClosures, setShowClosures] = useState(false)
  const [closures, setClosures] = useState<ExtraordinaryClosure[]>([])
  const [closureDate, setClosureDate] = useState('')
  const [closureDept, setClosureDept] = useState<Department | ''>('')

  function addClosure() {
    if (!closureDate) return
    setClosures(prev => [...prev, { date: closureDate, department: closureDept || undefined }])
    setClosureDate(''); setClosureDept('')
  }
  function removeClosure(i: number) {
    setClosures(prev => prev.filter((_, idx) => idx !== i))
  }

  // ── Note NL ───────────────────────────────────────────────────────────
  const [notes, setNotes] = useState('')

  // ── Step & status ─────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('params')
  const [error, setError] = useState<string | null>(null)

  function resetAndClose() {
    setStep('params'); setError(null); setExistingCount(null)
    setExistingMode(null); setNotes(''); setClosures([])
    setWeekOffset(1)
    setSelectedDepts(assignableDepts)
    onClose()
  }

  async function handleNext() {
    setError(null)
    if (step === 'params') {
      // Controlla turni esistenti
      const scope = (isManager || isDirettore) && selectedDepts.length < DEPARTMENTS.length
        ? selectedDepts : null
      const count = await checkExistingTurns(restaurantId, weekStartStr, scope)
      setExistingCount(count)
      if (count > 0 && existingMode === null) {
        // Mostra la scelta integrate/replace prima di andare avanti
        return
      }
      setStep('notes')
    } else if (step === 'notes') {
      await handleGenerate()
    }
  }

  async function handleGenerate() {
    setStep('generating')
    try {
      const scope = (isManager || isDirettore) && selectedDepts.length === DEPARTMENTS.length
        ? null : selectedDepts
      const draft = await generateAiSchedule({
        restaurantId,
        weekStart: weekStartStr,
        departmentScope: scope,
        existingTurnsMode: existingMode ?? 'integrate',
        extraordinaryClosures: closures,
        notes: notes.trim() || undefined,
      })
      onDraftCreated(draft)
      resetAndClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore durante la generazione')
      setStep('notes')
    }
  }

  const canProceed =
    selectedDepts.length > 0 &&
    (existingCount === null || existingCount === 0 || existingMode !== null)

  return (
    <Dialog open={open} onOpenChange={open => { if (!open) resetAndClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Genera turni con IA
          </DialogTitle>
        </DialogHeader>

        {/* ── Step indicatore ─────────────────────────────────────── */}
        {step !== 'generating' && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <span className={step === 'params' ? 'text-foreground font-medium' : ''}>1 Parametri</span>
            <span>→</span>
            <span className={step === 'notes' ? 'text-foreground font-medium' : ''}>2 Note</span>
          </div>
        )}

        {/* ── Step 1: Parametri ───────────────────────────────────── */}
        {step === 'params' && (
          <div className="space-y-5">
            {/* Settimana */}
            <div className="space-y-1.5">
              <Label>Settimana</Label>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8"
                  onClick={() => setWeekOffset(w => w - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="flex-1 text-center text-sm font-medium">{weekLabel}</span>
                <Button variant="outline" size="icon" className="h-8 w-8"
                  onClick={() => setWeekOffset(w => w + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Reparti */}
            {(isManager || isDirettore) && (
              <div className="space-y-1.5">
                <Label>Reparti</Label>
                <div className="flex flex-wrap gap-2">
                  {DEPARTMENTS.map(d => (
                    <button
                      key={d} type="button"
                      onClick={() => toggleDept(d)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        selectedDepts.includes(d)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-border text-foreground hover:bg-accent'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Turni esistenti — mostrato solo dopo il controllo */}
            {existingCount !== null && existingCount > 0 && (
              <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    Trovati <strong>{existingCount}</strong> turni già presenti in questa settimana.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 pl-6">
                  {(['integrate', 'replace'] as const).map(mode => (
                    <label key={mode} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="existingMode"
                        value={mode}
                        checked={existingMode === mode}
                        onChange={() => setExistingMode(mode)}
                        className="accent-primary"
                      />
                      <span className="text-sm">
                        {mode === 'integrate'
                          ? 'Integra (riempi solo i giorni senza turni)'
                          : 'Rigenera tutto (sostituisce i turni esistenti)'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Chiusure straordinarie — collassate */}
            <div className="border border-border rounded-md">
              <button
                type="button"
                onClick={() => setShowClosures(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>Chiusure straordinarie questa settimana{closures.length > 0 ? ` (${closures.length})` : ''}</span>
                {showClosures ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showClosures && (
                <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground">
                    Aggiungi giorni in cui il ristorante (o un reparto) chiude eccezionalmente.
                  </p>
                  {closures.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="flex-1">
                        {c.date} {c.department ? `— ${c.department}` : '— Tutto il locale'}
                      </span>
                      <button type="button" onClick={() => removeClosure(i)}
                        className="text-destructive hover:text-destructive/80 text-xs">
                        Rimuovi
                      </button>
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Data</Label>
                      <Input type="date" value={closureDate}
                        onChange={e => setClosureDate(e.target.value)}
                        min={weekStartStr}
                        max={format(addDays(weekStart, 6), 'yyyy-MM-dd')}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Reparto (opz.)</Label>
                      <select
                        value={closureDept}
                        onChange={e => setClosureDept(e.target.value as Department | '')}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      >
                        <option value="">Tutto il locale</option>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={addClosure} disabled={!closureDate}>
                    Aggiungi chiusura
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Note ────────────────────────────────────────── */}
        {step === 'notes' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Hai esigenze particolari per la settimana <strong>{weekLabel}</strong>?
              Descrivile liberamente — l'algoritmo le terrà in conto.
            </p>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
              placeholder="Es: sabato sera servono almeno 2 baristi, Marco è disponibile solo la mattina, chiudere il Bar domenica sera…"
            />
            <p className="text-xs text-muted-foreground">Facoltativo — puoi lasciarlo vuoto e procedere.</p>
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
            )}
          </div>
        )}

        {/* ── Step: Generazione in corso ──────────────────────────── */}
        {step === 'generating' && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="relative">
              <Sparkles className="w-10 h-10 text-primary animate-pulse" />
            </div>
            <div className="text-center">
              <p className="font-medium">Generazione in corso…</p>
              <p className="text-sm text-muted-foreground mt-1">
                Analisi delle presenze storiche e distribuzione dei turni
              </p>
            </div>
          </div>
        )}

        {step !== 'generating' && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={resetAndClose}>Annulla</Button>
            {step === 'notes' && (
              <Button variant="outline" onClick={() => setStep('params')}>
                <ChevronLeft className="w-4 h-4" /> Indietro
              </Button>
            )}
            <Button onClick={handleNext} disabled={!canProceed}>
              {step === 'params'
                ? existingCount !== null && existingCount > 0 && existingMode === null
                  ? 'Scegli modalità ↑'
                  : 'Avanti →'
                : <><Sparkles className="w-4 h-4" /> Genera turni</>
              }
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
