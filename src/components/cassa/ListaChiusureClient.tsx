'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { CassaPill } from '@/components/cassa/CassaPill'
import { CassaFileViewer } from '@/components/cassa/CassaFileViewer'
import { cn } from '@/lib/utils'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { Trash2, FileText, FileSpreadsheet, Pencil, Loader2 } from 'lucide-react'

const TZ = 'Europe/Rome'

interface RestaurantOption {
  id: string
  name: string
}

interface Props {
  restaurants: RestaurantOption[]
  role: 'manager' | 'cassiere'
}

interface Riga {
  id: string
  data: string
  restaurant_id: string
  restaurant_name: string
  totale_entrate: number
  totale_spese_giornaliere: number
  differenza: number
  entrate_contanti: number
  entrate_pos: number
  entrate_bonifico: number
}

function monthRange(month: string): { start: string; end: string } {
  const [year, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const lastDay = new Date(year, m, 0).getDate()
  const end = `${month}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

export function ListaChiusureClient({ restaurants, role }: Props) {
  const router = useRouter()
  const [selectedRestaurants, setSelectedRestaurants] = useState<string[]>([])
  const [month, setMonth] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM'))
  const [righe, setRighe] = useState<Riga[]>([])
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState<string | null>(null)

  function toggleRestaurant(id: string) {
    setSelectedRestaurants(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id])
  }

  const targets = selectedRestaurants.length > 0 ? selectedRestaurants : restaurants.map(r => r.id)
  const targetsKey = JSON.stringify(targets)

  // Scarta il risultato di un fetch superato da uno più recente — senza
  // questa guardia, un reload innescato dal canale realtime durante
  // un'eliminazione (o due reload ravvicinati) possono risolversi fuori
  // ordine e far ricomparire righe già rimosse, "rompendo" la lista.
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const myRequest = ++requestId.current
    setLoading(true)
    if (targets.length === 0) { setRighe([]); setLoading(false); return }
    const { start, end } = monthRange(month)
    const supabase = createClient()
    const { data } = await supabase
      .from('cassa_chiusure')
      .select('id, data, restaurant_id, totale_entrate, totale_spese_giornaliere, differenza, entrate_contanti, entrate_pos, entrate_bonifico, restaurant:restaurants(name)')
      .in('restaurant_id', targets)
      .eq('stato', 'confermata')
      .gte('data', start)
      .lte('data', end)
      .order('data', { ascending: false })

    if (requestId.current !== myRequest) return

    setRighe(((data ?? []) as unknown as Array<Riga & { restaurant: { name: string } | null }>).map(r => ({
      id: r.id,
      data: r.data,
      restaurant_id: r.restaurant_id,
      restaurant_name: r.restaurant?.name ?? '—',
      totale_entrate: r.totale_entrate,
      totale_spese_giornaliere: r.totale_spese_giornaliere,
      differenza: r.differenza,
      entrate_contanti: r.entrate_contanti,
      entrate_pos: r.entrate_pos,
      entrate_bonifico: r.entrate_bonifico,
    })))
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, targetsKey])

  useEffect(() => { load() }, [load])

  // Riflette in tempo reale le modifiche fatte altrove (es. approvazione di
  // una richiesta di modifica, o modifica diretta dalla vista Chiusura)
  // senza dover ricaricare la pagina.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('cassa_chiusure_lista')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cassa_chiusure' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  // Dialog di conferma in-app invece di window.confirm(): oltre a essere
  // coerente con lo stile dell'app, alcuni browser mobile/PWA sopprimono
  // o ignorano i dialog nativi sincroni — il tasto Elimina risultava
  // premuto ma senza alcun effetto visibile.
  const [daEliminare, setDaEliminare] = useState<Riga | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function confermaEliminazione() {
    if (!daEliminare) return
    const id = daEliminare.id
    setWorkingId(id)
    setDeleteError(null)
    const supabase = createClient()
    const { error } = await supabase.from('cassa_chiusure').delete().eq('id', id)
    setWorkingId(null)
    if (error) { setDeleteError(error.message); return }
    setDaEliminare(null)
    // Aggiornamento ottimistico per un feedback immediato, poi un reload
    // completo (con guardia di staleness) per allinearsi allo stato reale
    // — invece di affidarsi al solo canale realtime, che su una
    // connessione lenta può arrivare in ritardo o fuori ordine.
    setRighe(prev => prev.filter(r => r.id !== id))
    load()
  }

  const [viewer, setViewer] = useState<{ riga: Riga; format: 'pdf' | 'xlsx' } | null>(null)

  function handleView(riga: Riga, format: 'pdf' | 'xlsx') {
    setViewer({ riga, format })
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

      <Card className="cassa-perforated-top">
        <CardContent className="pt-6">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="space-y-1.5 min-w-0">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Skeleton className="h-8 w-8 rounded-md" />
                    <Skeleton className="h-8 w-8 rounded-md" />
                    <Skeleton className="h-8 w-8 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          ) : righe.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna chiusura confermata nel mese selezionato.</p>
          ) : (
            <div className="divide-y divide-border">
              {righe.map(r => {
                const isBalanced = Math.abs(r.differenza) < 0.005
                const dataLabel = formatInTimeZone(`${r.data}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })
                const busy = workingId === r.id
                return (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.restaurant_name} · {dataLabel}</p>
                      <p className="cassa-numeric text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-1.5">
                        <span className="whitespace-nowrap">Entrate € {r.totale_entrate.toFixed(2)}</span>
                        <span>·</span>
                        <span className="whitespace-nowrap">Spese € {r.totale_spese_giornaliere.toFixed(2)}</span>
                        <span>·</span>
                        <span className={cn(isBalanced ? 'text-cassa-positive' : 'text-cassa-negative', 'font-medium whitespace-nowrap')}>
                          {isBalanced ? 'in pareggio' : `differenza ${r.differenza > 0 ? '+' : ''}${r.differenza.toFixed(2)} €`}
                        </span>
                      </p>
                      <p className="cassa-numeric text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-1.5">
                        <span className="whitespace-nowrap">Contanti € {r.entrate_contanti.toFixed(2)}</span>
                        <span>·</span>
                        <span className="whitespace-nowrap">POS € {r.entrate_pos.toFixed(2)}</span>
                        <span>·</span>
                        <span className="whitespace-nowrap">Bonifico € {r.entrate_bonifico.toFixed(2)}</span>
                        <span>·</span>
                        <span className="whitespace-nowrap">
                          Margine Operativo{' '}
                          {(r.totale_entrate - r.totale_spese_giornaliere) < 0 ? '−' : ''}€ {Math.abs(r.totale_entrate - r.totale_spese_giornaliere).toFixed(2)}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Modifica"
                        disabled={busy}
                        onClick={() => router.push(`/cassa/chiusura?restaurant_id=${r.restaurant_id}&data=${r.data}`)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Visualizza PDF"
                        disabled={busy}
                        onClick={() => handleView(r, 'pdf')}
                      >
                        <FileText className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Visualizza Excel"
                        disabled={busy}
                        onClick={() => handleView(r, 'xlsx')}
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                      </Button>
                      {role === 'manager' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="Elimina"
                          disabled={busy}
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

      <CassaFileViewer
        open={!!viewer}
        onOpenChange={open => { if (!open) setViewer(null) }}
        request={viewer ? { url: '/api/cassa/chiusura-export', body: { chiusura_id: viewer.riga.id, format: viewer.format } } : null}
        format={viewer?.format ?? null}
        title={viewer ? `${viewer.riga.restaurant_name} · ${formatInTimeZone(`${viewer.riga.data}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })}` : ''}
        fileNameBase={viewer ? `chiusura-${viewer.riga.restaurant_name.replace(/[^a-zA-Z0-9]+/g, '-')}-${viewer.riga.data}` : 'chiusura'}
      />

      <Dialog open={!!daEliminare} onOpenChange={open => { if (!open) { setDaEliminare(null); setDeleteError(null) } }}>
        <DialogContent className="cassa-perforated-top">
          <DialogHeader>
            <DialogTitle className="cassa-display text-lg">Eliminare questa chiusura?</DialogTitle>
          </DialogHeader>
          {daEliminare && (
            <p className="text-sm text-muted-foreground">
              {daEliminare.restaurant_name} · {formatInTimeZone(`${daEliminare.data}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })}
              {' '}— verranno eliminate definitivamente anche le spese collegate. L&apos;operazione non è reversibile.
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
