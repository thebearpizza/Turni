'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { FileSpreadsheet, Download } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import type { Restaurant } from '@/types'

const TZ = 'Europe/Rome'

interface Props {
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
  currentUserRole: string
  currentRestaurantId: string | null
}

export function ReportClient({ restaurants, currentUserRole, currentRestaurantId }: Props) {
  const [selectedMonth, setSelectedMonth] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM'))
  const [selectedRestaurants, setSelectedRestaurants] = useState<string[]>(
    currentRestaurantId ? [currentRestaurantId] : []
  )
  const [loading, setLoading] = useState<'presenze' | 'ore' | null>(null)

  const isManager = currentUserRole === 'manager'

  function toggleRestaurant(id: string) {
    setSelectedRestaurants(prev =>
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    )
  }

  async function downloadReport(type: 'presenze' | 'ore') {
    const targets = isManager
      ? (selectedRestaurants.length > 0 ? selectedRestaurants : restaurants.map(r => r.id))
      : (currentRestaurantId ? [currentRestaurantId] : [])

    if (targets.length === 0) return

    setLoading(type)
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth, restaurantIds: targets, type }),
      })

      if (!res.ok) {
        const err = await res.json()
        alert(err.error || 'Errore nel download del report')
        return
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `report-${type}-${selectedMonth}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Report Excel</h1>
        <p className="text-muted-foreground text-sm mt-1">Esporta presenze e ore lavorate</p>
      </div>

      <div className="space-y-6 max-w-lg">
        <div className="space-y-2">
          <Label>Mese</Label>
          <Input
            type="month"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="w-auto"
          />
        </div>

        {isManager && restaurants.length > 0 && (
          <div className="space-y-2">
            <Label>Ristoranti (seleziona uno o più, lascia vuoto per tutti)</Label>
            <div className="flex flex-wrap gap-2">
              {restaurants.map(r => (
                <button
                  key={r.id}
                  onClick={() => toggleRestaurant(r.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    selectedRestaurants.includes(r.id)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border text-foreground hover:bg-accent'
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>
            {selectedRestaurants.length > 0 && (
              <p className="text-xs text-muted-foreground">{selectedRestaurants.length} ristoranti selezionati</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => downloadReport('presenze')}>
            <CardContent className="pt-6 pb-5 text-center">
              <FileSpreadsheet className="w-8 h-8 mx-auto mb-3 text-emerald-500" />
              <p className="font-medium text-sm">Report Presenze</p>
              <p className="text-xs text-muted-foreground mt-1">P · F · M · R · AI</p>
              <Button size="sm" className="mt-4 w-full" disabled={loading === 'presenze'}>
                {loading === 'presenze' ? 'Generazione...' : <><Download className="w-4 h-4" /> Scarica</>}
              </Button>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => downloadReport('ore')}>
            <CardContent className="pt-6 pb-5 text-center">
              <FileSpreadsheet className="w-8 h-8 mx-auto mb-3 text-blue-500" />
              <p className="font-medium text-sm">Report Ore</p>
              <p className="text-xs text-muted-foreground mt-1">Ore · Totale · Delta</p>
              <Button size="sm" className="mt-4 w-full" disabled={loading === 'ore'}>
                {loading === 'ore' ? 'Generazione...' : <><Download className="w-4 h-4" /> Scarica</>}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
