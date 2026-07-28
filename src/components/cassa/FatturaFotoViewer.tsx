'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'

const BUCKET = 'fatture_foto'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  fotoPaths: string[]
  title: string
}

// Foto originali di una fattura, una sotto l'altra (Task 3) — stessa
// chiusura (Dialog) del visualizzatore PDF/Excel già esistente
// (CassaFileViewer), ma qui niente da generare lato server: solo URL
// firmati sul bucket privato fatture_foto, come già fatto per le foto di
// timbratura fallback.
export function FatturaFotoViewer({ open, onOpenChange, fotoPaths, title }: Props) {
  const [urls, setUrls] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cassa-perforated-top flex max-h-[85vh] max-w-2xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="cassa-display text-lg">{title}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto">
          {error && <p className="text-sm text-destructive">Errore nel caricamento delle foto: {error}</p>}
          {!error && !urls && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {urls?.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- URL firmato temporaneo su storage privato, next/image non si applica
            <img key={i} src={url} alt={`Pagina ${i + 1}`} className="w-full rounded-md border border-border" />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
