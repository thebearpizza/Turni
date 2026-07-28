'use client'
import { useState } from 'react'
import { compressImage } from '@/lib/compressImage'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Camera, X, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ArticoloTipologia } from '@/types'

const TIPOLOGIA_LABELS: Record<ArticoloTipologia, string> = {
  food: 'Food',
  beverage: 'Beverage',
  detergenza: 'Detergenza',
  altro_no_food: 'Altro no-food',
}

interface AliquotaEstratta {
  aliquota: number
  imponibile: number
  iva: number
}

interface ArticoloEstratto {
  testo_estratto: string
  quantita: number
  prezzo_riga: number
  esito: 'auto_mappato' | 'chiaro' | 'ambiguo' | 'nuovo'
  catalogo_articolo_id: string | null
  candidato_nome: string | null
}

interface EstraiResponse {
  duplicato: boolean
  fattura_esistente_id?: string
  foto_paths: string[]
  fornitore: { id: string; nome: string; partita_iva: string | null; nuovo: boolean }
  fattura?: {
    data: string
    numero_documento: string
    ha_articoli: boolean
    iva_dettaglio: AliquotaEstratta[]
    totale_netto: number
    totale_iva: number
    totale_lordo: number
  }
  articoli?: ArticoloEstratto[]
}

export interface FatturaRisolta {
  foto_paths: string[]
  fornitore: { id: string; nome: string; partita_iva: string | null }
  data: string
  numero_documento: string
  ha_articoli: boolean
  iva_dettaglio: AliquotaEstratta[]
  totale_netto: number
  totale_iva: number
  totale_lordo: number
  articoli: Array<{ testo_estratto: string; quantita: number; prezzo_riga: number; catalogo_articolo_id: string }>
}

interface Props {
  restaurantId: string
  onComplete: (fattura: FatturaRisolta) => void
  onCancel: () => void
}

// Cattura multi-pagina + pipeline di estrazione/matching (Task 1). Non
// salva la fattura — restituisce i dati risolti a onComplete perché il
// chiamante (Task 2/3) applichi le verifiche sui campi sospetti e il
// salvataggio definitivo.
export function FatturaCapture({ restaurantId, onComplete, onCancel }: Props) {
  const [pages, setPages] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [status, setStatus] = useState<'capturing' | 'processing' | 'review' | 'duplicate'>('capturing')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EstraiResponse | null>(null)
  const [resolved, setResolved] = useState<Map<string, string>>(new Map())
  const [confirmingIndex, setConfirmingIndex] = useState<number | null>(null)

  async function handleAddPage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    // Larghezza/qualità più alte del default (800/0.7): l'OCR deve leggere
    // numeri e testo piccoli, non solo riconoscere un volto come nel
    // fallback timbrature.
    let compressed = file
    try { compressed = await compressImage(file, 1600, 0.85) } catch { /* usa l'originale */ }
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

  async function handleElabora() {
    setStatus('processing')
    setError(null)
    try {
      const fd = new FormData()
      fd.append('restaurant_id', restaurantId)
      pages.forEach((p, i) => fd.append(`photo_${i}`, p))

      const res = await fetch('/api/cassa/fatture/estrai', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Errore nella lettura della fattura')
        setStatus('capturing')
        return
      }

      setResult(data)
      setStatus(data.duplicato ? 'duplicate' : 'review')
    } catch {
      setError('Errore di rete, riprova')
      setStatus('capturing')
    }
  }

  async function confermaArticolo(
    articolo: ArticoloEstratto,
    decisione: 'stesso' | 'nuovo',
    payload: { catalogo_articolo_id?: string; nuovo_articolo?: { nome_articolo: string; tipologia: ArticoloTipologia; unita_misura?: string; fattore_conversione?: number } }
  ) {
    if (!result) return
    try {
      const res = await fetch('/api/cassa/fatture/conferma-articolo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          fornitore_id: result.fornitore.id,
          testo_estratto: articolo.testo_estratto,
          decisione,
          ...payload,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Errore nel salvataggio della scelta'); return }
      setResolved(prev => new Map(prev).set(articolo.testo_estratto, data.catalogo_articolo_id))
      setConfirmingIndex(null)
    } catch {
      setError('Errore di rete, riprova')
    }
  }

  function isArticoloRisolto(a: ArticoloEstratto): string | null {
    if (a.esito === 'auto_mappato' || a.esito === 'chiaro') return a.catalogo_articolo_id
    return resolved.get(a.testo_estratto) ?? null
  }

  const articoli = result?.articoli ?? []
  const tuttiRisolti = articoli.every(a => isArticoloRisolto(a) !== null)

  function handleConferma() {
    if (!result?.fattura || !tuttiRisolti) return
    onComplete({
      foto_paths: result.foto_paths,
      fornitore: result.fornitore,
      data: result.fattura.data,
      numero_documento: result.fattura.numero_documento,
      ha_articoli: result.fattura.ha_articoli,
      iva_dettaglio: result.fattura.iva_dettaglio,
      totale_netto: result.fattura.totale_netto,
      totale_iva: result.fattura.totale_iva,
      totale_lordo: result.fattura.totale_lordo,
      articoli: articoli.map(a => ({
        testo_estratto: a.testo_estratto,
        quantita: a.quantita,
        prezzo_riga: a.prezzo_riga,
        catalogo_articolo_id: isArticoloRisolto(a) as string,
      })),
    })
  }

  if (status === 'duplicate') {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-destructive">Possibile doppione</p>
            <p className="text-muted-foreground">
              Una fattura di <strong>{result?.fornitore.nome}</strong> con lo stesso numero documento è già presente a sistema. Non è stata salvata.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={onCancel}>Chiudi</Button>
      </div>
    )
  }

  if (status === 'review' && result?.fattura) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 space-y-1 text-sm">
          <p><span className="text-muted-foreground">Fornitore</span> <strong>{result.fornitore.nome}</strong>{result.fornitore.nuovo && <Badge variant="secondary" className="ml-2">nuovo</Badge>}</p>
          <p><span className="text-muted-foreground">Data</span> <span className="cassa-numeric">{result.fattura.data}</span> · <span className="text-muted-foreground">Documento</span> <span className="cassa-numeric">{result.fattura.numero_documento}</span></p>
          <p className="cassa-numeric"><span className="text-muted-foreground font-sans">Netto</span> € {result.fattura.totale_netto.toFixed(2)} · <span className="text-muted-foreground font-sans">IVA</span> € {result.fattura.totale_iva.toFixed(2)} · <span className="text-muted-foreground font-sans">Lordo</span> € {result.fattura.totale_lordo.toFixed(2)}</p>
        </div>

        {articoli.length > 0 && (
          <div className="space-y-2">
            <Label>Articoli ({articoli.length})</Label>
            {articoli.map((a, i) => {
              const risoltoId = isArticoloRisolto(a)
              const needsConfirm = a.esito === 'ambiguo' || a.esito === 'nuovo'
              return (
                <div key={`${a.testo_estratto}-${i}`} className="rounded-md border border-border px-3 py-2 text-sm space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{a.testo_estratto}</span>
                    <span className="cassa-numeric text-muted-foreground whitespace-nowrap">{a.quantita} × · € {a.prezzo_riga.toFixed(2)}</span>
                  </div>
                  {risoltoId ? (
                    <Badge variant="secondary">
                      {a.esito === 'auto_mappato' ? 'già noto' : a.esito === 'chiaro' ? 'abbinato' : 'confermato'}
                    </Badge>
                  ) : confirmingIndex === i ? (
                    <ArticoloConfirmForm
                      articolo={a}
                      onStesso={() => confermaArticolo(a, 'stesso', { catalogo_articolo_id: a.catalogo_articolo_id as string })}
                      onNuovo={payload => confermaArticolo(a, 'nuovo', { nuovo_articolo: payload })}
                      onAnnulla={() => setConfirmingIndex(null)}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        {a.esito === 'ambiguo' ? `È lo stesso articolo di "${a.candidato_nome}"?` : 'Articolo non riconosciuto'}
                      </span>
                      <Button type="button" size="sm" variant="outline" onClick={() => setConfirmingIndex(i)}>
                        {needsConfirm ? 'Conferma' : 'Rivedi'}
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>Annulla</Button>
          <Button type="button" onClick={handleConferma} disabled={!tuttiRisolti}>
            Continua
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {previews.map((src, i) => (
          <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-md border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element -- anteprima locale da blob URL, next/image non si applica */}
            <img src={src} alt={`Pagina ${i + 1}`} className="h-full w-full object-cover" />
            <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{i + 1}</span>
            <button
              type="button"
              onClick={() => removePage(i)}
              className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        <label className={cn(
          'flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent',
        )}>
          <Camera className="h-5 w-5" />
          <span className="text-xs">Aggiungi pagina</span>
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleAddPage} />
        </label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Annulla</Button>
        <Button type="button" onClick={handleElabora} disabled={pages.length === 0 || status === 'processing'}>
          {status === 'processing' ? <><Loader2 className="h-4 w-4 animate-spin" /> Elaborazione…</> : `Elabora (${pages.length} ${pages.length === 1 ? 'pagina' : 'pagine'})`}
        </Button>
      </div>
    </div>
  )
}

// Form inline per confermare un match ambiguo ("è lo stesso di X? Sì/No, è
// nuovo") o, se non c'è un candidato suggerito (esito 'nuovo'), per
// registrare direttamente il nuovo articolo con la sua tipologia.
function ArticoloConfirmForm({
  articolo, onStesso, onNuovo, onAnnulla,
}: {
  articolo: ArticoloEstratto
  onStesso: () => void
  onNuovo: (payload: { nome_articolo: string; tipologia: ArticoloTipologia; unita_misura?: string; fattore_conversione?: number }) => void
  onAnnulla: () => void
}) {
  const haCandidato = articolo.esito === 'ambiguo' && !!articolo.catalogo_articolo_id
  const [creaNuovo, setCreaNuovo] = useState(!haCandidato)
  const [nome, setNome] = useState(articolo.testo_estratto)
  const [tipologia, setTipologia] = useState<ArticoloTipologia | ''>('')
  const [unita, setUnita] = useState('')

  if (!creaNuovo) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2">
        <span className="text-xs text-muted-foreground">Stesso articolo di &quot;{articolo.candidato_nome}&quot;?</span>
        <Button type="button" size="sm" onClick={onStesso}>Sì, è lo stesso</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setCreaNuovo(true)}>No, è nuovo</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onAnnulla}>Annulla</Button>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-2">
      <div className="space-y-1">
        <Label className="text-xs">Nome articolo</Label>
        <Input value={nome} onChange={e => setNome(e.target.value)} className="h-8" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Tipologia</Label>
          <Select value={tipologia} onValueChange={v => setTipologia(v as ArticoloTipologia)}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Seleziona" /></SelectTrigger>
            <SelectContent>
              {(Object.keys(TIPOLOGIA_LABELS) as ArticoloTipologia[]).map(t => (
                <SelectItem key={t} value={t}>{TIPOLOGIA_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Unità misura (opz.)</Label>
          <Input value={unita} onChange={e => setUnita(e.target.value)} className="h-8" placeholder="kg, L, pz…" />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        {haCandidato && <Button type="button" size="sm" variant="ghost" onClick={() => setCreaNuovo(false)}>Indietro</Button>}
        <Button type="button" size="sm" variant="ghost" onClick={onAnnulla}>Annulla</Button>
        <Button
          type="button" size="sm"
          disabled={!nome.trim() || !tipologia}
          onClick={() => onNuovo({ nome_articolo: nome.trim(), tipologia: tipologia as ArticoloTipologia, unita_misura: unita.trim() || undefined })}
        >
          Salva come nuovo
        </Button>
      </div>
    </div>
  )
}
