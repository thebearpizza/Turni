'use client'
import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { AlertTriangle } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'

const TZ = 'Europe/Rome'

interface Riga {
  data: string
  restaurant_id: string
  restaurant_name: string
  differenza: number
}

interface Props {
  righe: Riga[]
}

interface Alert {
  restaurant_id: string
  restaurant_name: string
  count: number
  totale: number
  media: number
  date: string[]
}

// Fase E: evidenzia i locali dove la Differenza esce dalla soglia
// configurata in almeno N giorni del periodo selezionato — soglia e
// numero minimo di giorni sono regolabili, non persistiti (si applicano
// solo alla sessione corrente sul periodo/ristoranti già filtrati sopra).
export function RecurringAlertsSection({ righe }: Props) {
  const [soglia, setSoglia] = useState(5)
  const [minGiorni, setMinGiorni] = useState(3)

  const alerts = useMemo<Alert[]>(() => {
    const byRestaurant = new Map<string, { restaurant_id: string; restaurant_name: string; date: string[]; totale: number }>()

    for (const r of righe) {
      if (Math.abs(r.differenza) < soglia) continue
      let g = byRestaurant.get(r.restaurant_id)
      if (!g) {
        g = { restaurant_id: r.restaurant_id, restaurant_name: r.restaurant_name, date: [], totale: 0 }
        byRestaurant.set(r.restaurant_id, g)
      }
      g.date.push(r.data)
      g.totale += r.differenza
    }

    return Array.from(byRestaurant.values())
      .filter(g => g.date.length >= minGiorni)
      .map(g => ({
        restaurant_id: g.restaurant_id,
        restaurant_name: g.restaurant_name,
        count: g.date.length,
        totale: g.totale,
        media: g.totale / g.date.length,
        date: [...g.date].sort(),
      }))
      .sort((a, b) => b.count - a.count)
  }, [righe, soglia, minGiorni])

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            Alert differenze ricorrenti
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground font-normal">Soglia €</Label>
              <Input
                type="number" min={0} step={0.5} value={soglia}
                onChange={e => setSoglia(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-20 h-8"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground font-normal">Giorni min.</Label>
              <Input
                type="number" min={2} step={1} value={minGiorni}
                onChange={e => setMinGiorni(Math.max(2, parseInt(e.target.value, 10) || 2))}
                className="w-16 h-8"
              />
            </div>
          </div>
        </div>

        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun locale con differenze ricorrenti oltre la soglia nel periodo selezionato.</p>
        ) : (
          <div className="space-y-2">
            {alerts.map(a => (
              <div key={a.restaurant_id} className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    {a.restaurant_name} — {a.count} giorni oltre soglia
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 tabular-nums">
                    Media {a.media > 0 ? '+' : ''}{a.media.toFixed(2)} € · Totale {a.totale > 0 ? '+' : ''}{a.totale.toFixed(2)} €
                  </p>
                </div>
                <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
                  {a.date.map(d => formatInTimeZone(`${d}T12:00:00Z`, TZ, 'dd/MM', { locale: it })).join(', ')}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
