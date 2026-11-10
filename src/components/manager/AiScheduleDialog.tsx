'use client'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { generateAiSchedule, checkExistingTurns, type GenerateParams } from '@/app/actions/aiTurni'
import type { Department, AiScheduleDraft, AiScheduleDraftTurn, ExtraordinaryClosure } from '@/types'
import { DEPARTMENTS } from '@/types'
import {
  FoglioTurni, Pillola, PulsantiFine, Segmento, ICONA_IA, ICONA_X, USCITA, WD,
  etichettaSettimana, giorniSettimana, giornoLungo, numeroGiorno, piuGiorni,
} from '@/components/turni/comuni'

// "Genera con IA" nel linguaggio dei fogli di MTTurni: settimana con le
// frecce, reparti a pillole, scelta fra integrare o rigenerare i turni già
// presenti, chiusure straordinarie sui giorni della settimana e note libere.
// La proposta generata si rivede in AiScheduleDraftView prima di confermarla.

export type { GenerateParams }

interface Props {
  open:               boolean
  onClose:            () => void
  restaurantId:       string
  restaurantName:     string
  weekStart:          string // lunedì della settimana visualizzata
  currentDept:        Department | null
  currentUserRole:    string
  currentIsDirettore: boolean
  onDraftCreated:     (draft: AiScheduleDraft & { turns: AiScheduleDraftTurn[] }) => void
}

type Modo = 'integrate' | 'replace'

export function AiScheduleDialog(p: Props) {
  // Montato solo quando è aperto: ogni apertura riparte dai valori iniziali.
  const [vivo, setVivo] = useState(p.open)
  const [esce, setEsce] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  if (p.open && !vivo) { setVivo(true); setEsce(false) }
  if (!p.open && vivo) setVivo(false)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const chiudi = () => {
    setEsce(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { setEsce(false); p.onClose() }, USCITA)
  }
  if (!vivo) return null
  return <Contenuto {...p} esce={esce} chiudi={chiudi} />
}

function Contenuto({ restaurantId, restaurantName, weekStart, currentDept, currentUserRole, currentIsDirettore, onDraftCreated, esce, chiudi }: Props & { esce: boolean; chiudi: () => void }) {
  const tutti = currentUserRole === 'manager' || (currentUserRole === 'capo_servizio' && currentIsDirettore)
  const assegnabili: Department[] = tutti ? DEPARTMENTS : (currentDept ? [currentDept] : [])

  const [lun, setLun] = useState(weekStart)
  const [reparti, setReparti] = useState<Department[]>(assegnabili)
  const [esistenti, setEsistenti] = useState<number | null>(null)
  const [modo, setModo] = useState<Modo | null>(null)
  const [chiusure, setChiusure] = useState<ExtraordinaryClosure[]>([])
  const [cGiorno, setCGiorno] = useState<number | null>(null)
  const [cRep, setCRep] = useState<Department | ''>('')
  const [note, setNote] = useState('')
  const [passo, setPasso] = useState<'params' | 'notes' | 'generating'>('params')
  const [occupato, setOccupato] = useState(false)
  const giorni = giorniSettimana(lun)

  // Il conteggio dei turni esistenti vale per settimana+reparti su cui è
  // stato calcolato: cambiandoli si azzera.
  const azzera = () => { setEsistenti(null); setModo(null) }
  const scope = (): Department[] | null => tutti && reparti.length === DEPARTMENTS.length ? null : reparti

  async function avanti() {
    if (passo === 'params') {
      setOccupato(true)
      try {
        const n = await checkExistingTurns(restaurantId, lun, scope())
        setEsistenti(n)
        if (n > 0 && modo === null) return
        setPasso('notes')
      } catch (e) {
        toast({ title: 'Controllo dei turni non riuscito', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
      } finally { setOccupato(false) }
      return
    }
    setPasso('generating')
    try {
      const draft = await generateAiSchedule({
        restaurantId, weekStart: lun, departmentScope: scope(), existingTurnsMode: modo ?? 'integrate',
        extraordinaryClosures: chiusure, notes: note.trim() || undefined,
      })
      toast({ title: `Proposta pronta: ${draft.turns.length} turni da rivedere` })
      onDraftCreated(draft)
    } catch (e) {
      toast({ title: 'Generazione non riuscita', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
      setPasso('notes')
    }
  }

  const puo = reparti.length > 0 && (esistenti === null || esistenti === 0 || modo !== null)
  const freccia = (d: 'sx' | 'dx') => (
    <button
      type="button" aria-label={d === 'sx' ? 'Settimana precedente' : 'Settimana successiva'}
      onClick={() => { setLun(piuGiorni(lun, d === 'sx' ? -7 : 7)); azzera(); setChiusure([]) }}
      className="flex h-10 w-10 flex-none items-center justify-center rounded-[20px] border border-[oklch(0.88_0.01_250)] bg-card active:scale-[0.96] dark:border-line-strong"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d === 'sx' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} /></svg>
    </button>
  )

  return (
    <FoglioTurni aperto esce={esce} onChiudi={chiudi} titolo="Genera con IA" sotto={`${restaurantName} · ${passo === 'params' ? 'parametri' : 'esigenze della settimana'}`}>
      {passo === 'generating' ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="animate-pulse text-foreground [&_svg]:h-10 [&_svg]:w-10">{ICONA_IA}</span>
          <span className="text-[15px] font-semibold">Generazione in corso…</span>
          <span className="text-[13px] text-muted-foreground">Analisi delle presenze storiche e distribuzione dei turni</span>
        </div>
      ) : passo === 'params' ? (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Settimana</span>
            <div className="flex items-center gap-2">
              {freccia('sx')}<span className="flex-1 text-center text-[15px] font-semibold">{etichettaSettimana(lun)}</span>{freccia('dx')}
            </div>
          </div>

          {tutti && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Reparti</span>
              <div className="flex flex-wrap gap-1.5">
                {DEPARTMENTS.map(d => (
                  <Pillola key={d} attiva={reparti.includes(d)} onClick={() => { setReparti(r => r.includes(d) ? r.filter(x => x !== d) : [...r, d]); azzera() }}>{d}</Pillola>
                ))}
              </div>
            </div>
          )}

          {esistenti !== null && esistenti > 0 && (
            <div className="flex flex-col gap-2 rounded-[10px] bg-warn-tint p-3">
              <span className="text-sm font-medium text-warn">{esistenti} turni già presenti in questa settimana</span>
              <Segmento voci={[{ k: 'integrate' as Modo, l: 'Integra' }, { k: 'replace' as Modo, l: 'Rigenera tutto' }]} valore={modo ?? ('' as Modo)} onCambia={setModo} />
              <span className="text-[13px] text-warn">{modo === 'replace' ? 'I turni esistenti verranno sostituiti.' : 'Si riempiono solo i giorni senza turni.'}</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Chiusure straordinarie</span>
            {chiusure.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {chiusure.map((c, i) => (
                  <span key={i} className="flex h-[38px] items-center gap-1.5 rounded-full border border-border bg-card pl-3 pr-1 text-[13px] font-medium">
                    {giornoLungo(c.date)} · {c.department ?? 'Tutto il locale'}
                    <button type="button" aria-label="Rimuovi chiusura" onClick={() => setChiusure(p => p.filter((_, j) => j !== i))} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground">{ICONA_X(14)}</button>
                  </span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-7 gap-1.5">
              {giorni.map((g, d) => (
                <button
                  key={g} type="button" onClick={() => setCGiorno(cGiorno === d ? null : d)}
                  className={cn('flex h-[52px] flex-col items-center justify-center gap-px rounded-[8px] border active:scale-[0.96]', cGiorno === d ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-card dark:border-line-strong')}
                >
                  <span className="text-[11px] font-medium opacity-80">{WD[d]}</span>
                  <span className="font-mono text-[15px] font-semibold">{numeroGiorno(g)}</span>
                </button>
              ))}
            </div>
            {cGiorno !== null && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Pillola attiva={cRep === ''} onClick={() => setCRep('')}>Tutto il locale</Pillola>
                {DEPARTMENTS.map(d => <Pillola key={d} attiva={cRep === d} onClick={() => setCRep(d)}>{d}</Pillola>)}
                <button
                  type="button"
                  onClick={() => { setChiusure(p => [...p, { date: giorni[cGiorno], department: cRep || undefined }]); setCGiorno(null); setCRep('') }}
                  className="flex h-[38px] items-center rounded-[8px] border border-dashed border-[oklch(0.75_0.01_250)] px-3 text-[13px] font-medium active:scale-[0.97] dark:border-line-strong"
                >
                  Aggiungi chiusura
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Esigenze particolari</span>
          <textarea
            value={note} onChange={e => setNote(e.target.value)} rows={4}
            placeholder="Es: sabato sera servono almeno 2 baristi, Marco è disponibile solo la mattina…"
            className="resize-none rounded-[6px] border border-line-strong bg-transparent px-4 py-3 text-base outline-none placeholder:text-muted-foreground focus:border-[oklch(0.58_0.12_180)]"
          />
          <span className="text-[13px] text-muted-foreground">Facoltative: l&apos;algoritmo ne terrà conto per la settimana {etichettaSettimana(lun)}.</span>
        </div>
      )}

      {passo !== 'generating' && (
        <PulsantiFine
          onAnnulla={passo === 'notes' ? () => setPasso('params') : chiudi}
          onConferma={avanti} attivo={puo} occupato={occupato}
          etichetta={passo === 'params' ? (esistenti && modo === null ? 'Scegli come procedere' : 'Avanti') : 'Genera turni'}
        />
      )}
    </FoglioTurni>
  )
}
