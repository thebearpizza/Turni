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

// direzioneBuona: quale verso della variazione è un miglioramento per
// quella metrica ('su' per entrate/margine, 'giu' per spese). Decide il
// colore del badge indipendentemente dalla freccia, che segue sempre il
// segno della variazione.
function VarianceBadge({ value, direzioneBuona }: { value: number | null; direzioneBuona: 'su' | 'giu' }) {
  if (value === null) return null
  const isUp = value >= 0
  const isGood = direzioneBuona === 'su' ? isUp : !isUp
  return (
    <span className={cn(
      'cassa-numeric inline-flex items-center gap-0.5 text-xs font-medium',
      isGood ? 'text-cassa-positive' : 'text-cassa-negative'
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
    { label: 'Totale Entrate', value: current.totaleEntrate, prev: previous?.totaleEntrate, tone: 'neutral' as const, direzioneBuona: 'su' as const, useAbs: false },
    { label: 'Totale Spese', value: current.totaleSpese, prev: previous?.totaleSpese, tone: 'neutral' as const, direzioneBuona: 'giu' as const, useAbs: false },
    { label: 'Margine Operativo', value: current.margineOperativo, prev: previous?.margineOperativo, tone: 'signed' as const, direzioneBuona: 'su' as const, useAbs: false },
    // Differenza Cumulata: un ammanco o un'eccedenza che si allontana da
    // zero è un peggioramento in entrambi i versi, quindi il confronto usa
    // il valore assoluto (avvicinarsi a zero = buono) invece del segno.
    { label: 'Differenza Cumulata', value: current.differenzaCumulata, prev: previous?.differenzaCumulata, tone: 'signed' as const, direzioneBuona: 'giu' as const, useAbs: true },
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
                {t.prev !== undefined && (
                  <VarianceBadge
                    value={t.useAbs ? variance(Math.abs(t.value), Math.abs(t.prev)) : variance(t.value, t.prev)}
                    direzioneBuona={t.direzioneBuona}
                  />
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
