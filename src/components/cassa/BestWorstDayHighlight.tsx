'use client'
import { useMemo } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { eur2 } from '@/lib/utils'

const TZ = 'Europe/Rome'

interface Riga {
  data: string
  restaurant_name: string
  totale_entrate: number
}

// Giorno migliore e peggiore del periodo (design Manager Analisi): somma di
// tutti i locali selezionati per data, con il locale che ha inciso di più.
export function BestWorstDayHighlight({ righe }: { righe: Riga[] }) {
  const giorni = useMemo(() => {
    const m = new Map<string, { data: string; totale: number; perLocale: Map<string, number> }>()
    for (const r of righe) {
      let g = m.get(r.data)
      if (!g) { g = { data: r.data, totale: 0, perLocale: new Map() }; m.set(r.data, g) }
      g.totale += r.totale_entrate
      g.perLocale.set(r.restaurant_name, (g.perLocale.get(r.restaurant_name) ?? 0) + r.totale_entrate)
    }
    return Array.from(m.values()).sort((a, b) => b.totale - a.totale)
  }, [righe])

  if (giorni.length < 2) return null
  const best = giorni[0], worst = giorni[giorni.length - 1]
  const traina = (g: typeof best) => [...g.perLocale.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const piuLocali = new Set(righe.map(r => r.restaurant_name)).size > 1

  const scheda = (g: typeof best, tipo: 'ok' | 'neg') => (
    <div className={tipo === 'ok'
      ? 'anim-swapin flex flex-col gap-1 rounded-[12px] border border-[oklch(0.88_0.05_150)] bg-ok-tint px-4 py-3.5 dark:border-[oklch(0.35_0.05_150)]'
      : 'anim-swapin flex flex-col gap-1 rounded-[12px] border border-[oklch(0.9_0.04_25)] bg-neg-tint px-4 py-3.5 dark:border-[oklch(0.35_0.05_25)]'}>
      <span className={`text-[10px] font-semibold uppercase tracking-[.06em] ${tipo === 'ok' ? 'text-ok' : 'text-neg'}`}>
        Giorno {tipo === 'ok' ? 'migliore' : 'peggiore'}
      </span>
      <span className="text-[15px] font-semibold capitalize">{formatInTimeZone(`${g.data}T12:00:00Z`, TZ, 'EEE d MMM', { locale: it })}</span>
      <span className={`font-mono text-[18px] font-semibold ${tipo === 'ok' ? 'text-ok' : 'text-neg'}`}>€ {eur2(g.totale)}</span>
      {piuLocali && <span className="text-xs text-muted-foreground">traina {traina(g)}</span>}
    </div>
  )

  return (
    <div className="grid grid-cols-2 gap-3">
      {scheda(best, 'ok')}
      {scheda(worst, 'neg')}
    </div>
  )
}
