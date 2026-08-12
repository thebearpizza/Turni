'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CassaPill } from '@/components/cassa/CassaPill'
import { FatturaCapture, type FatturaRisolta } from '@/components/cassa/FatturaCapture'
import { FatturaFotoViewer } from '@/components/cassa/FatturaFotoViewer'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { Camera, Eye, Upload, Trash2, Loader2 } from 'lucide-react'

const TZ = 'Europe/Rome'

interface RestaurantOption {
  id: string
  name: string
}

interface Props {
  role: 'manager' | 'direttore'
  restaurants: RestaurantOption[]
  categorieDirette: Array<{ id: string; nome: string }>
}

interface ArticoloRiga {
  prezzo_riga: number
  catalogo_articolo: { tipologia: string } | null
}

interface AliquotaRiga {
  aliquota: number
  iva: number
}

interface Riga {
  id: string
  restaurant_id: string
  fornitore_nome: string
  numero_documento: string
  data: string
  ha_articoli: boolean
  categoria_diretta_nome: string | null
  totale_netto: number
  totale_iva: number
  totale_lordo: number
  foto_paths: string[]
  fatture_articoli: ArticoloRiga[]
  fatture_iva_dettaglio: AliquotaRiga[]
}

function monthRange(month: string): { start: string; end: string } {
  const [year, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const lastDay = new Date(year, m, 0).getDate()
  const end = `${month}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

export function FattureClient({ role, restaurants, categorieDirette }: Props) {
  const [selectedRestaurants, setSelectedRestaurants] = useState<string[]>([])
  const [month, setMonth] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM'))
  const [righe, setRighe] = useState<Riga[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadRestaurantId, setUploadRestaurantId] = useState(restaurants[0]?.id ?? '')
  const [captureMode, setCaptureMode] = useState<'file' | 'scan'>('scan')
  const [viewer, setViewer] = useState<Riga | null>(null)

  function openUpload(mode: 'file' | 'scan') {
    // Se il filtro locali è su un solo ristorante, precompila quello nel
    // caricamento invece del primo della lista — è quasi certamente il
    // locale su cui l'utente vuole caricare.
    const daFiltro = selectedRestaurants.length === 1 ? selectedRestaurants[0] : null
    setUploadRestaurantId(daFiltro ?? restaurants[0]?.id ?? '')
    setCaptureMode(mode)
    setUploadOpen(true)
  }

  function toggleRestaurant(id: string) {
    setSelectedRestaurants(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id])
  }

  const targets = selectedRestaurants.length > 0 ? selectedRestaurants : restaurants.map(r => r.id)
  const targetsKey = JSON.stringify(targets)

  // Scarta il risultato di un fetch superato da uno più recente — senza
  // questa guardia, un reload innescato dal canale realtime durante
  // un'eliminazione (o due reload ravvicinati) possono risolversi fuori
  // ordine e far ricomparire righe già rimosse.
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const myRequest = ++requestId.current
    setLoading(true)
    if (targets.length === 0) { setRighe([]); setLoading(false); return }
    const { start, end } = monthRange(month)
    const supabase = createClient()
    const { data } = await supabase
      .from('fatture')
      .select(`
        id, restaurant_id, numero_documento, data, ha_articoli, totale_netto, totale_iva, totale_lordo, foto_paths,
        fornitore:fornitori(nome),
        categoria_diretta:categorie_fatture_dirette(nome),
        fatture_articoli(prezzo_riga, catalogo_articolo:catalogo_articoli(tipologia)),
        fatture_iva_dettaglio(aliquota, iva)
      `)
      .in('restaurant_id', targets)
      .gte('data', start)
      .lte('data', end)
      .order('data', { ascending: false })

    if (requestId.current !== myRequest) return

    setRighe(((data ?? []) as unknown as Array<Riga & { fornitore: { nome: string } | null; categoria_diretta: { nome: string } | null }>).map(r => ({
      id: r.id,
      restaurant_id: r.restaurant_id,
      fornitore_nome: r.fornitore?.nome ?? '—',
      numero_documento: r.numero_documento,
      data: r.data,
      ha_articoli: r.ha_articoli,
      categoria_diretta_nome: r.categoria_diretta?.nome ?? null,
      totale_netto: r.totale_netto,
      totale_iva: r.totale_iva,
      totale_lordo: r.totale_lordo,
      foto_paths: r.foto_paths,
      fatture_articoli: r.fatture_articoli ?? [],
      fatture_iva_dettaglio: r.fatture_iva_dettaglio ?? [],
    })))
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, targetsKey])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('fatture_lista')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fatture' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const kpi = righe.reduce(
    (acc, r) => {
      acc.netto += r.totale_netto
      acc.lordo += r.totale_lordo
      if (r.ha_articoli) {
        for (const a of r.fatture_articoli) {
          if (a.catalogo_articolo?.tipologia === 'food') acc.food += a.prezzo_riga
          else if (a.catalogo_articolo?.tipologia === 'beverage') acc.beverage += a.prezzo_riga
          else if (a.catalogo_articolo?.tipologia === 'detergenza' || a.catalogo_articolo?.tipologia === 'altro_no_food') acc.noFood += a.prezzo_riga
        }
      } else if (r.categoria_diretta_nome === 'Utenze') {
        acc.utenze += r.totale_netto
      } else if (r.categoria_diretta_nome === 'Manutenzione/Attrezzature') {
        acc.manutenzione += r.totale_netto
      }
      return acc
    },
    { netto: 0, lordo: 0, food: 0, beverage: 0, noFood: 0, utenze: 0, manutenzione: 0 }
  )

  // Un caricamento può contenere più fatture insieme (Task batch): questa
  // viene chiamata una volta per OGNI fattura confermata, e FatturaCapture
  // se ne aspetta il risultato per sapere se può passare alla successiva
  // del batch — per questo lancia invece di limitarsi a non chiudere il
  // dialog, così l'errore (es. doppione rilevato solo ora da una richiesta
  // in parallelo) resta visibile sulla fattura corrente invece di sparire.
  async function handleUploadComplete(fattura: FatturaRisolta) {
    const res = await fetch('/api/cassa/fatture/salva', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurant_id: uploadRestaurantId, ...fattura }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error ?? 'Errore nel salvataggio della fattura')
    }
    load()
  }

  // Eliminazione riga fattura (solo manager, come da RLS) — stesso
  // pattern di conferma in-app + staleness guard già usato per le
  // chiusure: window.confirm() è inaffidabile su alcuni browser
  // mobile/PWA.
  const [daEliminare, setDaEliminare] = useState<Riga | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [workingId, setWorkingId] = useState<string | null>(null)

  async function confermaEliminazione() {
    if (!daEliminare) return
    const riga = daEliminare
    setWorkingId(riga.id)
    setDeleteError(null)
    const supabase = createClient()
    // RPC invece del delete diretto: ripulisce anche gli articoli di
    // catalogo che restano senza più nessun acquisto (creati solo per
    // questa fattura), non solo la riga fattura stessa.
    const { error } = await supabase.rpc('elimina_fattura_con_pulizia_articoli', { p_fattura_id: riga.id })
    setWorkingId(null)
    if (error) { setDeleteError(error.message); return }
    setDaEliminare(null)
    setRighe(prev => prev.filter(r => r.id !== riga.id))
    load()
    // Pulizia foto su storage: best-effort, non blocca né fallisce
    // l'eliminazione già avvenuta — file orfani nel bucket non sono un
    // problema di correttezza, solo spazio sprecato se dovesse fallire.
    if (riga.foto_paths.length > 0) {
      supabase.storage.from('fatture_foto').remove(riga.foto_paths).catch(() => {})
    }
  }

  return (
    <div className="space-y-4">
      <Card className="cassa-perforated-top">
        <CardContent className="pt-6 space-y-4">
          {role === 'manager' ? (
            <div className="space-y-2">
              <Label>Ristoranti</Label>
              <div className="flex flex-wrap gap-2">
                {restaurants.map(r => (
                  <CassaPill key={r.id} active={selectedRestaurants.includes(r.id)} onClick={() => toggleRestaurant(r.id)}>
                    {r.name}
                  </CassaPill>
                ))}
              </div>
              {selectedRestaurants.length === 0 && (
                <p className="text-xs text-muted-foreground">Nessuno selezionato: mostro tutti i ristoranti.</p>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Ristorante</Label>
              <div className="flex h-9 w-fit min-w-40 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                {restaurants[0]?.name ?? 'Nessun ristorante assegnato'}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Mese</Label>
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-auto cassa-numeric" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Button type="button" onClick={() => openUpload('file')} disabled={restaurants.length === 0}>
          <Upload className="w-4 h-4" /> Carica fattura
        </Button>
        <Button type="button" onClick={() => openUpload('scan')} disabled={restaurants.length === 0}>
          <Camera className="w-4 h-4" />
          <span className="hidden sm:inline">Scansiona documento</span>
          <span className="sm:hidden">Scansiona</span>
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="border rounded-md p-3 space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ['Totale Netto', kpi.netto],
            ['Totale Lordo', kpi.lordo],
            ['Totale Food', kpi.food],
            ['Totale Beverage', kpi.beverage],
            ['Totale No Food', kpi.noFood],
            ['Totale Utenze', kpi.utenze],
            ['Totale Manutenzione', kpi.manutenzione],
          ].map(([label, value]) => (
            <Card key={label as string} className="cassa-perforated-top">
              <CardContent className="pt-4 pb-3 px-3 space-y-1">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="cassa-numeric text-lg font-semibold">€ {(value as number).toFixed(2)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="cassa-perforated-top">
        <CardContent className="pt-6">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-3">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-8 w-8 rounded-md" />
                </div>
              ))}
            </div>
          ) : righe.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna fattura caricata nel mese selezionato.</p>
          ) : (
            <div className="divide-y divide-border">
              {righe.map(r => {
                const dataLabel = formatInTimeZone(`${r.data}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })
                // Scomposizione per aliquota (4%, 10%, 22%...) invece di
                // un unico totale IVA aggregato — sommata per aliquota nel
                // caso raro di righe duplicate sulla stessa aliquota.
                const ivaPerAliquota = Array.from(
                  r.fatture_iva_dettaglio.reduce((m, x) => m.set(x.aliquota, (m.get(x.aliquota) ?? 0) + x.iva), new Map<number, number>())
                ).sort((a, b) => b[0] - a[0])
                return (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        {r.fornitore_nome} · {dataLabel}
                        <Badge variant="secondary">{r.ha_articoli ? 'articoli' : r.categoria_diretta_nome ?? 'spesa diretta'}</Badge>
                      </div>
                      <p className="cassa-numeric text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-1.5">
                        <span className="whitespace-nowrap">Doc. {r.numero_documento}</span>
                        <span>·</span>
                        <span className="whitespace-nowrap">Netto € {r.totale_netto.toFixed(2)}</span>
                        <span>·</span>
                        {ivaPerAliquota.length > 0 ? (
                          ivaPerAliquota.flatMap(([aliquota, iva], idx) => [
                            idx > 0 && <span key={`sep-${aliquota}`}>·</span>,
                            <span key={aliquota} className="whitespace-nowrap">IVA {aliquota}% € {iva.toFixed(2)}</span>,
                          ]).filter(Boolean)
                        ) : (
                          <span className="whitespace-nowrap">IVA € {r.totale_iva.toFixed(2)}</span>
                        )}
                        <span>·</span>
                        <span className="whitespace-nowrap">Lordo € {r.totale_lordo.toFixed(2)}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Visualizza" disabled={workingId === r.id} onClick={() => setViewer(r)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      {role === 'manager' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="Elimina"
                          disabled={workingId === r.id}
                          onClick={() => setDaEliminare(r)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="cassa cassa-perforated-top flex max-h-[85vh] max-w-lg flex-col gap-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="cassa-display text-lg">
              {captureMode === 'scan' ? 'Scansiona documento' : 'Carica fattura'}
            </DialogTitle>
          </DialogHeader>
          {role === 'manager' && restaurants.length > 1 && (
            <div className="space-y-1.5">
              <Label>Ristorante</Label>
              <Select value={uploadRestaurantId} onValueChange={setUploadRestaurantId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {restaurants.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {uploadRestaurantId && (
            <FatturaCapture
              restaurantId={uploadRestaurantId}
              categorieDirette={categorieDirette}
              initialMode={captureMode}
              onComplete={handleUploadComplete}
              onFinished={() => setUploadOpen(false)}
              onCancel={() => setUploadOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <FatturaFotoViewer
        open={!!viewer}
        onOpenChange={open => { if (!open) setViewer(null) }}
        fotoPaths={viewer?.foto_paths ?? []}
        title={viewer ? `${viewer.fornitore_nome} · ${formatInTimeZone(`${viewer.data}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })}` : ''}
      />

      <Dialog open={!!daEliminare} onOpenChange={open => { if (!open) { setDaEliminare(null); setDeleteError(null) } }}>
        <DialogContent className="cassa cassa-perforated-top">
          <DialogHeader>
            <DialogTitle className="cassa-display text-lg">Eliminare questa fattura?</DialogTitle>
          </DialogHeader>
          {daEliminare && (
            <p className="text-sm text-muted-foreground">
              {daEliminare.fornitore_nome} · {formatInTimeZone(`${daEliminare.data}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })}
              {' '}— verranno eliminati definitivamente anche gli articoli collegati. L&apos;operazione non è reversibile.
            </p>
          )}
          {deleteError && <p className="text-sm text-destructive">Errore nell&apos;eliminazione: {deleteError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setDaEliminare(null); setDeleteError(null) }} disabled={!!workingId}>
              Annulla
            </Button>
            <Button type="button" variant="destructive" onClick={confermaEliminazione} disabled={!!workingId}>
              {workingId ? <><Loader2 className="w-4 h-4 animate-spin" /> Eliminazione…</> : 'Elimina'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
