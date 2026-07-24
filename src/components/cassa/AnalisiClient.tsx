'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfrontoSediTable } from '@/components/cassa/ConfrontoSediTable'
import { cn } from '@/lib/utils'
import { formatInTimeZone } from 'date-fns-tz'
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, format } from 'date-fns'
import { it } from 'date-fns/locale'

const TZ = 'Europe/Rome'

interface RestaurantOption {
  id: string
  name: string
}

interface Props {
  restaurants: RestaurantOption[]
}

type Preset = 'oggi' | 'settimana' | 'mese' | 'anno' | 'custom'

const PRESET_LABELS: Record<Preset, string> = {
  oggi: 'Oggi',
  settimana: 'Settimana',
  mese: 'Mese',
  anno: 'Anno',
  custom: 'Personalizzato',
}

interface Riga {
  id: string
  data: string
  restaurant_id: string
  restaurant_name: string
  totale_entrate: number
  totale_spese_giornaliere: number
  differenza: number
}

function fmtDate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function rangeForPreset(preset: Preset, customStart: string, customEnd: string): { start: string; end: string } {
  const today = new Date(formatInTimeZone(new Date(), TZ, "yyyy-MM-dd'T'12:00:00"))
  switch (preset) {
    case 'oggi':
      return { start: fmtDate(today), end: fmtDate(today) }
    case 'settimana':
      return { start: fmtDate(startOfWeek(today, { weekStartsOn: 1 })), end: fmtDate(endOfWeek(today, { weekStartsOn: 1 })) }
    case 'mese':
      return { start: fmtDate(startOfMonth(today)), end: fmtDate(endOfMonth(today)) }
    case 'anno':
      return { start: fmtDate(startOfYear(today)), end: fmtDate(endOfYear(today)) }
    case 'custom':
      return { start: customStart, end: customEnd }
  }
}

export function AnalisiClient({ restaurants }: Props) {
  const [selectedRestaurants, setSelectedRestaurants] = useState<string[]>([])
  const [preset, setPreset] = useState<Preset>('mese')
  const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const [customStart, setCustomStart] = useState(today)
  const [customEnd, setCustomEnd] = useState(today)

  const [righe, setRighe] = useState<Riga[]>([])
  const [loading, setLoading] = useState(true)

  function toggleRestaurant(id: string) {
    setSelectedRestaurants(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id])
  }

  const { start, end } = useMemo(() => rangeForPreset(preset, customStart, customEnd), [preset, customStart, customEnd])

  useEffect(() => {
    if (!start || !end) return
    let cancelled = false
    setLoading(true)

    const supabase = createClient()
    const targets = selectedRestaurants.length > 0 ? selectedRestaurants : restaurants.map(r => r.id)

    async function load() {
      if (targets.length === 0) {
        if (!cancelled) { setRighe([]); setLoading(false) }
        return
      }
      const { data } = await supabase
        .from('cassa_chiusure')
        .select('id, data, restaurant_id, totale_entrate, totale_spese_giornaliere, differenza, stato, restaurant:restaurants(name)')
        .in('restaurant_id', targets)
        .eq('stato', 'confermata')
        .gte('data', start)
        .lte('data', end)
        .order('data', { ascending: false })

      if (cancelled) return
      setRighe(((data ?? []) as unknown as Array<Riga & { restaurant: { name: string } | null }>).map(r => ({
        id: r.id,
        data: r.data,
        restaurant_id: r.restaurant_id,
        restaurant_name: r.restaurant?.name ?? '—',
        totale_entrate: r.totale_entrate,
        totale_spese_giornaliere: r.totale_spese_giornaliere,
        differenza: r.differenza,
      })))
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [start, end, selectedRestaurants, restaurants])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-2">
            <Label>Ristoranti</Label>
            <div className="flex flex-wrap gap-2">
              {restaurants.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleRestaurant(r.id)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                    selectedRestaurants.includes(r.id)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border text-foreground hover:bg-accent'
                  )}
                >
                  {r.name}
                </button>
              ))}
            </div>
            {selectedRestaurants.length === 0 && (
              <p className="text-xs text-muted-foreground">Nessuno selezionato: mostro tutti i ristoranti.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Periodo</Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                    preset === p
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border text-foreground hover:bg-accent'
                  )}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-auto" />
                <span className="text-muted-foreground text-sm">→</span>
                <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-auto" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!loading && righe.length > 0 && (
        <Card>
          <CardContent className="pt-6 space-y-2">
            <Label>Confronto per ristorante nel periodo</Label>
            <ConfrontoSediTable righe={righe} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : righe.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna chiusura confermata nel periodo selezionato.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Data</th>
                    <th className="py-2 pr-4 font-medium">Locale</th>
                    <th className="py-2 pr-4 font-medium text-right">Totale Entrate</th>
                    <th className="py-2 pr-4 font-medium text-right">Totale Spese</th>
                    <th className="py-2 font-medium text-right">Differenza</th>
                  </tr>
                </thead>
                <tbody>
                  {righe.map(r => {
                    const isBalanced = Math.abs(r.differenza) < 0.005
                    const dataLabel = formatInTimeZone(`${r.data}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })
                    return (
                      <tr key={r.id} className="border-b border-border last:border-0">
                        <td className="py-2 pr-4 whitespace-nowrap">{dataLabel}</td>
                        <td className="py-2 pr-4">{r.restaurant_name}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">€ {r.totale_entrate.toFixed(2)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">€ {r.totale_spese_giornaliere.toFixed(2)}</td>
                        <td className={cn(
                          'py-2 text-right tabular-nums font-medium',
                          isBalanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                        )}>
                          {isBalanced ? '0,00 €' : `${r.differenza > 0 ? '+' : ''}${r.differenza.toFixed(2)} €`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
