'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { Trash2, FileText, FileSpreadsheet } from 'lucide-react'

const TZ = 'Europe/Rome'

interface RestaurantOption {
  id: string
  name: string
}

interface Props {
  restaurants: RestaurantOption[]
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

function monthRange(month: string): { start: string; end: string } {
  const [year, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const lastDay = new Date(year, m, 0).getDate()
  const end = `${month}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

export function ListaChiusureClient({ restaurants }: Props) {
  const [selectedRestaurants, setSelectedRestaurants] = useState<string[]>([])
  const [month, setMonth] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM'))
  const [righe, setRighe] = useState<Riga[]>([])
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState<string | null>(null)

  function toggleRestaurant(id: string) {
    setSelectedRestaurants(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id])
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const { start, end } = monthRange(month)
    const supabase = createClient()
    const targets = selectedRestaurants.length > 0 ? selectedRestaurants : restaurants.map(r => r.id)

    async function load() {
      if (targets.length === 0) {
        if (!cancelled) { setRighe([]); setLoading(false) }
        return
      }
      const { data } = await supabase
        .from('cassa_chiusure')
        .select('id, data, restaurant_id, totale_entrate, totale_spese_giornaliere, differenza, restaurant:restaurants(name)')
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
  }, [month, selectedRestaurants, restaurants])

  async function handleDelete(id: string) {
    if (!confirm('Eliminare definitivamente questa chiusura? Verranno eliminate anche le spese collegate.')) return
    setWorkingId(id)
    const supabase = createClient()
    const { error } = await supabase.from('cassa_chiusure').delete().eq('id', id)
    setWorkingId(null)
    if (error) { alert(`Errore nell'eliminazione: ${error.message}`); return }
    setRighe(prev => prev.filter(r => r.id !== id))
  }

  async function handleExport(id: string, format: 'pdf' | 'xlsx') {
    setWorkingId(`${id}-${format}`)
    try {
      const res = await fetch('/api/cassa/chiusura-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chiusura_id: id, format }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        alert(err?.error ?? 'Errore nel download.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `chiusura.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setWorkingId(null)
    }
  }

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
            <Label>Mese</Label>
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-auto" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : righe.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna chiusura confermata nel mese selezionato.</p>
          ) : (
            <div className="divide-y divide-border">
              {righe.map(r => {
                const isBalanced = Math.abs(r.differenza) < 0.005
                const dataLabel = formatInTimeZone(`${r.data}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })
                const busy = workingId === r.id || workingId === `${r.id}-pdf` || workingId === `${r.id}-xlsx`
                return (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.restaurant_name} · {dataLabel}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Entrate € {r.totale_entrate.toFixed(2)} · Spese € {r.totale_spese_giornaliere.toFixed(2)} ·{' '}
                        <span className={cn(isBalanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400', 'font-medium')}>
                          {isBalanced ? 'in pareggio' : `differenza ${r.differenza > 0 ? '+' : ''}${r.differenza.toFixed(2)} €`}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Scarica PDF"
                        disabled={busy}
                        onClick={() => handleExport(r.id, 'pdf')}
                      >
                        <FileText className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Scarica Excel"
                        disabled={busy}
                        onClick={() => handleExport(r.id, 'xlsx')}
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        title="Elimina"
                        disabled={busy}
                        onClick={() => handleDelete(r.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
