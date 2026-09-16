'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/compressImage'
import { DocumentScanner } from '@/components/acquisti/DocumentScanner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Camera, Upload, X, Loader2, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ReportChiusuraEstratto {
  data: string | null
  coperti: number | null
  entrate_contanti: number
  entrate_pos: number
  entrate_bonifico: number
  scostamento_totale: number | null
}

const BUCKET = 'chiusura_report_foto'

interface Props {
  restaurantId: string
  // Data della chiusura che si sta compilando (non quella letta dal
  // documento) — usata per lo scarico Inventario e per il confronto
  // "hai caricato il report del giorno giusto?" fatto dal chiamante.
  data: string
  onEstratto: (r: ReportChiusuraEstratto) => void
}

// Caricamento del report di chiusura (Fase 1, primo passo) — versione
// molto più semplice di FatturaCapture: un solo documento, nessuna
// risoluzione fornitore/doppione/articolo, un solo risultato atteso.
// Riusa lo stesso scanner con ritaglio prospettico e lo stesso
// meccanismo "carica su storage poi passa solo i percorsi" per restare
// sotto il limite di corpo di una funzione serverless.
export function ReportChiusuraCapture({ restaurantId, data, onEstratto }: Props) {
  const [pages, setPages] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'processing' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [daRitagliare, setDaRitagliare] = useState<File | null>(null)
  const [risultato, setRisultato] = useState<ReportChiusuraEstratto | null>(null)

  async function handleAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    e.target.value = ''
    // Una singola immagine passa dal ritaglio prospettico (foto di un
    // report stampato); più file insieme o un PDF si accodano diretti.
    if (files.length === 1 && files[0].type.startsWith('image/')) {
      setDaRitagliare(files[0])
      return
    }
    for (const file of files) await aggiungiPagina(file)
  }

  async function aggiungiPagina(file: File) {
    setDaRitagliare(null)
    let compressed = file
    if (file.type.startsWith('image/')) {
      try { compressed = await compressImage(file, 2200, 0.9) } catch { /* usa l'originale */ }
    }
    setPages(prev => [...prev, compressed])
    setPreviews(prev => [...prev, URL.createObjectURL(compressed)])
  }

  function removePage(i: number) {
    setPages(prev => prev.filter((_, idx) => idx !== i))
    setPreviews(prev => {
      URL.revokeObjectURL(prev[i])
      return prev.filter((_, idx) => idx !== i)
    })
  }

  function reset() {
    previews.forEach(p => URL.revokeObjectURL(p))
    setPages([])
    setPreviews([])
    setStatus('idle')
    setError(null)
    setRisultato(null)
  }

  async function handleLeggi() {
    setStatus('processing')
    setError(null)
    const supabase = createClient()
    const fotoPaths: string[] = []
    try {
      for (let i = 0; i < pages.length; i++) {
        const ext = pages[i].name.split('.').pop() ?? 'jpg'
        const path = `${restaurantId}/${Date.now()}-${i}.${ext}`
        const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, pages[i], {
          contentType: pages[i].type || 'image/jpeg',
          upsert: false,
        })
        if (uploadErr) throw uploadErr
        fotoPaths.push(path)
      }
    } catch (err) {
      if (fotoPaths.length > 0) await supabase.storage.from(BUCKET).remove(fotoPaths)
      setError(err instanceof Error ? `Errore nel caricamento: ${err.message}` : 'Errore nel caricamento')
      setStatus('idle')
      return
    }

    try {
      const res = await fetch('/api/cassa/chiusura/estrai-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId, data, foto_paths: fotoPaths }),
      })
      // Una funzione terminata dalla piattaforma (timeout) risponde con
      // una pagina di errore, non con JSON.
      const result = await res.json().catch(() => null)
      if (!res.ok || !result) {
        setError(
          result?.error ??
          (res.status === 504
            ? 'La lettura ha superato il tempo massimo. Riprova, oppure compila i dati a mano.'
            : `Errore nella lettura (codice ${res.status}). Riprova o compila i dati a mano.`)
        )
        setStatus('idle')
        return
      }
      setRisultato(result)
      setStatus('done')
      onEstratto(result)
    } catch {
      setError('Errore di rete, riprova')
      setStatus('idle')
    }
  }

  if (daRitagliare) {
    return (
      <DocumentScanner
        file={daRitagliare}
        onConfirm={file => aggiungiPagina(file)}
        onCancel={() => setDaRitagliare(null)}
      />
    )
  }

  return (
    <Card className="cassa-perforated-top">
      <CardHeader>
        <CardTitle className="cassa-display text-lg">Report di chiusura</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {status === 'done' && risultato ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Letto: Contanti € {risultato.entrate_contanti.toFixed(2)} · POS € {risultato.entrate_pos.toFixed(2)} · Bonifico € {risultato.entrate_bonifico.toFixed(2)}
              {risultato.coperti != null && <> · Coperti {risultato.coperti}</>}. Controlla i campi qui sotto prima di proseguire.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={reset}>Carica un altro documento</Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Scansiona o carica il report esportato dalla cassa: precompila Contanti, POS, Bonifico e Coperti — i dati non presenti nel report (es. Incasso Asporto, Fondo Cassa Finale) restano da inserire a mano.
            </p>
            {previews.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {previews.map((src, i) => {
                  const isPdf = pages[i]?.type === 'application/pdf'
                  return (
                    <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-md border border-border">
                      {isPdf ? (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-muted p-2 text-center">
                          <FileText className="h-6 w-6 text-muted-foreground" />
                          <span className="line-clamp-2 break-all text-[10px] text-muted-foreground">{pages[i].name}</span>
                        </div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- anteprima locale da blob URL, next/image non si applica
                        <img src={src} alt={`Pagina ${i + 1}`} className="h-full w-full object-cover" />
                      )}
                      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{i + 1}</span>
                      <button
                        type="button"
                        onClick={() => removePage(i)}
                        className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent')}>
                <Camera className="h-4 w-4" /> Scansiona
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleAdd} />
              </label>
              <label className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent')}>
                <Upload className="h-4 w-4" /> Carica file
                <input type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={handleAdd} />
              </label>
              {pages.length > 0 && (
                <Button type="button" onClick={handleLeggi} disabled={status === 'processing'} className="gap-1.5">
                  {status === 'processing' ? <><Loader2 className="h-4 w-4 animate-spin" /> Lettura…</> : `Leggi report (${pages.length})`}
                </Button>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
