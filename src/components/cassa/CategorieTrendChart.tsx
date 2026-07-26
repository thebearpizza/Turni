'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer } from 'recharts'
import type { MouseHandlerDataParam } from 'recharts/types/synchronisation/types'
import { CassaPill } from '@/components/cassa/CassaPill'
import { cassaChartColor } from '@/components/cassa/chartPalette'
import { usePrefersReducedMotion } from '@/components/cassa/usePrefersReducedMotion'
import { format, startOfWeek, startOfMonth } from 'date-fns'
import { it } from 'date-fns/locale'

interface SpesaRow {
  importo: number
  categoria_nome: string | null
  data: string
}

type Granularity = 'giorno' | 'settimana' | 'mese'

const GRANULARITY_LABELS: Record<Granularity, string> = {
  giorno: 'Giorno',
  settimana: 'Settimana',
  mese: 'Mese',
}

interface Props {
  spese: SpesaRow[]
}

interface Bucket {
  key: string
  label: string
  values: Record<string, number>
}

const MAX_CATEGORIE = 6
const ALTRO = 'Altro'

function bucketKey(dateStr: string, granularity: Granularity): { key: string; label: string } {
  const d = new Date(`${dateStr}T12:00:00Z`)
  if (granularity === 'giorno') return { key: dateStr, label: format(d, 'dd/MM') }
  if (granularity === 'settimana') {
    const weekStart = startOfWeek(d, { weekStartsOn: 1 })
    return { key: format(weekStart, 'yyyy-MM-dd'), label: format(weekStart, 'dd/MM') }
  }
  const monthStart = startOfMonth(d)
  return { key: format(monthStart, 'yyyy-MM'), label: format(monthStart, 'MMM yyyy', { locale: it }) }
}

// Ripartizione per categoria nel tempo (a differenza della torta statica di
// CategorieBreakdownChart, che copre solo il totale del periodo) — le
// categorie minori oltre le prime 6 per spesa totale confluiscono in
// "Altro" per mantenere il grafico leggibile.
function toBuckets(spese: SpesaRow[], granularity: Granularity): { data: Bucket[]; categorie: string[] } {
  const totali = new Map<string, number>()
  for (const s of spese) {
    const nome = s.categoria_nome ?? 'Senza categoria'
    totali.set(nome, (totali.get(nome) ?? 0) + s.importo)
  }
  const top = Array.from(totali.entries()).sort((a, b) => b[1] - a[1]).slice(0, MAX_CATEGORIE).map(([n]) => n)
  const topSet = new Set(top)
  const hasAltro = totali.size > top.length
  const categorie = hasAltro ? [...top, ALTRO] : top

  const buckets = new Map<string, Bucket>()
  for (const s of spese) {
    const nomeReale = s.categoria_nome ?? 'Senza categoria'
    const nome = topSet.has(nomeReale) ? nomeReale : ALTRO
    const { key, label } = bucketKey(s.data, granularity)
    let b = buckets.get(key)
    if (!b) { b = { key, label, values: {} }; buckets.set(key, b) }
    b.values[nome] = (b.values[nome] ?? 0) + s.importo
  }

  const data = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key))
  return { data, categorie }
}

// Blocca lo scroll verticale della pagina per l'intera durata di un
// trascinamento che parte sul grafico — stesso meccanismo di TrendChart
// (Task 4): touch-action: none toglie i gesti nativi, il listener nativo
// non-passive garantisce che preventDefault() abbia davvero effetto.
function useBlockScrollDuringTouch(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const prevent = (e: TouchEvent) => { e.preventDefault() }
    el.addEventListener('touchmove', prevent, { passive: false })
    return () => el.removeEventListener('touchmove', prevent)
  }, [ref])
}

export function CategorieTrendChart({ spese }: Props) {
  const [granularity, setGranularity] = useState<Granularity>('settimana')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const reducedMotion = usePrefersReducedMotion()
  const chartAreaRef = useRef<HTMLDivElement>(null)
  useBlockScrollDuringTouch(chartAreaRef)

  const { data, categorie } = useMemo(() => toBuckets(spese, granularity), [spese, granularity])
  const chartData = useMemo(() => data.map(b => ({ key: b.key, label: b.label, ...b.values })), [data])

  const active = useMemo(
    () => data.find(b => b.key === activeKey) ?? data[data.length - 1] ?? null,
    [data, activeKey]
  )

  if (spese.length === 0) {
    return <p className="text-sm text-muted-foreground">Nessuna spesa registrata nel periodo selezionato.</p>
  }

  // Segue il mouse o il dito in tempo reale — stessa funzione per hover
  // desktop e scrub touch. recharts espone activeIndex come TooltipIndex
  // (stringa numerica a runtime, es. "2"), non number: Number() lo
  // normalizza per entrambi i casi (bug reale scoperto qui e in TrendChart,
  // vedi Task 4 — prima il controllo `typeof === 'number'` falliva sempre
  // silenziosamente, quindi click/hover non aggiornavano mai il riquadro).
  function handleActive(state: MouseHandlerDataParam) {
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

      {active && (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-3">
          <p className="text-sm font-semibold mb-2">{active.label}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {categorie.map((cat, i) => {
              const v = active.values[cat]
              if (!v) return null
              return (
                <div key={cat} className="flex items-center gap-1.5 text-xs">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: cassaChartColor(i) }} />
                  <span className="text-muted-foreground">{cat}</span>
                  <span className="cassa-numeric font-medium whitespace-nowrap">€ {v.toFixed(2)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Come TrendChart (Task 4): il grafico mostra sempre l'intero
          periodo, mai panoramica — niente scroll orizzontale, altrimenti
          trascinare per scrollare e trascinare per ispezionare i dati
          sarebbero due gesti in conflitto sullo stesso movimento. */}
      <div ref={chartAreaRef} className="h-72 w-full" style={{ touchAction: 'none' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
            onMouseMove={handleActive}
            onTouchStart={handleActive}
            onTouchMove={handleActive}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" type="category" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={60} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {categorie.map((cat, i) => (
              <Bar key={cat} dataKey={cat} name={cat} stackId="categorie" fill={cassaChartColor(i)} isAnimationActive={!reducedMotion} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
