'use client'
import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Upload, CheckCircle2, AlertTriangle, Copy } from 'lucide-react'
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
  origine:            'import'
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
}

interface Verifica {
  paxCalcolati:         number
  paxDichiarati:        number | null
  righeLette:           number
  righeDichiarate:      number | null
  quadra:               boolean
  confrontoDisponibile: boolean
}

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  restaurantId: string
  onImportate:  (quante: number) => void
}

export function PrenotazioniImportDialog({ open, onOpenChange, restaurantId, onImportate }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [nomeFile, setNomeFile] = useState<string | null>(null)
  const [leggendo, setLeggendo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [righe, setRighe] = useState<RigaLetta[] | null>(null)
  const [verifica, setVerifica] = useState<Verifica | null>(null)
  const [scartate, setScartate] = useState(0)
  const [escluse, setEscluse] = useState<Set<number>>(new Set())
  const [errore, setErrore] = useState<string | null>(null)

  function reset() {
    setNomeFile(null); setRighe(null); setVerifica(null); setScartate(0)
    setEscluse(new Set()); setErrore(null)
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
      const res = await fetch('/api/cassa/prenotazioni/importa', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Lettura non riuscita')

      const lette = json.prenotazioni as RigaLetta[]
      setRighe(lette)
      setVerifica(json.verifica as Verifica)
      setScartate(json.scartate as number)
      // Doppioni e righe con coperti illeggibili partono deselezionati:
      // importarli è una scelta da fare, non il comportamento di default.
      setEscluse(new Set(lette.flatMap((r, i) => (r.duplicato || r.avviso ? [i] : []))))
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Lettura non riuscita')
    } finally {
      setLeggendo(false)
    }
  }

  async function conferma() {
    if (!righe) return
    // duplicato e avviso servono solo all'anteprima: la tabella non ha
    // quelle colonne e Supabase rifiuterebbe l'insert.
    const daInserire = righe
      .filter((_, i) => !escluse.has(i))
      .map(r => {
        const riga = { ...r }
        delete (riga as Partial<RigaLetta>).duplicato
        delete (riga as Partial<RigaLetta>).avviso
        return riga
      })
    if (daInserire.length === 0) return

    setSalvando(true)
    setErrore(null)
    const supabase = createClient()
    const { error } = await supabase.from('prenotazioni').insert(daInserire)
    setSalvando(false)

    if (error) { setErrore(error.message); return }
    onImportate(daInserire.length)
    reset()
    onOpenChange(false)
  }

  const selezionate = righe ? righe.length - escluse.size : 0
  const doppioni = righe?.filter(r => r.duplicato).length ?? 0

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
              <span className="cassa-numeric font-medium">{selezionate}</span> di {righe.length} da importare
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

        {errore && <p className="text-sm text-destructive">{errore}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={leggendo || salvando}>
            Annulla
          </Button>
          <Button type="button" onClick={conferma} disabled={!righe || selezionate === 0 || salvando || leggendo}>
            {salvando
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Importazione…</>
              : `Importa ${selezionate || ''}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
