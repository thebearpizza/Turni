'use client'
import { useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
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

// Fase D: ripartizione delle spese per categoria nel periodo selezionato —
// base per il futuro calcolo del margine per locale (entrate - costi per
// categoria).
export function CategorieBreakdownChart({ spese }: Props) {
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={fette} dataKey="totale" nameKey="nome" innerRadius={50} outerRadius={90} paddingAngle={2}>
              {fette.map((f, i) => (
                <Cell key={f.nome} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value, name) => [`€ ${Number(value).toFixed(2)}`, name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-1.5">
        {fette.map((f, i) => (
          <div key={f.nome} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <span className={cn('h-2.5 w-2.5 rounded-full shrink-0')} style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <span className="truncate">{f.nome}</span>
            </div>
            <div className="cassa-numeric flex items-center gap-2 shrink-0 whitespace-nowrap text-muted-foreground">
              <span>€ {f.totale.toFixed(2)}</span>
              <span className="w-12 text-right">{f.percentuale.toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
