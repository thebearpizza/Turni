'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, FileText, RotateCw } from 'lucide-react'
import type { RiquadroArticolo } from '@/types'

const BUCKET = 'fatture_foto'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  fotoPaths: string[]
  title: string
  // Presente solo quando la fattura è ancora modificabile (Fatture, non
  // usato altrove): rilegge le stesse foto da capo, per quando la prima
  // lettura ha sbagliato fornitore, importi o articoli.
  onRescan?: () => void
  // Presente solo quando si apre il visualizzatore per UN articolo
  // preciso (icona occhio in Articoli): scorre alla foto giusta e ne
  // evidenzia la riga. paginaIndice è l'indice in fotoPaths; null se
  // l'articolo non ha un riquadro stimato (fatture salvate prima di
  // questo campo, o lettura AI che non è riuscita a localizzarlo) — in
  // quel caso si mostra la foto come sempre, senza overlay.
  evidenzia?: { paginaIndice: number; riquadro: RiquadroArticolo } | null
}

// Foto originali di una fattura, una sotto l'altra (Task 3) — stessa
// chiusura (Dialog) del visualizzatore PDF/Excel già esistente
// (CassaFileViewer), ma qui niente da generare lato server: solo URL
// firmati sul bucket privato fatture_foto, come già fatto per le foto di
// timbratura fallback.
export function FatturaFotoViewer({ open, onOpenChange, fotoPaths, title, onRescan, evidenzia }: Props) {
  const [urls, setUrls] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const evidenziataRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) { setUrls(null); setError(null); return }
    let cancelled = false
    async function load() {
      const supabase = createClient()
      const results = await Promise.all(
        fotoPaths.map(path => supabase.storage.from(BUCKET).createSignedUrl(path, 300))
      )
      if (cancelled) return
      const failed = results.find(r => r.error)
      if (failed?.error) { setError(failed.error.message); return }
      setUrls(results.map(r => r.data!.signedUrl))
    }
    load()
    return () => { cancelled = true }
  }, [open, fotoPaths])

  // Una volta caricate le foto, se è stato chiesto di evidenziare un
  // articolo preciso porta subito la sua pagina a schermo — su una
  // fattura multipagina il prodotto potrebbe essere molto più in basso
  // dell'elenco, altrimenti bisognerebbe scorrere a mano per trovarlo.
  useEffect(() => {
    if (!urls || !evidenzia) return
    evidenziataRef.current?.scrollIntoView({ block: 'center' })
  }, [urls, evidenzia])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cassa-perforated-top flex max-h-[85vh] max-w-2xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="cassa-display text-lg">{title}</DialogTitle>
        </DialogHeader>

        {onRescan && fotoPaths.length > 0 && (
          <Button type="button" variant="outline" size="sm" className="self-end" onClick={onRescan}>
            <RotateCw className="w-3.5 h-3.5" /> Ri-scansiona documento
          </Button>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto">
          {error && <p className="text-sm text-destructive">Errore nel caricamento delle foto: {error}</p>}
          {!error && !urls && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {urls?.map((url, i) => {
            const isPdf = fotoPaths[i]?.toLowerCase().endsWith('.pdf')
            const riquadro = evidenzia?.paginaIndice === i ? evidenzia.riquadro : null
            return isPdf ? (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-md border border-border p-3 text-sm hover:bg-accent"
              >
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span>Pagina {i + 1} — apri PDF</span>
              </a>
            ) : (
              <div key={i} ref={riquadro ? evidenziataRef : undefined} className="relative overflow-hidden rounded-md border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- URL firmato temporaneo su storage privato, next/image non si applica */}
                <img src={url} alt={`Pagina ${i + 1}`} className="w-full" />
                {riquadro && (
                  <div
                    className="pointer-events-none absolute rounded-sm border-2 border-primary"
                    style={{
                      top: `${riquadro.y_min / 10}%`,
                      left: `${riquadro.x_min / 10}%`,
                      width: `${(riquadro.x_max - riquadro.x_min) / 10}%`,
                      height: `${(riquadro.y_max - riquadro.y_min) / 10}%`,
                      boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
