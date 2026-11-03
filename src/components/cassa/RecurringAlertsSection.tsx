'use client'
import { useMemo } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { eur2 } from '@/lib/utils'
import { SchedaAnalisi } from '@/components/cassa/SchedaAnalisi'

const TZ = 'Europe/Rome'

// Soglia fissa per l'evidenza delle differenze ricorrenti.
const SOGLIA_DIFFERENZA = 5
const MIN_GIORNI = 3

interface Riga {
  data: string
  restaurant_id: string
  restaurant_name: string
  differenza: number
}

const segno = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}€ ${eur2(Math.abs(n))}`

// "Differenze ricorrenti" del design: i locali dove la differenza di cassa
// esce dalla soglia in almeno MIN_GIORNI del periodo, con le date a pillole.
export function RecurringAlertsSection({ righe }: { righe: Riga[] }) {
  const alerts = useMemo(() => {
    const per = new Map<string, { id: string; nome: string; date: string[]; totale: number }>()
    for (const r of righe) {
      if (Math.abs(r.differenza) < SOGLIA_DIFFERENZA) continue
      let g = per.get(r.restaurant_id)
      if (!g) { g = { id: r.restaurant_id, nome: r.restaurant_name, date: [], totale: 0 }; per.set(r.restaurant_id, g) }
      g.date.push(r.data)
      g.totale += r.differenza
    }
    return Array.from(per.values())
      .filter(g => g.date.length >= MIN_GIORNI)
      .map(g => ({ ...g, media: g.totale / g.date.length, date: [...g.date].sort() }))
      .sort((a, b) => b.date.length - a.date.length)
  }, [righe])

  return (
    <SchedaAnalisi
      titolo={
        <span className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={alerts.length ? 'text-neg' : 'text-ok'} aria-hidden><path d="M12 4l9 16H3z" /><path d="M12 10v4" /><path d="M12 17.5v.01" /></svg>
          Differenze ricorrenti
        </span>
      }
      sotto={`oltre ${SOGLIA_DIFFERENZA} € per almeno ${MIN_GIORNI} giorni`}
      ritardo={240}
    >
      {alerts.length === 0 ? (
        <div className="flex min-h-[120px] flex-1 items-center justify-center rounded-[8px] bg-ok-tint text-sm font-medium text-ok">
          Nessun locale oltre soglia nel periodo
        </div>
      ) : alerts.map(a => (
        <div key={a.id} className="flex flex-col gap-2 rounded-[8px] bg-neg-tint px-3.5 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[15px] font-semibold text-neg">{a.nome} · {a.date.length} giorni</span>
            <span className="font-mono text-xs text-neg">media {segno(a.media)} · totale {segno(a.totale)}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {a.date.map(d => (
              <span key={d} className="rounded-full bg-card px-2 py-0.5 font-mono text-[11px] text-neg">
                {formatInTimeZone(`${d}T12:00:00Z`, TZ, 'd MMM', { locale: it })}
              </span>
            ))}
          </div>
        </div>
      ))}
    </SchedaAnalisi>
  )
}
