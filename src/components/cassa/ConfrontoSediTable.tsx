'use client'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'

interface Riga {
  restaurant_id: string
  restaurant_name: string
  totale_entrate: number
  totale_spese_giornaliere: number
  differenza: number
}

interface Props {
  righe: Riga[]
}

interface Confronto {
  restaurant_id: string
  restaurant_name: string
  giorni: number
  totaleEntrate: number
  totaleSpese: number
  totaleDifferenza: number
  mediaEntrate: number
  mediaSpese: number
}

// Fase B: totali e medie del periodo selezionato, affiancati per
// ristorante — usa le stesse righe già caricate per la Fase A (nessuna
// query aggiuntiva).
export function ConfrontoSediTable({ righe }: Props) {
  const confronti = useMemo<Confronto[]>(() => {
    const byRestaurant = new Map<string, Confronto>()

    for (const r of righe) {
      let c = byRestaurant.get(r.restaurant_id)
      if (!c) {
        c = {
          restaurant_id: r.restaurant_id,
          restaurant_name: r.restaurant_name,
          giorni: 0,
          totaleEntrate: 0,
          totaleSpese: 0,
          totaleDifferenza: 0,
          mediaEntrate: 0,
          mediaSpese: 0,
        }
        byRestaurant.set(r.restaurant_id, c)
      }
      c.giorni += 1
      c.totaleEntrate += r.totale_entrate
      c.totaleSpese += r.totale_spese_giornaliere
      c.totaleDifferenza += r.differenza
    }

    return Array.from(byRestaurant.values())
      .map(c => ({
        ...c,
        mediaEntrate: c.giorni > 0 ? c.totaleEntrate / c.giorni : 0,
        mediaSpese: c.giorni > 0 ? c.totaleSpese / c.giorni : 0,
      }))
      .sort((a, b) => b.totaleEntrate - a.totaleEntrate)
  }, [righe])

  if (confronti.length === 0) return null

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Ristorante</th>
            <th className="py-2 pr-4 font-medium text-right">Giorni</th>
            <th className="py-2 pr-4 font-medium text-right">Totale Entrate</th>
            <th className="py-2 pr-4 font-medium text-right">Media Entrate/Giorno</th>
            <th className="py-2 pr-4 font-medium text-right">Totale Spese</th>
            <th className="py-2 pr-4 font-medium text-right">Media Spese/Giorno</th>
            <th className="py-2 font-medium text-right">Differenza Totale</th>
          </tr>
        </thead>
        <tbody>
          {confronti.map(c => {
            const isBalanced = Math.abs(c.totaleDifferenza) < 0.005
            return (
              <tr key={c.restaurant_id} className="border-b border-border last:border-0">
                <td className="py-2 pr-4 font-medium whitespace-nowrap">{c.restaurant_name}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{c.giorni}</td>
                <td className="py-2 pr-4 text-right tabular-nums">€ {c.totaleEntrate.toFixed(2)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">€ {c.mediaEntrate.toFixed(2)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">€ {c.totaleSpese.toFixed(2)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">€ {c.mediaSpese.toFixed(2)}</td>
                <td className={cn(
                  'py-2 text-right tabular-nums font-medium',
                  isBalanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                )}>
                  {isBalanced ? '0,00 €' : `${c.totaleDifferenza > 0 ? '+' : ''}${c.totaleDifferenza.toFixed(2)} €`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
