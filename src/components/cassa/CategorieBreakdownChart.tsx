'use client'
import { useMemo, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { usePrefersReducedMotion } from '@/components/cassa/usePrefersReducedMotion'
import { cn } from '@/lib/utils'

interface SpesaRow {
  importo: number
  categoria_nome: string | null
}

interface Props {
  spese: SpesaRow[]
}

interface Fetta {
  nome: string
  totale: number
  percentuale: number
}

// Palette qualitativa "Ledger": verde e rame del design system Cassa più
// toni terrosi coerenti (niente arcobaleno neon da dashboard generica),
// ciclica per categorie oltre la lunghezza.
const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--cassa-copper))',
  '#8A6D3B',
  '#4A6670',
  '#7C5C4B',
  '#A8763E',
  '#5E7A5A',
  '#9C4B3D',
]

const BASE_RADIUS = 88
const ACTIVE_RADIUS = 99

export function CategorieBreakdownChart({ spese }: Props) {
  const [activeIndex, setActiveIndex] = useState(0)
  const reducedMotion = usePrefersReducedMotion()

  const fette = useMemo<Fetta[]>(() => {
    const byCategoria = new Map<string, number>()
    let totaleGenerale = 0

    for (const s of spese) {
      const nome = s.categoria_nome ?? 'Senza categoria'
      byCategoria.set(nome, (byCategoria.get(nome) ?? 0) + s.importo)
      totaleGenerale += s.importo
    }

    return Array.from(byCategoria.entries())
      .map(([nome, totale]) => ({ nome, totale, percentuale: totaleGenerale > 0 ? (totale / totaleGenerale) * 100 : 0 }))
      .sort((a, b) => b.totale - a.totale)
  }, [spese])

  if (fette.length === 0) {
    return <p className="text-sm text-muted-foreground">Nessuna spesa registrata nel periodo selezionato.</p>
  }

  const boundedActive = Math.min(activeIndex, fette.length - 1)
  const selected = fette[boundedActive]
  const selectedColor = COLORS[boundedActive % COLORS.length]

  function toggle(i: number) {
    setActiveIndex(i)
  }

  return (
    <div className="space-y-3">
      {/* Dettaglio della fetta selezionata: area dedicata sopra il grafico,
          mai sovrapposta alle fette o alla legenda. */}
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
                  <linearGradient key={f.nome} id={`cassa-pie-grad-${i}`} x1="0" y1="0" x2="1" y2="1">
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
                // outerRadius per-fetta: la fetta selezionata cresce e si
                // "solleva" (drop-shadow sul Cell sotto), invece del solito
                // tilt 3D — evidenzia la selezione al click, non al passaggio.
                outerRadius={(entry: Fetta) => (fette.indexOf(entry) === boundedActive ? ACTIVE_RADIUS : BASE_RADIUS)}
                paddingAngle={2}
                isAnimationActive={!reducedMotion}
                onClick={(_, i) => toggle(i)}
                style={{ cursor: 'pointer' }}
              >
                {fette.map((f, i) => (
                  <Cell
                    key={f.nome}
                    fill={`url(#cassa-pie-grad-${i})`}
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
