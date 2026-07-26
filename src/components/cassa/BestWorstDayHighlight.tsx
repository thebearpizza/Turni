'use client'
import { useMemo } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { cn } from '@/lib/utils'

const TZ = 'Europe/Rome'

interface Riga {
  data: string
  restaurant_name: string
  totale_entrate: number
}

interface Props {
  righe: Riga[]
}

// Evidenzia il giorno con le entrate più alte e più basse nel periodo
// filtrato — solo un confronto puntuale, non richiede fetch aggiuntivi
// (stessi dati già caricati per il resto della pagina).
export function BestWorstDayHighlight({ righe }: Props) {
  const { best, worst } = useMemo(() => {
    if (righe.length === 0) return { best: null, worst: null }
    let best = righe[0]
    let worst = righe[0]
    for (const r of righe) {
      if (r.totale_entrate > best.totale_entrate) best = r
      if (r.totale_entrate < worst.totale_entrate) worst = r
    }
    return { best, worst }
  }, [righe])

  if (!best || !worst || best === worst) return null

  function fmt(r: Riga) {
    return formatInTimeZone(`${r.data}T12:00:00Z`, TZ, 'dd/MM/yyyy', { locale: it })
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="flex items-center gap-3 rounded-lg border border-cassa-positive/30 bg-cassa-positive-bg px-4 py-3">
        <TrendingUp className="w-5 h-5 text-cassa-positive shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-cassa-positive/80">Giorno migliore · {best.restaurant_name}</p>
          <p className="cassa-numeric text-sm font-semibold text-cassa-positive whitespace-nowrap">
            {fmt(best)} · € {best.totale_entrate.toFixed(2)}
          </p>
        </div>
      </div>
      <div className={cn('flex items-center gap-3 rounded-lg border px-4 py-3', 'border-cassa-negative/30 bg-cassa-negative-bg')}>
        <TrendingDown className="w-5 h-5 text-cassa-negative shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-cassa-negative/80">Giorno peggiore · {worst.restaurant_name}</p>
          <p className="cassa-numeric text-sm font-semibold text-cassa-negative whitespace-nowrap">
            {fmt(worst)} · € {worst.totale_entrate.toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  )
}
