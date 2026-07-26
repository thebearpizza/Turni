'use client'
import { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { AlertTriangle } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'

const TZ = 'Europe/Rome'

// Soglia fissa per l'evidenza delle differenze ricorrenti — non più
// regolabile dall'interfaccia, valori di default già in uso.
const SOGLIA_DIFFERENZA = 5
const MIN_GIORNI = 3

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

// Fase E: evidenzia i locali dove la Differenza esce dalla soglia fissa in
// almeno MIN_GIORNI del periodo selezionato (si applica sul periodo/
// ristoranti già filtrati sopra, in AnalisiClient).
export function RecurringAlertsSection({ righe }: Props) {
  const alerts = useMemo<Alert[]>(() => {
    const byRestaurant = new Map<string, { restaurant_id: string; restaurant_name: string; date: string[]; totale: number }>()

    for (const r of righe) {
      if (Math.abs(r.differenza) < SOGLIA_DIFFERENZA) continue
      let g = byRestaurant.get(r.restaurant_id)
      if (!g) {
        g = { restaurant_id: r.restaurant_id, restaurant_name: r.restaurant_name, date: [], totale: 0 }
        byRestaurant.set(r.restaurant_id, g)
      }
      g.date.push(r.data)
      g.totale += r.differenza
    }

    return Array.from(byRestaurant.values())
      .filter(g => g.date.length >= MIN_GIORNI)
      .map(g => ({
        restaurant_id: g.restaurant_id,
        restaurant_name: g.restaurant_name,
        count: g.date.length,
        totale: g.totale,
        media: g.totale / g.date.length,
        date: [...g.date].sort(),
      }))
      .sort((a, b) => b.count - a.count)
  }, [righe])

  return (
    <Card className="cassa-perforated-top">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="w-4 h-4 text-cassa-copper shrink-0" />
          Alert differenze ricorrenti
        </div>

        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun locale con differenze ricorrenti oltre la soglia nel periodo selezionato.</p>
        ) : (
          <div className="space-y-2">
            {alerts.map(a => (
              <div key={a.restaurant_id} className="rounded-md border border-cassa-negative/30 bg-cassa-negative-bg px-3 py-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm font-medium text-cassa-negative">
                    {a.restaurant_name} — {a.count} giorni oltre soglia
                  </p>
                  <p className="cassa-numeric text-xs text-cassa-negative/80 flex flex-wrap gap-x-1.5">
                    <span className="whitespace-nowrap">Media {a.media > 0 ? '+' : ''}{a.media.toFixed(2)} €</span>
                    <span>·</span>
                    <span className="whitespace-nowrap">Totale {a.totale > 0 ? '+' : ''}{a.totale.toFixed(2)} €</span>
                  </p>
                </div>
                <p className="text-xs text-cassa-negative/70 mt-1">
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
