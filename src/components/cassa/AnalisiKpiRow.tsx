'use client'
import { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Riga {
  totale_entrate: number
  totale_spese_giornaliere: number
  differenza: number
}

interface Props {
  righe: Riga[]
  righePeriodoPrecedente: Riga[] | null
}

interface Aggregati {
  totaleEntrate: number
  totaleSpese: number
  margineOperativo: number
  differenzaCumulata: number
}

function aggregate(righe: Riga[]): Aggregati {
  let totaleEntrate = 0
  let totaleSpese = 0
  let differenzaCumulata = 0
  for (const r of righe) {
    totaleEntrate += r.totale_entrate
    totaleSpese += r.totale_spese_giornaliere
    differenzaCumulata += r.differenza
  }
  return { totaleEntrate, totaleSpese, margineOperativo: totaleEntrate - totaleSpese, differenzaCumulata }
}

// Variazione % rispetto al periodo precedente equivalente (stessa durata,
// immediatamente prima) — null quando il precedente è zero/assente, per non
// mostrare percentuali senza senso (es. da 0 a qualcosa è "infinito").
function variance(curr: number, prev: number): number | null {
  if (prev === 0) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

function VarianceBadge({ value }: { value: number | null }) {
  if (value === null) return null
  const isUp = value >= 0
  return (
    <span className={cn(
      'cassa-numeric inline-flex items-center gap-0.5 text-xs font-medium',
      isUp ? 'text-cassa-positive' : 'text-cassa-negative'
    )}>
      {isUp ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(value).toFixed(0)}%
    </span>
  )
}

export function AnalisiKpiRow({ righe, righePeriodoPrecedente }: Props) {
  const current = useMemo(() => aggregate(righe), [righe])
  const previous = useMemo(() => righePeriodoPrecedente ? aggregate(righePeriodoPrecedente) : null, [righePeriodoPrecedente])

  const tiles = [
    { label: 'Totale Entrate', value: current.totaleEntrate, prev: previous?.totaleEntrate, tone: 'neutral' as const },
    { label: 'Totale Spese', value: current.totaleSpese, prev: previous?.totaleSpese, tone: 'neutral' as const },
    { label: 'Margine Operativo', value: current.margineOperativo, prev: previous?.margineOperativo, tone: 'signed' as const },
    { label: 'Differenza Cumulata', value: current.differenzaCumulata, prev: previous?.differenzaCumulata, tone: 'signed' as const },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tiles.map(t => {
        const isNegative = t.tone === 'signed' && t.value < 0
        return (
          <Card key={t.label} className="cassa-perforated-top">
            <CardContent className="pt-5 pb-4 space-y-1">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <p className={cn(
                  'cassa-numeric text-lg font-semibold whitespace-nowrap',
                  isNegative ? 'text-cassa-negative' : 'text-foreground'
                )}>
                  {t.value < 0 ? '−' : ''}€ {Math.abs(t.value).toFixed(2)}
                </p>
                {t.prev !== undefined && <VarianceBadge value={variance(t.value, t.prev)} />}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
