'use client'
import { useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/utils'
import { format, startOfWeek, startOfMonth } from 'date-fns'
import { it } from 'date-fns/locale'

interface Riga {
  data: string
  totale_entrate: number
  totale_spese_giornaliere: number
  differenza: number
}

type Granularity = 'giorno' | 'settimana' | 'mese'

const GRANULARITY_LABELS: Record<Granularity, string> = {
  giorno: 'Giorno',
  settimana: 'Settimana',
  mese: 'Mese',
}

interface Props {
  righe: Riga[]
  righePrecedenti?: Riga[] // stesso periodo, anno precedente — opzionale
}

interface Bucket {
  key: string
  label: string
  entrate: number
  spese: number
  differenza: number
}

function bucketKey(dateStr: string, granularity: Granularity): { key: string; label: string } {
  const d = new Date(`${dateStr}T12:00:00Z`)
  if (granularity === 'giorno') {
    return { key: dateStr, label: format(d, 'dd/MM') }
  }
  if (granularity === 'settimana') {
    const weekStart = startOfWeek(d, { weekStartsOn: 1 })
    return { key: format(weekStart, 'yyyy-MM-dd'), label: format(weekStart, 'dd/MM') }
  }
  const monthStart = startOfMonth(d)
  return { key: format(monthStart, 'yyyy-MM'), label: format(monthStart, 'MMM yyyy', { locale: it }) }
}

function toBuckets(righe: Riga[], granularity: Granularity): Bucket[] {
  const buckets = new Map<string, Bucket>()
  for (const r of righe) {
    const { key, label } = bucketKey(r.data, granularity)
    let b = buckets.get(key)
    if (!b) { b = { key, label, entrate: 0, spese: 0, differenza: 0 }; buckets.set(key, b) }
    b.entrate += r.totale_entrate
    b.spese += r.totale_spese_giornaliere
    b.differenza += r.differenza
  }
  return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key))
}

export function TrendChart({ righe, righePrecedenti }: Props) {
  const [granularity, setGranularity] = useState<Granularity>('giorno')
  const hasCompare = !!righePrecedenti?.length

  const data = useMemo(() => {
    const current = toBuckets(righe, granularity)
    if (!hasCompare) return current

    // Confronto anno su anno: i due periodi hanno intervalli di date diverse
    // (stesso range, un anno prima), quindi si allineano per posizione nel
    // periodo (stesso n-esimo giorno/settimana/mese) invece che per data
    // assoluta — approssimazione ragionevole quando i due periodi hanno la
    // stessa durata, che è sempre il caso qui (stesso preset, anno -1).
    const previous = toBuckets(righePrecedenti!, granularity)
    return current.map((b, i) => ({ ...b, entratePrecedente: previous[i]?.entrate ?? null }))
  }, [righe, righePrecedenti, granularity, hasCompare])

  if (righe.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(GRANULARITY_LABELS) as Granularity[]).map(g => (
          <button
            key={g}
            type="button"
            onClick={() => setGranularity(g)}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
              granularity === g
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border text-foreground hover:bg-accent'
            )}
          >
            {GRANULARITY_LABELS[g]}
          </button>
        ))}
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={60} />
            <Tooltip formatter={(value) => `€ ${Number(value).toFixed(2)}`} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="entrate" name="Entrate" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="spese" name="Spese" stroke="#f59e0b" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="differenza" name="Differenza" stroke="#ef4444" strokeWidth={2} dot={false} />
            {hasCompare && (
              <Line
                type="monotone"
                dataKey="entratePrecedente"
                name="Entrate (anno precedente)"
                stroke="#94a3b8"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
