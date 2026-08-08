'use client'
import { useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CountInput } from '@/components/ui/count-input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

// Un passante non è una prenotazione: arriva, si siede, non ha nome né
// orario scelto da nessuno — solo quante persone sono. Un solo campo
// apposta, non il modulo completo.

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  onConferma:   (persone: number) => Promise<void>
}

export function PassanteDialog({ open, onOpenChange, onConferma }: Props) {
  const [persone, setPersone] = useState(2)
  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  async function salva() {
    if (persone < 1 || salvando) return
    setSalvando(true)
    setErrore(null)
    try {
      await onConferma(persone)
      setPersone(2)
      onOpenChange(false)
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Salvataggio non riuscito')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!salvando) { if (!o) setErrore(null); onOpenChange(o) } }}>
      <DialogContent className="cassa cassa-perforated-top">
        <DialogHeader>
          <DialogTitle className="cassa-display text-lg">Nuovo passante</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Un tavolo seduto subito, senza prenotazione: basta il numero di persone.
        </p>

        <div className="space-y-2">
          <Label>Persone</Label>
          <CountInput value={persone} onChange={setPersone} min={1} />
        </div>

        {errore && <p className="text-sm text-destructive">{errore}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Annulla
          </Button>
          <Button type="button" onClick={salva} disabled={salvando || persone < 1}>
            {salvando ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvataggio…</> : 'Siedi al tavolo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
