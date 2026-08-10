'use client'
import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Upload, CheckCircle2, AlertTriangle, Copy, Clock } from 'lucide-react'
import { normalizzaOrario } from '@/lib/cassa/prenotazioniAgenda'
import { cn } from '@/lib/utils'
import type { PrenotazioneServizio, PrenotazioneStato } from '@/types'

// Import delle prenotazioni già inserite nei libri visite: si carica
// l'esportazione (Excel/CSV/PDF), si controlla l'anteprima e solo allora
// le righe entrano in agenda. Il passaggio di conferma non è cerimoniale:
// la lettura di un export sconosciuto è una stima, e vale la pena vederla
// prima che finisca nel giorno di servizio.

interface RigaLetta {
  restaurant_id:      string
  insegna:            string | null
  origine:            'thefork' | 'restoo'
  riferimento_esterno: string | null
  data:               string
  orario:             string
  servizio:           PrenotazioneServizio
  nome:               string
  cognome:            string | null
  persone:            number
  bambini:            number
  sconto_percentuale: number | null
  telefono:           string | null
  email:              string | null
  note:               string | null
  stato:              PrenotazioneStato
  // Solo per l'anteprima: non vanno inviate al database.
  duplicato:          string | null
  avviso:             string | null
  // Presente quando questa riga completa una voce della coda mail: dopo
  // l'insert va anche chiusa quella voce di log.
  completaLogId:      string | null
}

interface Verifica {
  paxCalcolati:         number
  paxDichiarati:        number | null
  righeLette:           number
  righeDichiarate:      number | null
  quadra:               boolean
  confrontoDisponibile: boolean
}

// Voce in coda il cui giorno compare in questo export ma che nessuna riga
// importata ha completato: probabilmente cancellata prima di ricevere un
// orario, non semplicemente in attesa di un file più recente — un futuro
// export di prenotazioni attive non la conterrebbe comunque mai.
interface VoceCodaOrfana {
  logId:   string
  nome:    string
  cognome: string | null
  data:    string
  persone: number
}

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  restaurantId: string
  onImportate:  (quante: number) => void
}

export function PrenotazioniImportDialog({ open, onOpenChange, restaurantId, onImportate }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fonte, setFonte] = useState<'thefork' | 'restoo'>('thefork')
  const [nomeFile, setNomeFile] = useState<string | null>(null)
  const [leggendo, setLeggendo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [righe, setRighe] = useState<RigaLetta[] | null>(null)
  const [verifica, setVerifica] = useState<Verifica | null>(null)
  const [scartate, setScartate] = useState(0)
  const [escluse, setEscluse] = useState<Set<number>>(new Set())
  const [errore, setErrore] = useState<string | null>(null)
  const [codaSenzaRiscontro, setCodaSenzaRiscontro] = useState<VoceCodaOrfana[]>([])
  const [ignorandoId, setIgnorandoId] = useState<string | null>(null)

  function reset() {
    setFonte('thefork')
    setNomeFile(null); setRighe(null); setVerifica(null); setScartate(0)
    setEscluse(new Set()); setErrore(null); setCodaSenzaRiscontro([])
    if (inputRef.current) inputRef.current.value = ''
  }

  async function leggi(file: File) {
    setNomeFile(file.name)
    setLeggendo(true)
    setErrore(null)
    setRighe(null)
    setVerifica(null)

    try {
      const form = new FormData()
      form.append('file', file)
      form.append('restaurant_id', restaurantId)
      form.append('fonte', fonte)
      const res = await fetch('/api/cassa/prenotazioni/importa', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Lettura non riuscita')

      const lette = json.prenotazioni as RigaLetta[]
      setRighe(lette)
      setVerifica(json.verifica as Verifica)
      setScartate(json.scartate as number)
      setCodaSenzaRiscontro((json.codaSenzaRiscontro ?? []) as VoceCodaOrfana[])
      // Doppioni e righe con coperti illeggibili partono deselezionati:
      // importarli è una scelta da fare, non il comportamento di default.
      setEscluse(new Set(lette.flatMap((r, i) => (r.duplicato || r.avviso ? [i] : []))))
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Lettura non riuscita')
    } finally {
      setLeggendo(false)
    }
  }

  // Stessa identica azione del tasto "Ignora" nel riepilogo coda: non
  // cancella nulla, segna solo la notifica come non più da gestire.
  async function ignoraCoda(logId: string) {
    setIgnorandoId(logId)
    const supabase = createClient()
    await supabase.from('prenotazioni_email_log').update({ esito: 'ignorata' }).eq('id', logId)
    setCodaSenzaRiscontro(prev => prev.filter(v => v.logId !== logId))
    setIgnorandoId(null)
  }

  async function conferma() {
    if (!righe) return
    const selezionate = righe.filter((_, i) => !escluse.has(i))
    if (selezionate.length === 0) return

    // duplicato, avviso e completaLogId servono solo all'anteprima: la
    // tabella non ha quelle colonne e Supabase rifiuterebbe l'insert.
    const daInserire = selezionate.map(r => {
      const riga = { ...r }
      delete (riga as Partial<RigaLetta>).duplicato
      delete (riga as Partial<RigaLetta>).avviso
      delete (riga as Partial<RigaLetta>).completaLogId
      return riga
    })

    setSalvando(true)
    setErrore(null)
    const supabase = createClient()
    const { data: create, error } = await supabase.from('prenotazioni').insert(daInserire).select('id')
    setSalvando(false)

    if (error) { setErrore(error.message); return }

    // Le righe che completavano una voce in coda vanno chiuse: l'orario
    // ora c'è, non deve più comparire come "da completare". Best-effort —
    // se questo fallisce le prenotazioni sono comunque create, resta solo
    // una voce di coda ormai superata da sistemare al volo.
    const daChiudere = selezionate
      .map((r, i) => (r.completaLogId ? { logId: r.completaLogId, prenotazioneId: create?.[i]?.id } : null))
      .filter((x): x is { logId: string; prenotazioneId: string } => !!x?.prenotazioneId)

    if (daChiudere.length > 0) {
      await Promise.all(
        daChiudere.map(({ logId, prenotazioneId }) =>
          supabase
            .from('prenotazioni_email_log')
            .update({ esito: 'importata', prenotazione_id: prenotazioneId })
            .eq('id', logId)
        )
      )
    }

    onImportate(daInserire.length)
    reset()
    onOpenChange(false)
  }

  const selezionateCount = righe ? righe.length - escluse.size : 0
  const doppioni = righe?.filter(r => r.duplicato).length ?? 0
  const completamenti = righe?.filter(r => r.completaLogId).length ?? 0

  return (
    <Dialog open={open} onOpenChange={o => { if (!leggendo && !salvando) { if (!o) reset(); onOpenChange(o) } }}>
      <DialogContent className="cassa cassa-perforated-top max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="cassa-display text-lg">Importa prenotazioni</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Carica l&apos;esportazione del libro visite (Excel, CSV o PDF). Le colonne vengono
          riconosciute automaticamente: controlla l&apos;anteprima prima di confermare.
        </p>

        {/* Va dichiarata: non si indovina dal contenuto del file, e decide
            l'icona (F/R) con cui la prenotazione comparirà in agenda —
            la stessa delle prenotazioni arrivate via mail. */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium">File esportato da</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={fonte === 'thefork' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setFonte('thefork')}
              disabled={leggendo || salvando}
            >
              TheFork
            </Button>
            <Button
              type="button"
              variant={fonte === 'restoo' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setFonte('restoo')}
              disabled={leggendo || salvando}
            >
              Restoo
            </Button>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.txt,.pdf,image/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) leggi(f) }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={leggendo || salvando}>
            <Upload className="h-4 w-4" /> Scegli file
          </Button>
          {nomeFile && <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{nomeFile}</span>}
        </div>

        {leggendo && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lettura del file in corso…
          </p>
        )}

        {/* Quadratura col riepilogo stampato sull'export: è ciò che
            distingue "ho letto qualcosa" da "ho letto bene". */}
        {verifica && (
          <div
            className={cn(
              'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
              !verifica.confrontoDisponibile
                ? 'border-border bg-secondary/50 text-muted-foreground'
                : verifica.quadra
                  ? 'border-[hsl(var(--cassa-positive))]/40 bg-[hsl(var(--cassa-positive-bg))] text-[hsl(var(--cassa-positive))]'
                  : 'border-destructive/40 bg-[hsl(var(--cassa-negative-bg))] text-destructive'
            )}
          >
            {verifica.quadra && verifica.confrontoDisponibile
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1">
              {!verifica.confrontoDisponibile ? (
                <>Il file non riporta un totale di controllo: verifica tu i coperti riga per riga.</>
              ) : verifica.quadra ? (
                <>
                  Lettura verificata: <span className="cassa-numeric font-medium">{verifica.righeLette}</span> prenotazioni
                  e <span className="cassa-numeric font-medium">{verifica.paxCalcolati}</span> coperti,
                  esattamente come dichiara il documento.
                </>
              ) : (
                <>
                  <span className="font-medium">La lettura non quadra col documento.</span>{' '}
                  {verifica.righeDichiarate != null && verifica.righeDichiarate !== verifica.righeLette && (
                    <>Il file dichiara <span className="cassa-numeric">{verifica.righeDichiarate}</span> prenotazioni,
                    ne ho lette <span className="cassa-numeric">{verifica.righeLette}</span>. </>
                  )}
                  {verifica.paxDichiarati != null && verifica.paxDichiarati !== verifica.paxCalcolati && (
                    <>Il file dichiara <span className="cassa-numeric">{verifica.paxDichiarati}</span> coperti,
                    ne ho contati <span className="cassa-numeric">{verifica.paxCalcolati}</span>. </>
                  )}
                  Controlla le righe prima di importare.
                </>
              )}
            </span>
          </div>
        )}

        {righe && (
          <div className="space-y-2">
            <p className="text-sm">
              <span className="cassa-numeric font-medium">{selezionateCount}</span> di {righe.length} da importare
              {completamenti > 0 && (
                <span className="text-[hsl(var(--cassa-copper))]"> · {completamenti} completano una prenotazione in coda</span>
              )}
              {doppioni > 0 && (
                <span className="text-muted-foreground"> · {doppioni} già in agenda</span>
              )}
              {scartate > 0 && (
                <span className="text-muted-foreground"> · {scartate} righe incomplete scartate</span>
              )}
            </p>

            {righe.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessuna prenotazione riconosciuta in questo file.</p>
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {righe.map((r, i) => (
                  <label key={i} className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0"
                      checked={!escluse.has(i)}
                      onChange={() => setEscluse(prev => {
                        const next = new Set(prev)
                        if (next.has(i)) next.delete(i); else next.add(i)
                        return next
                      })}
                    />
                    <span className="min-w-0 flex-1 break-words">
                      <span className="font-medium">{[r.nome, r.cognome].filter(Boolean).join(' ')}</span>
                      <span className="text-muted-foreground">
                        {' '}· <span className="cassa-numeric">{r.data}</span>{' '}
                        <span className="cassa-numeric">{normalizzaOrario(r.orario)}</span>
                        {' '}· <span className="cassa-numeric font-medium text-foreground">{r.persone}</span> coperti
                        {r.bambini > 0 && <> (di cui <span className="cassa-numeric">{r.bambini}</span> bambini)</>}
                      </span>
                      {r.duplicato && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-[hsl(var(--cassa-copper))]">
                          <Copy className="h-3 w-3 shrink-0" /> {r.duplicato}
                        </span>
                      )}
                      {r.completaLogId && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-[hsl(var(--cassa-copper))]">
                          <Clock className="h-3 w-3 shrink-0" /> Era in coda senza orario: lo assegna questo import
                        </span>
                      )}
                      {r.avviso && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="h-3 w-3 shrink-0" /> {r.avviso}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {codaSenzaRiscontro.length > 0 && (
          <div className="space-y-2 rounded-md border border-[hsl(var(--cassa-copper))]/40 bg-[hsl(var(--cassa-copper))]/10 px-3 py-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-[hsl(var(--cassa-copper))]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="cassa-numeric">{codaSenzaRiscontro.length}</span> in coda ma non in questo export
            </p>
            <p className="text-xs text-muted-foreground">
              Aspettavano solo l&apos;orario ma non risultano più tra le prenotazioni attive: probabilmente cancellate prima di riceverne uno.
            </p>
            <div className="space-y-1">
              {codaSenzaRiscontro.map(v => (
                <div key={v.logId} className="flex items-center justify-between gap-2 rounded bg-background/60 px-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{[v.nome, v.cognome].filter(Boolean).join(' ')}</span>
                    <span className="text-muted-foreground">
                      {' '}· <span className="cassa-numeric">{v.data}</span> · <span className="cassa-numeric">{v.persone}</span> coperti
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2"
                    disabled={ignorandoId === v.logId || salvando}
                    onClick={() => ignoraCoda(v.logId)}
                  >
                    {ignorandoId === v.logId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Ignora'}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {errore && <p className="text-sm text-destructive">{errore}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={leggendo || salvando}>
            Annulla
          </Button>
          <Button type="button" onClick={conferma} disabled={!righe || selezionateCount === 0 || salvando || leggendo}>
            {salvando
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Importazione…</>
              : `Importa ${selezionateCount || ''}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
