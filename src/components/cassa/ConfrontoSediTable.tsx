'use client'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'

interface Riga {
  restaurant_id: string
  restaurant_name: string
  totale_entrate: number
  totale_spese_giornaliere: number
  differenza: number
  coperti: number
  incasso_asporto: number
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
  totaleCoperti: number
  totaleIncassoAsporto: number
  mediaEntrate: number
  mediaSpese: number
  mediaScontrino: number | null
  margineOperativo: number
}

// Fase B: totali e medie del periodo selezionato, affiancati per
// ristorante — usa le stesse righe già caricate per la Fase A (nessuna
// query aggiuntiva).
//
// Media Scontrino e Margine Operativo sono calcolati sui TOTALI del
// periodo, non come media delle medie giornaliere (che pesa ogni giorno
// allo stesso modo indipendentemente dai coperti/incassi reali e
// distorcerebbe il risultato su periodi con giornate molto diverse tra loro).
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
          totaleCoperti: 0,
          totaleIncassoAsporto: 0,
          mediaEntrate: 0,
          mediaSpese: 0,
          mediaScontrino: null,
          margineOperativo: 0,
        }
        byRestaurant.set(r.restaurant_id, c)
      }
      c.giorni += 1
      c.totaleEntrate += r.totale_entrate
      c.totaleSpese += r.totale_spese_giornaliere
      c.totaleDifferenza += r.differenza
      c.totaleCoperti += r.coperti
      c.totaleIncassoAsporto += r.incasso_asporto
    }

    return Array.from(byRestaurant.values())
      .map(c => ({
        ...c,
        mediaEntrate: c.giorni > 0 ? c.totaleEntrate / c.giorni : 0,
        mediaSpese: c.giorni > 0 ? c.totaleSpese / c.giorni : 0,
        mediaScontrino: c.totaleCoperti > 0 ? (c.totaleEntrate - c.totaleIncassoAsporto) / c.totaleCoperti : null,
        margineOperativo: c.totaleEntrate - c.totaleSpese,
      }))
      .sort((a, b) => b.totaleEntrate - a.totaleEntrate)
  }, [righe])

  if (confronti.length === 0) return null

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="sticky left-0 z-10 bg-card border-r border-border py-2 pr-4 pl-1 font-medium">Ristorante</th>
            <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">Giorni</th>
            <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">Totale Entrate</th>
            <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">Media Entrate/Giorno</th>
            <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">Totale Spese</th>
            <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">Media Spese/Giorno</th>
            <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">Media Scontrino</th>
            <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">Margine Operativo</th>
            <th className="py-2 font-medium text-right whitespace-nowrap">Differenza Totale</th>
          </tr>
        </thead>
        <tbody>
          {confronti.map(c => {
            const isBalanced = Math.abs(c.totaleDifferenza) < 0.005
            return (
              <tr key={c.restaurant_id} className="border-b border-border last:border-0">
                <td className="sticky left-0 z-10 bg-card border-r border-border py-2 pr-4 pl-1 font-medium whitespace-nowrap">{c.restaurant_name}</td>
                <td className="cassa-numeric py-2 pr-4 text-right whitespace-nowrap">{c.giorni}</td>
                <td className="cassa-numeric py-2 pr-4 text-right whitespace-nowrap">€ {c.totaleEntrate.toFixed(2)}</td>
                <td className="cassa-numeric py-2 pr-4 text-right whitespace-nowrap">€ {c.mediaEntrate.toFixed(2)}</td>
                <td className="cassa-numeric py-2 pr-4 text-right whitespace-nowrap">€ {c.totaleSpese.toFixed(2)}</td>
                <td className="cassa-numeric py-2 pr-4 text-right whitespace-nowrap">€ {c.mediaSpese.toFixed(2)}</td>
                <td className="cassa-numeric py-2 pr-4 text-right whitespace-nowrap">
                  {c.mediaScontrino === null ? '—' : `€ ${c.mediaScontrino.toFixed(2)}`}
                </td>
                <td className={cn(
                  'cassa-numeric py-2 pr-4 text-right whitespace-nowrap font-medium',
                  c.margineOperativo >= 0 ? 'text-cassa-positive' : 'text-cassa-negative'
                )}>
                  {c.margineOperativo >= 0 ? '' : '−'}€ {Math.abs(c.margineOperativo).toFixed(2)}
                </td>
                <td className={cn(
                  'cassa-numeric py-2 text-right font-medium whitespace-nowrap',
                  isBalanced ? 'text-cassa-positive' : 'text-cassa-negative'
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
