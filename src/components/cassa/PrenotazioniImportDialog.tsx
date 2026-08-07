'use client'
import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Upload } from 'lucide-react'
import { formatPax, normalizzaOrario } from '@/lib/cassa/prenotazioniAgenda'
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
  const [scartate, setScartate] = useState(0)
  const [escluse, setEscluse] = useState<Set<number>>(new Set())
  const [errore, setErrore] = useState<string | null>(null)

  function reset() {
    setNomeFile(null); setRighe(null); setScartate(0)
    setEscluse(new Set()); setErrore(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function leggi(file: File) {
    setNomeFile(file.name)
    setLeggendo(true)
    setErrore(null)
    setRighe(null)

    try {
      const form = new FormData()
      form.append('file', file)
      form.append('restaurant_id', restaurantId)
      const res = await fetch('/api/cassa/prenotazioni/importa', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Lettura non riuscita')
      setRighe(json.prenotazioni as RigaLetta[])
      setScartate(json.scartate as number)
      setEscluse(new Set())
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Lettura non riuscita')
    } finally {
      setLeggendo(false)
    }
  }

  async function conferma() {
    if (!righe) return
    const daInserire = righe.filter((_, i) => !escluse.has(i))
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

        {righe && (
          <div className="space-y-2">
            <p className="text-sm">
              <span className="cassa-numeric font-medium">{selezionate}</span> prenotazioni da importare
              {scartate > 0 && (
                <span className="text-muted-foreground"> · {scartate} righe scartate perché incomplete</span>
              )}
            </p>

            {righe.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessuna prenotazione riconosciuta in questo file.</p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {righe.map((r, i) => (
                  <label key={i} className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                    <input
                      type="checkbox"
                      className="mt-1"
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
                        <span className="cassa-numeric">{normalizzaOrario(r.orario)}</span>{' '}
                        · <span className="cassa-numeric">{formatPax(r)}</span> pax
                      </span>
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
