'use client'
import { useMemo, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { usePrefersReducedMotion } from '@/components/cassa/usePrefersReducedMotion'
import { CASSA_CHART_COLORS as COLORS } from '@/components/cassa/chartPalette'
import { cn } from '@/lib/utils'

interface EntrateRow {
  entrate_contanti: number
  entrate_pos: number
  entrate_bonifico: number
}

interface Props {
  righe: EntrateRow[]
}

interface Fetta {
  nome: string
  totale: number
  percentuale: number
}

const BASE_RADIUS = 88
const ACTIVE_RADIUS = 99

const TIPI: Array<{ nome: string; key: keyof EntrateRow }> = [
  { nome: 'Contanti', key: 'entrate_contanti' },
  { nome: 'POS', key: 'entrate_pos' },
  { nome: 'Bonifico', key: 'entrate_bonifico' },
]

// Stessa ciambella "esplosa al click" di CategorieBreakdownChart, ma sui 3
// tipi di pagamento fissi invece che sulle categorie di spesa dinamiche —
// nessun drill-down qui, non richiesto per questo grafico.
export function PagamentoBreakdownChart({ righe }: Props) {
  const [activeIndex, setActiveIndex] = useState(0)
  const reducedMotion = usePrefersReducedMotion()

  const fette = useMemo<Fetta[]>(() => {
    const totali = TIPI.map(t => ({
      nome: t.nome,
      totale: righe.reduce((sum, r) => sum + (r[t.key] ?? 0), 0),
    }))
    const totaleGenerale = totali.reduce((sum, t) => sum + t.totale, 0)

    return totali
      .filter(t => t.totale > 0)
      .map(t => ({ ...t, percentuale: totaleGenerale > 0 ? (t.totale / totaleGenerale) * 100 : 0 }))
      .sort((a, b) => b.totale - a.totale)
  }, [righe])

  if (fette.length === 0) {
    return <p className="text-sm text-muted-foreground">Nessuna entrata registrata nel periodo selezionato.</p>
  }

  const boundedActive = Math.min(activeIndex, fette.length - 1)
  const selected = fette[boundedActive]
  const selectedColor = COLORS[boundedActive % COLORS.length]

  function toggle(i: number) {
    setActiveIndex(i)
  }

  return (
    <div className="space-y-3">
      <div className="cassa-numeric flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm">
        <span className="font-sans font-semibold text-foreground truncate" style={{ color: selectedColor }}>
          {selected.nome}
        </span>
        <span className="font-semibold whitespace-nowrap">€ {selected.totale.toFixed(2)} · {selected.percentuale.toFixed(0)}%</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <defs>
                {fette.map((f, i) => (
                  <linearGradient key={f.nome} id={`cassa-pay-grad-${i}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={COLORS[i % COLORS.length]} stopOpacity={1} />
                    <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.7} />
                  </linearGradient>
                ))}
              </defs>
              <Pie
                data={fette}
                dataKey="totale"
                nameKey="nome"
                innerRadius={50}
                outerRadius={(entry: Fetta) => (fette.indexOf(entry) === boundedActive ? ACTIVE_RADIUS : BASE_RADIUS)}
                paddingAngle={2}
                isAnimationActive={!reducedMotion}
                onClick={(_, i) => toggle(i)}
                style={{ cursor: 'pointer' }}
              >
                {fette.map((f, i) => (
                  <Cell
                    key={f.nome}
                    fill={`url(#cassa-pay-grad-${i})`}
                    stroke="hsl(var(--card))"
                    strokeWidth={1.5}
                    style={{
                      filter: i === boundedActive ? 'drop-shadow(0 4px 8px hsl(var(--foreground) / 0.3))' : undefined,
                      transition: reducedMotion ? undefined : 'filter 150ms ease',
                    }}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-1.5">
          {fette.map((f, i) => (
            <button
              type="button"
              key={f.nome}
              onClick={() => toggle(i)}
              className={cn(
                'flex w-full items-center justify-between text-sm rounded-md px-1.5 py-1 -mx-1.5 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                boundedActive === i ? 'bg-accent' : 'hover:bg-accent/60'
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                <span className="truncate">{f.nome}</span>
              </div>
              <div className="cassa-numeric flex items-center gap-2 shrink-0 whitespace-nowrap text-muted-foreground">
                <span>€ {f.totale.toFixed(2)}</span>
                <span className="w-12 text-right">{f.percentuale.toFixed(0)}%</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
