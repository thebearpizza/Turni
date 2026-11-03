'use client'
import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { usePrefersReducedMotion } from '@/components/cassa/usePrefersReducedMotion'
import { CASSA_CHART_COLORS as COLORS } from '@/components/cassa/chartPalette'
import { cn , eur2 } from '@/lib/utils'

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

  // Ciambella del design: anello SVG a spessore fisso, totale al centro,
  // fetta selezionata più spessa. Legenda accanto quando c'è spazio,
  // altrimenti sotto (flex-wrap), mai compressa fino a nascondere i nomi.
  const CIRC = 2 * Math.PI * 66
  const totale = fette.reduce((s, f) => s + f.totale, 0)
  const lunghezze = fette.map(f => (totale > 0 ? (f.totale / totale) * CIRC : 0))
  const archi = lunghezze.map((lung, i) => ({
    i,
    lung,
    off: -lunghezze.slice(0, i).reduce((s, l) => s + l, 0),
  }))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
        <div className="relative h-[170px] w-[170px] flex-none">
          <svg width="170" height="170" viewBox="0 0 170 170" className="-rotate-90">
            <circle cx="85" cy="85" r="66" fill="none" stroke="var(--secondary)" strokeWidth="22" />
            {archi.map(a => (
              <circle key={a.i} cx="85" cy="85" r="66" fill="none"
                stroke={COLORS[a.i % COLORS.length]}
                strokeWidth={a.i === boundedActive ? 28 : 22}
                strokeDasharray={`${Math.max(0, a.lung - (fette.length > 1 ? 2 : 0))} ${CIRC}`}
                strokeDashoffset={a.off}
                onClick={() => toggle(a.i)}
                className="cursor-pointer"
                style={{ transition: reducedMotion ? undefined : 'stroke-width 200ms ease' }} />
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-8 text-center">
            <span className="max-w-full truncate text-xs" style={{ color: selectedColor }}>{selected.nome}</span>
            <span className="font-mono text-[15px] font-semibold">€ {eur2(selected.totale)}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{selected.percentuale.toFixed(0)}% di € {eur2(totale)}</span>
          </div>
        </div>

        <div className="flex min-w-[220px] flex-1 flex-col">
          {fette.map((f, i) => (
            <button
              type="button"
              key={f.nome}
              onClick={() => { toggle(i); toggleExpand(f.nome) }}
              aria-expanded={expandedCategoria === f.nome}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-[8px] px-2 py-2 text-left text-[14px] transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                boundedActive === i ? 'bg-secondary' : 'hover:bg-secondary/60'
              )}
            >
              <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <span className="min-w-0 flex-1 truncate">{f.nome}</span>
              <span className="whitespace-nowrap font-mono text-[13px]">€ {eur2(f.totale)}</span>
              <span className="w-10 text-right font-mono text-xs text-muted-foreground">{f.percentuale.toFixed(0)}%</span>
              <ChevronDown className={cn('h-3.5 w-3.5 flex-none text-muted-foreground transition-transform', expandedCategoria === f.nome && 'rotate-180')} />
            </button>
          ))}
        </div>
      </div>

      {/* Drill-down per nome_spesa: fuori dalla griglia ciambella/legenda,
          a piena larghezza, cosi' l'elenco (eventualmente raggruppato per
          locale) ha spazio invece di stringersi nella colonna stretta. */}
      {drilldown && (
        <div className="rounded-[10px] bg-background p-3 space-y-3">
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
                      € {eur2(item.totale)} <span className="text-xs">({item.occorrenze} {item.occorrenze === 1 ? 'volta' : 'volte'})</span>
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
