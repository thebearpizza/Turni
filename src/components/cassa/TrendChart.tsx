'use client'
import { useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer } from 'recharts'
import { CassaPill } from '@/components/cassa/CassaPill'
import { usePrefersReducedMotion } from '@/components/cassa/usePrefersReducedMotion'
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
  entratePrecedente?: number | null
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

function euro(n: number): string {
  return `${n < 0 ? '−' : ''}€ ${Math.abs(n).toFixed(2)}`
}

export function TrendChart({ righe, righePrecedenti }: Props) {
  const [granularity, setGranularity] = useState<Granularity>('giorno')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const hasCompare = !!righePrecedenti?.length
  const reducedMotion = usePrefersReducedMotion()

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

  // Punto attivo (hover o tap): di default l'ultimo della serie, cosi' il
  // fumetto mostra sempre un valore invece di restare vuoto a riposo.
  const active = useMemo(
    () => data.find(b => b.key === activeKey) ?? data[data.length - 1] ?? null,
    [data, activeKey]
  )

  if (righe.length === 0) return null

  const chartMinWidth = Math.max(data.length * 44, 480)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(GRANULARITY_LABELS) as Granularity[]).map(g => (
          <CassaPill key={g} active={granularity === g} onClick={() => setGranularity(g)}>
            {GRANULARITY_LABELS[g]}
          </CassaPill>
        ))}
      </div>

      {/* Fumetto: sempre sopra il grafico, mai sovrapposto ai dati. Data,
          Entrate, Spese e Differenza condividono lo stesso peso tipografico. */}
      {active && (
        <div className="cassa-numeric grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm">
          <div>
            <div className="font-sans text-xs text-muted-foreground">Data</div>
            <div className="font-semibold">{active.label}</div>
          </div>
          <div>
            <div className="font-sans text-xs text-muted-foreground">Entrate</div>
            <div className="font-semibold" style={{ color: 'hsl(var(--primary))' }}>{euro(active.entrate)}</div>
          </div>
          <div>
            <div className="font-sans text-xs text-muted-foreground">Spese</div>
            <div className="font-semibold" style={{ color: 'hsl(var(--cassa-copper))' }}>{euro(active.spese)}</div>
          </div>
          <div>
            <div className="font-sans text-xs text-muted-foreground">Differenza</div>
            <div className={cn('font-semibold', active.differenza >= 0 ? 'text-cassa-positive' : 'text-cassa-negative')}>
              {euro(active.differenza)}
            </div>
          </div>
        </div>
      )}

      {/* Scroll orizzontale isolato: pan-x sul contenitore evita che uno
          swipe pensato per il grafico scateni anche lo scroll verticale
          della pagina. Il grafico si allarga oltre il 100% solo quando i
          punti sono troppi per stare comodamente in vista. */}
      <div className="overflow-x-auto overscroll-x-contain" style={{ touchAction: 'pan-x' }}>
        <div className="h-72" style={{ minWidth: `${chartMinWidth}px` }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
              onMouseMove={state => {
                const idx = typeof state?.activeIndex === 'number' ? state.activeIndex : undefined
                const key = idx !== undefined ? data[idx]?.key : undefined
                if (key) setActiveKey(key)
              }}
              onClick={state => {
                const idx = typeof state?.activeIndex === 'number' ? state.activeIndex : undefined
                const key = idx !== undefined ? data[idx]?.key : undefined
                if (key) setActiveKey(prev => (prev === key ? null : key))
              }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={60} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="entrate" name="Entrate" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={!reducedMotion} />
              <Line type="monotone" dataKey="spese" name="Spese" stroke="hsl(var(--cassa-copper))" strokeWidth={2} dot={false} isAnimationActive={!reducedMotion} />
              <Line type="monotone" dataKey="differenza" name="Differenza" stroke="hsl(var(--cassa-negative))" strokeWidth={2} dot={false} isAnimationActive={!reducedMotion} />
              {hasCompare && (
                <Line
                  type="monotone"
                  dataKey="entratePrecedente"
                  name="Entrate (anno precedente)"
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                  isAnimationActive={!reducedMotion}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
