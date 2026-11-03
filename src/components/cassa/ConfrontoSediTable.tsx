'use client'
import { useMemo } from 'react'
import { cn , eur2 } from '@/lib/utils'

interface Riga {
  restaurant_id: string
  restaurant_name: string
  totale_entrate: number
  totale_spese_giornaliere: number
  differenza: number
  coperti: number
  incasso_asporto: number
  entrate_contanti: number
  entrate_pos: number
  entrate_bonifico: number
}

interface Props {
  righe: Riga[]
  /** Colore del locale come nelle pillole dei filtri. */
  colori?: Record<string, string>
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
  contanti: number
  pos: number
  bonifico: number
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
export function ConfrontoSediTable({ righe, colori = {} }: Props) {
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
          contanti: 0,
          pos: 0,
          bonifico: 0,
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
      c.contanti += r.entrate_contanti ?? 0
      c.pos += r.entrate_pos ?? 0
      c.bonifico += r.entrate_bonifico ?? 0
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
  const massimo = Math.max(...confronti.map(c => c.totaleEntrate), 1)
  const eur = (n: number) => `${n < 0 ? '−' : ''}€ ${eur2(Math.abs(n))}`
  const th = 'px-3 py-2.5 text-right font-medium whitespace-nowrap'
  const td = 'px-3 py-3 text-right font-mono text-[14px] whitespace-nowrap'

  return (
    <div className="-mx-4 overflow-x-auto overscroll-x-contain sm:-mx-5">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-y border-border bg-background text-xs text-muted-foreground">
            <th className="sticky left-0 z-10 bg-background py-2.5 pl-4 pr-3 text-left font-medium sm:pl-5">Ristorante</th>
            <th className={th}>Giorni</th>
            <th className={th}>Totale entrate</th>
            <th className={th}>Contanti</th>
            <th className={th}>POS</th>
            <th className={th}>Bonifico</th>
            <th className={th}>Asporto</th>
            <th className={th}>Coperti</th>
            <th className={th}>Media / giorno</th>
            <th className={th}>Totale spese</th>
            <th className={th}>Spese / giorno</th>
            <th className={th}>Media scontrino</th>
            <th className={th}>Margine operativo</th>
            <th className={`${th} pr-4 sm:pr-5`}>Differenza</th>
          </tr>
        </thead>
        <tbody>
          {confronti.map(c => {
            const pari = Math.abs(c.totaleDifferenza) < 0.005
            return (
              <tr key={c.restaurant_id} className="border-b border-border last:border-0">
                <td className="sticky left-0 z-10 bg-card py-3 pl-4 pr-3 sm:pl-5">
                  <span className="flex items-center gap-2.5 whitespace-nowrap text-[14px] font-semibold">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colori[c.restaurant_id] ?? 'var(--muted-foreground)' }} />
                    {c.restaurant_name}
                  </span>
                </td>
                <td className={td}>{c.giorni}</td>
                <td className={td}>
                  <span className="flex flex-col items-end gap-1">
                    {eur(c.totaleEntrate)}
                    <span className="flex h-1 w-full justify-end overflow-hidden rounded-full bg-secondary">
                      <span className="rounded-full" style={{ width: `${(c.totaleEntrate / massimo) * 100}%`, background: colori[c.restaurant_id] ?? 'var(--muted-foreground)' }} />
                    </span>
                  </span>
                </td>
                <td className={td}>{eur(c.contanti)}</td>
                <td className={td}>{eur(c.pos)}</td>
                <td className={td}>{eur(c.bonifico)}</td>
                <td className={td}>{eur(c.totaleIncassoAsporto)}</td>
                <td className={td}>{c.totaleCoperti}</td>
                <td className={td}>{eur(c.mediaEntrate)}</td>
                <td className={td}>{eur(c.totaleSpese)}</td>
                <td className={td}>{eur(c.mediaSpese)}</td>
                <td className={td}>{c.mediaScontrino === null ? '—' : eur(c.mediaScontrino)}</td>
                <td className={cn(td, c.margineOperativo < 0 && 'text-neg')}>{eur(c.margineOperativo)}</td>
                <td className={cn(td, 'pr-4 sm:pr-5', pari ? 'text-ok' : 'text-neg')}>
                  {pari ? '€ 0,00' : `${c.totaleDifferenza > 0 ? '+' : ''}${eur(c.totaleDifferenza)}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
