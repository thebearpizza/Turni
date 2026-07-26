'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfrontoSediTable } from '@/components/cassa/ConfrontoSediTable'
import { TrendChart } from '@/components/cassa/TrendChart'
import { CategorieBreakdownChart } from '@/components/cassa/CategorieBreakdownChart'
import { RecurringAlertsSection } from '@/components/cassa/RecurringAlertsSection'
import { CassaPill } from '@/components/cassa/CassaPill'
import { formatInTimeZone } from 'date-fns-tz'
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subYears, format } from 'date-fns'
import { FileText, FileSpreadsheet } from 'lucide-react'

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

type RigaJoined = Riga & { restaurant: { name: string } | null }

async function fetchRighe(
  supabase: ReturnType<typeof createClient>,
  targets: string[],
  start: string,
  end: string
): Promise<Riga[]> {
  if (targets.length === 0) return []
  const { data } = await supabase
    .from('cassa_chiusure')
    .select('id, data, restaurant_id, totale_entrate, totale_spese_giornaliere, differenza, stato, restaurant:restaurants(name)')
    .in('restaurant_id', targets)
    .eq('stato', 'confermata')
    .gte('data', start)
    .lte('data', end)
    .order('data', { ascending: false })

  return ((data ?? []) as unknown as RigaJoined[]).map(r => ({
    id: r.id,
    data: r.data,
    restaurant_id: r.restaurant_id,
    restaurant_name: r.restaurant?.name ?? '—',
    totale_entrate: r.totale_entrate,
    totale_spese_giornaliere: r.totale_spese_giornaliere,
    differenza: r.differenza,
  }))
}

interface SpesaRow {
  importo: number
  categoria_nome: string | null
}

async function fetchSpese(supabase: ReturnType<typeof createClient>, chiusuraIds: string[]): Promise<SpesaRow[]> {
  if (chiusuraIds.length === 0) return []
  const { data } = await supabase
    .from('cassa_spese')
    .select('importo, categoria:cassa_categorie(nome)')
    .in('chiusura_id', chiusuraIds)

  return ((data ?? []) as unknown as Array<{ importo: number; categoria: { nome: string } | null }>).map(s => ({
    importo: s.importo,
    categoria_nome: s.categoria?.nome ?? null,
  }))
}

export function AnalisiClient({ restaurants }: Props) {
  const [selectedRestaurants, setSelectedRestaurants] = useState<string[]>([])
  const [preset, setPreset] = useState<Preset>('mese')
  const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const [customStart, setCustomStart] = useState(today)
  const [customEnd, setCustomEnd] = useState(today)
  const [compareYoY, setCompareYoY] = useState(false)

  const [righe, setRighe] = useState<Riga[]>([])
  const [righePrecedenti, setRighePrecedenti] = useState<Riga[]>([])
  const [spese, setSpese] = useState<SpesaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null)

  function toggleRestaurant(id: string) {
    setSelectedRestaurants(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id])
  }

  const { start, end } = useMemo(() => rangeForPreset(preset, customStart, customEnd), [preset, customStart, customEnd])
  const targets = useMemo(
    () => selectedRestaurants.length > 0 ? selectedRestaurants : restaurants.map(r => r.id),
    [selectedRestaurants, restaurants]
  )

  async function handleExport(exportFormat: 'pdf' | 'xlsx') {
    setExporting(exportFormat)
    try {
      const res = await fetch('/api/cassa/analisi-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_ids: targets, start, end, format: exportFormat }),
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
      a.download = `analisi-cassa-${start}_${end}.${exportFormat}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(null)
    }
  }

  useEffect(() => {
    if (!start || !end) return
    let cancelled = false
    setLoading(true)

    const supabase = createClient()

    async function load() {
      const current = await fetchRighe(supabase, targets, start, end)
      if (cancelled) return
      setRighe(current)

      const speseData = await fetchSpese(supabase, current.map(r => r.id))
      if (!cancelled) setSpese(speseData)

      if (compareYoY) {
        const prevStart = fmtDate(subYears(new Date(`${start}T12:00:00Z`), 1))
        const prevEnd = fmtDate(subYears(new Date(`${end}T12:00:00Z`), 1))
        const previous = await fetchRighe(supabase, targets, prevStart, prevEnd)
        if (!cancelled) setRighePrecedenti(previous)
      } else {
        setRighePrecedenti([])
      }

      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [start, end, targets, compareYoY])

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button
          type="button" variant="outline" size="sm"
          disabled={!!exporting || righe.length === 0}
          onClick={() => handleExport('pdf')}
        >
          <FileText className="w-4 h-4" /> {exporting === 'pdf' ? 'Esportazione…' : 'Esporta PDF'}
        </Button>
        <Button
          type="button" variant="outline" size="sm"
          disabled={!!exporting || righe.length === 0}
          onClick={() => handleExport('xlsx')}
        >
          <FileSpreadsheet className="w-4 h-4" /> {exporting === 'xlsx' ? 'Esportazione…' : 'Esporta Excel'}
        </Button>
      </div>

      <Card className="cassa-perforated-top">
        <CardContent className="pt-6 space-y-4">
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

          <div className="space-y-2">
            <Label>Periodo</Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
                <CassaPill key={p} active={preset === p} onClick={() => setPreset(p)}>
                  {PRESET_LABELS[p]}
                </CassaPill>
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

          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={compareYoY}
              onChange={e => setCompareYoY(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Confronta con l&apos;anno precedente
          </label>
        </CardContent>
      </Card>

      {!loading && righe.length > 0 && <RecurringAlertsSection righe={righe} />}

      {!loading && righe.length > 0 && (
        <Card className="cassa-perforated-top">
          <CardContent className="pt-6 space-y-2">
            <Label className="cassa-display text-base">Confronto per ristorante nel periodo</Label>
            <ConfrontoSediTable righe={righe} />
          </CardContent>
        </Card>
      )}

      <Card className="cassa-perforated-top">
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-3">
              <div className="flex items-end gap-2 h-48">
                {[45, 65, 40, 80, 55, 70, 35, 60, 50, 75, 45, 65].map((h, i) => (
                  <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
                ))}
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          ) : righe.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna chiusura confermata nel periodo selezionato.</p>
          ) : (
            <TrendChart righe={righe} righePrecedenti={compareYoY ? righePrecedenti : undefined} />
          )}
        </CardContent>
      </Card>

      {!loading && righe.length > 0 && (
        <Card className="cassa-perforated-top">
          <CardContent className="pt-6 space-y-3">
            <Label className="cassa-display text-base">Ripartizione spese per categoria</Label>
            <CategorieBreakdownChart spese={spese} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
