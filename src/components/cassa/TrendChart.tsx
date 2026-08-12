'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer } from 'recharts'
import type { MouseHandlerDataParam } from 'recharts/types/synchronisation/types'
import { CassaPill } from '@/components/cassa/CassaPill'
import { usePrefersReducedMotion } from '@/components/cassa/usePrefersReducedMotion'
import { cn } from '@/lib/utils'
import { format, startOfWeek, startOfMonth, subYears } from 'date-fns'
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

interface Bucket {
  key: string
  label: string
  entrate: number
  spese: number
  differenza: number
  entratePrecedente?: number | null
}

interface Props {
  righe: Riga[]
  righePrecedenti?: Riga[] // stesso periodo, anno precedente — opzionale
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

// Chiave del bucket un anno prima, per agganciare il periodo di confronto
// per data invece che per posizione nell'array (i due periodi possono avere
// un numero diverso di bucket, es. giorni di chiusura del locale diversi).
function keyOneYearBefore(key: string, granularity: Granularity): string {
  if (granularity === 'mese') {
    const [y, m] = key.split('-')
    return `${Number(y) - 1}-${m}`
  }
  return format(subYears(new Date(`${key}T12:00:00Z`), 1), 'yyyy-MM-dd')
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

// Blocca lo scroll verticale della pagina per l'intera durata di un
// trascinamento che parte sul grafico. touch-action: none (sotto) è la
// prima difesa, ma i gesti touch React sono attaccati come passive di
// default: senza un listener nativo { passive: false } preventDefault()
// verrebbe ignorato dal browser durante lo swipe.
function useBlockScrollDuringTouch(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const prevent = (e: TouchEvent) => { e.preventDefault() }
    el.addEventListener('touchmove', prevent, { passive: false })
    return () => el.removeEventListener('touchmove', prevent)
  }, [ref])
}

export function TrendChart({ righe, righePrecedenti }: Props) {
  const [granularity, setGranularity] = useState<Granularity>('giorno')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const hasCompare = !!righePrecedenti?.length
  const reducedMotion = usePrefersReducedMotion()
  const chartAreaRef = useRef<HTMLDivElement>(null)
  useBlockScrollDuringTouch(chartAreaRef)

  const data = useMemo(() => {
    const current = toBuckets(righe, granularity)
    if (!hasCompare) return current

    // Confronto anno su anno: i due periodi possono avere un numero diverso
    // di bucket (giorni di chiusura del locale diversi, festività mobili),
    // quindi si allineano per data (bucket corrente meno un anno) invece
    // che per posizione nell'array.
    const previous = toBuckets(righePrecedenti!, granularity)
    const previousByKey = new Map(previous.map(b => [b.key, b]))
    return current.map(b => ({ ...b, entratePrecedente: previousByKey.get(keyOneYearBefore(b.key, granularity))?.entrate ?? null }))
  }, [righe, righePrecedenti, granularity, hasCompare])

  // Punto attivo (hover, tap o scrub col dito): di default l'ultimo della
  // serie, cosi' il fumetto mostra sempre un valore invece di restare vuoto.
  const active = useMemo(
    () => data.find(b => b.key === activeKey) ?? data[data.length - 1] ?? null,
    [data, activeKey]
  )

  if (righe.length === 0) return null

  // Aggiorna il punto attivo seguendo il mouse o il dito in tempo reale —
  // stessa funzione per hover desktop e scrub touch, recharts calcola già
  // internamente il punto più vicino al cursore/tocco in activeIndex.
  function handleActive(state: MouseHandlerDataParam) {
    // recharts espone activeIndex come TooltipIndex (stringa numerica a
    // runtime, es. "2"), non come number — Number() lo normalizza per
    // entrambi i casi.
    const idx = state?.activeIndex != null ? Number(state.activeIndex) : NaN
    const key = !Number.isNaN(idx) ? data[idx]?.key : undefined
    if (key) setActiveKey(key)
  }

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
          Entrate, Spese e Differenza condividono lo stesso peso tipografico.
          Segue il dito in tempo reale durante lo scrub touch. */}
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

      {/* Il grafico mostra sempre l'intero periodo, mai panoramica: niente
          scroll orizzontale. touch-action: none toglie al browser ogni
          gesto nativo su quest'area (nessun pan-x/pan-y da negoziare), cosi'
          il trascinamento è governato solo da onTouchMove/preventDefault
          qui sotto — lo scroll verticale della pagina resta bloccato per
          tutta la durata del gesto, non solo attenuato. */}
      <div ref={chartAreaRef} className="h-72 w-full" style={{ touchAction: 'none' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
            onMouseMove={handleActive}
            onTouchStart={handleActive}
            onTouchMove={handleActive}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" type="category" tick={{ fontSize: 12 }} />
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
  )
}
