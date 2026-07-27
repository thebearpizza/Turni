'use client'
import { useMemo, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { ChevronDown } from 'lucide-react'
import { usePrefersReducedMotion } from '@/components/cassa/usePrefersReducedMotion'
import { CASSA_CHART_COLORS as COLORS } from '@/components/cassa/chartPalette'
import { cn } from '@/lib/utils'

interface SpesaRow {
  importo: number
  categoria_nome: string | null
  nome_spesa: string
  restaurant_id: string
  restaurant_name: string
}

interface Props {
  spese: SpesaRow[]
  // true quando il filtro locali di Analisi comprende più di un ristorante
  // (selezione multipla esplicita, o il default "tutti" quando ce n'è più
  // di uno) — decide se il drill-down raggruppa prima per locale.
  multiRestaurant: boolean
}

interface Fetta {
  nome: string
  totale: number
  percentuale: number
}

interface NomeSpesaAgg {
  nome_spesa: string
  totale: number
  occorrenze: number
}

interface DrilldownGroup {
  restaurant_name: string
  items: NomeSpesaAgg[]
}

// Drill-down per categoria: totale e numero di occorrenze per ciascun
// nome_spesa distinto (non le singole righe di spesa), ordinato per
// importo decrescente. Se multiRestaurant, raggruppato prima per locale.
function buildDrilldown(spese: SpesaRow[], categoriaNome: string, multiRestaurant: boolean): DrilldownGroup[] {
  const filtered = spese.filter(s => (s.categoria_nome ?? 'Senza categoria') === categoriaNome)
  const byGroup = new Map<string, Map<string, NomeSpesaAgg>>()

  for (const s of filtered) {
    const groupKey = multiRestaurant ? s.restaurant_name : ''
    let inner = byGroup.get(groupKey)
    if (!inner) { inner = new Map(); byGroup.set(groupKey, inner) }
    const prev = inner.get(s.nome_spesa)
    if (prev) {
      prev.totale += s.importo
      prev.occorrenze += 1
    } else {
      inner.set(s.nome_spesa, { nome_spesa: s.nome_spesa, totale: s.importo, occorrenze: 1 })
    }
  }

  const groups = Array.from(byGroup.entries()).map(([restaurant_name, inner]) => ({
    restaurant_name,
    items: Array.from(inner.values()).sort((a, b) => b.totale - a.totale),
  }))
  groups.sort((a, b) => a.restaurant_name.localeCompare(b.restaurant_name))
  return groups
}

const BASE_RADIUS = 88
const ACTIVE_RADIUS = 99

export function CategorieBreakdownChart({ spese, multiRestaurant }: Props) {
  const [activeIndex, setActiveIndex] = useState(0)
  // Fisarmonica indipendente dalla selezione della fetta: un solo nome
  // categoria espanso alla volta, secondo click sulla stessa riga richiude.
  const [expandedCategoria, setExpandedCategoria] = useState<string | null>(null)
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

  const drilldown = useMemo(
    () => (expandedCategoria ? buildDrilldown(spese, expandedCategoria, multiRestaurant) : null),
    [spese, expandedCategoria, multiRestaurant]
  )

  if (fette.length === 0) {
    return <p className="text-sm text-muted-foreground">Nessuna spesa registrata nel periodo selezionato.</p>
  }

  const boundedActive = Math.min(activeIndex, fette.length - 1)
  const selected = fette[boundedActive]
  const selectedColor = COLORS[boundedActive % COLORS.length]

  function toggle(i: number) {
    setActiveIndex(i)
  }

  function toggleExpand(nome: string) {
    setExpandedCategoria(prev => (prev === nome ? null : nome))
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
              onClick={() => { toggle(i); toggleExpand(f.nome) }}
              aria-expanded={expandedCategoria === f.nome}
              className={cn(
                'flex w-full items-center justify-between text-sm rounded-md px-1.5 py-1 -mx-1.5 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                boundedActive === i ? 'bg-accent' : 'hover:bg-accent/60'
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <ChevronDown className={cn(
                  'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                  expandedCategoria === f.nome && 'rotate-180'
                )} />
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

      {/* Drill-down per nome_spesa: fuori dalla griglia ciambella/legenda,
          a piena larghezza, cosi' l'elenco (eventualmente raggruppato per
          locale) ha spazio invece di stringersi nella colonna stretta. */}
      {drilldown && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
          {drilldown.map(group => (
            <div key={group.restaurant_name || '_'} className="space-y-1.5">
              {multiRestaurant && (
                <p className="text-xs font-semibold text-muted-foreground">{group.restaurant_name}</p>
              )}
              <div className="space-y-1">
                {group.items.map(item => (
                  <div key={item.nome_spesa} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{item.nome_spesa}</span>
                    <span className="cassa-numeric shrink-0 whitespace-nowrap text-muted-foreground">
                      € {item.totale.toFixed(2)} <span className="text-xs">({item.occorrenze} {item.occorrenze === 1 ? 'volta' : 'volte'})</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
