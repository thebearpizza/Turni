'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { RestaurantMultiSelect } from '@/components/shared/RestaurantMultiSelect'
import { CassaPill } from '@/components/cassa/CassaPill'
import { formatInTimeZone } from 'date-fns-tz'
import { startOfWeek, format } from 'date-fns'
import { it } from 'date-fns/locale'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const TZ = 'Europe/Rome'

interface RestaurantOption {
  id: string
  name: string
}

interface Props {
  restaurants: RestaurantOption[]
}

interface GiornoRow {
  data: string
  contanti_per_banca: number
}

interface RigaLocale {
  restaurant_id: string
  restaurant_name: string
  somma: number
  giorni: GiornoRow[]
}

function fmtDate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function settimanaRange(): { start: string; end: string } {
  const today = new Date(formatInTimeZone(new Date(), TZ, "yyyy-MM-dd'T'12:00:00"))
  return { start: fmtDate(startOfWeek(today, { weekStartsOn: 1 })), end: fmtDate(today) }
}

function formatGiorno(data: string): string {
  const label = formatInTimeZone(`${data}T12:00:00Z`, TZ, 'EEEE dd/MM/yyyy', { locale: it })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function formatEuro(n: number): string {
  return `€ ${n.toFixed(2)}`
}

async function fetchProgressivo(
  supabase: ReturnType<typeof createClient>,
  restaurantIds: string[],
  start: string,
  end: string
): Promise<Array<{ data: string; restaurant_id: string; contanti_per_banca: number }>> {
  if (restaurantIds.length === 0) return []
  const { data } = await supabase
    .from('cassa_chiusure')
    .select('data, restaurant_id, contanti_per_banca')
    .in('restaurant_id', restaurantIds)
    .eq('stato', 'confermata')
    .gte('data', start)
    .lte('data', end)
    .order('data', { ascending: false })
  return data ?? []
}

// Tab "Progressivo Buste": quanto contante risulta destinato alla banca
// (contanti_per_banca, il valore già quadrato in Fase 3 della chiusura),
// sommato per locale e per il totale complessivo di tutti i locali/giorni
// filtrati — la vista che serve per controllare le buste di versamento.
export function ProgressivoBusteClient({ restaurants }: Props) {
  const [selectedRestaurants, setSelectedRestaurants] = useState<string[]>([])
  // Settimana corrente di default e "nessuna selezione = tutti i locali",
  // coerente con le altre viste Cassa (Analisi, Lista Chiusure, Fatture):
  // la pagina mostra già dati utili alla prima apertura.
  const [customStart, setCustomStart] = useState(() => settimanaRange().start)
  const [customEnd, setCustomEnd] = useState(() => settimanaRange().end)
  const [righe, setRighe] = useState<RigaLocale[]>([])
  const [loading, setLoading] = useState(false)
  const [espanso, setEspanso] = useState<string | null>(null)

  const settimana = useMemo(() => settimanaRange(), [])
  const periodoScelto = !!customStart && !!customEnd
  const targets = useMemo(
    () => selectedRestaurants.length > 0 ? selectedRestaurants : restaurants.map(r => r.id),
    [selectedRestaurants, restaurants]
  )
  const pronto = targets.length > 0 && periodoScelto
  const targetsKey = useMemo(() => JSON.stringify(targets), [targets])

  const requestId = useRef(0)

  const load = useCallback(async () => {
    if (!pronto) { setRighe([]); return }
    const myRequest = ++requestId.current
    setLoading(true)
    const supabase = createClient()
    const dati = await fetchProgressivo(supabase, targets, customStart, customEnd)
    if (requestId.current !== myRequest) return

    const nuoveRighe = targets.map(id => {
      const giorni = dati
        .filter(d => d.restaurant_id === id)
        .map(d => ({ data: d.data, contanti_per_banca: d.contanti_per_banca }))
      return {
        restaurant_id: id,
        restaurant_name: restaurants.find(r => r.id === id)?.name ?? '—',
        somma: giorni.reduce((s, g) => s + g.contanti_per_banca, 0),
        giorni,
      }
    })
    setRighe(nuoveRighe)
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, targetsKey, customStart, customEnd])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('cassa_chiusure_progressivo_buste')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cassa_chiusure' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const totaleComplessivo = righe.reduce((s, r) => s + r.somma, 0)

  return (
    <div className="space-y-4">
      <Card className="cassa-perforated-top">
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-2">
            <Label>Locali</Label>
            <RestaurantMultiSelect restaurants={restaurants} selected={selectedRestaurants} onChange={setSelectedRestaurants} emptyLabel="Seleziona i locali" />
            {selectedRestaurants.length === 0 && (
              <p className="text-xs text-muted-foreground">Nessuna selezione: verranno mostrati tutti i locali.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Periodo</Label>
            <div className="flex flex-wrap gap-2">
              <CassaPill
                active={customStart === settimana.start && customEnd === settimana.end}
                onClick={() => { setCustomStart(settimana.start); setCustomEnd(settimana.end) }}
              >
                Settimana
              </CassaPill>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-auto cassa-numeric" />
              <span className="text-muted-foreground text-sm">→</span>
              <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-auto cassa-numeric" />
            </div>
            {!periodoScelto && (
              <p className="text-xs text-muted-foreground">Seleziona un periodo per continuare.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {pronto && (
        <Card className="cassa-perforated-top">
          <CardContent className="pt-6">
            {loading ? (
              <div className="divide-y divide-border">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-3">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {righe.map(r => {
                  const aperto = espanso === r.restaurant_id
                  return (
                    <div key={r.restaurant_id} className="py-2">
                      <button
                        type="button"
                        onClick={() => setEspanso(prev => prev === r.restaurant_id ? null : r.restaurant_id)}
                        aria-expanded={aperto}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                          aperto ? 'bg-accent' : 'hover:bg-accent/60'
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', aperto && 'rotate-180')} />
                          <p className="text-sm font-medium truncate">{r.restaurant_name}</p>
                        </div>
                        <p className="cassa-numeric text-sm shrink-0 whitespace-nowrap">{formatEuro(r.somma)}</p>
                      </button>
                      {aperto && (
                        <div className="px-2 pb-2 pt-1 pl-8 space-y-1">
                          {r.giorni.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Nessuna chiusura confermata nel periodo.</p>
                          ) : (
                            r.giorni.map(g => (
                              <div key={g.data} className="flex items-center justify-between gap-3 text-xs text-muted-foreground py-0.5">
                                <span>{formatGiorno(g.data)}</span>
                                <span className="cassa-numeric shrink-0 whitespace-nowrap">{formatEuro(g.contanti_per_banca)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                <div className="flex items-center justify-between gap-3 px-2 py-3 mt-1">
                  <p className="text-sm font-semibold">Totale complessivo</p>
                  <p className="cassa-numeric text-sm font-semibold shrink-0 whitespace-nowrap">{formatEuro(totaleComplessivo)}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
