'use client'
import { useMemo } from 'react'
import { SchedaAnalisi } from '@/components/cassa/SchedaAnalisi'
import type { LocaleGrafico } from '@/components/cassa/AndamentoEntrateChart'

interface Riga { data: string; restaurant_id: string; totale_entrate: number }

const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
const kEuro = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(Math.round(n))

// "Giorni della settimana" del design: entrata media per giorno della
// settimana e locale; più la cella è intensa, più quel giorno rende.
export function GiorniSettimanaHeatmap({ righe, locali }: { righe: Riga[]; locali: LocaleGrafico[] }) {
  const { righeMappa, massimo } = useMemo(() => {
    const presenti = locali.filter(l => righe.some(r => r.restaurant_id === l.id))
    const righeMappa = presenti.map(l => {
      const somme = Array(7).fill(0), conta = Array(7).fill(0)
      for (const r of righe) {
        if (r.restaurant_id !== l.id) continue
        const g = (new Date(`${r.data}T12:00:00Z`).getUTCDay() + 6) % 7
        somme[g] += r.totale_entrate
        conta[g] += 1
      }
      const medie: (number | null)[] = somme.map((s, i) => conta[i] ? s / conta[i] : null)
      return { ...l, medie }
    })
    const massimo = Math.max(0, ...righeMappa.flatMap(r => r.medie.filter((m): m is number => m !== null)))
    return { righeMappa, massimo }
  }, [righe, locali])

  if (righeMappa.length === 0) return null

  return (
    <SchedaAnalisi titolo="Giorni della settimana" sotto="entrate medie per locale" ritardo={180}>
      <div className="grid items-center gap-1" style={{ gridTemplateColumns: 'minmax(64px, 110px) repeat(7, minmax(0, 1fr))' }}>
        <span />
        {GIORNI.map(g => <span key={g} className="py-1.5 text-center text-xs font-medium text-muted-foreground">{g}</span>)}
        {righeMappa.map(r => (
          <div key={r.id} className="contents">
            <span className="truncate pr-1 text-[13px] font-medium">{r.nome}</span>
            {r.medie.map((m, i) => {
              const peso = m === null || massimo === 0 ? 0 : 0.15 + (m / massimo) * 0.85
              const scuro = peso > 0.6
              return (
                <div key={i} title={m === null ? 'Nessuna chiusura' : undefined}
                  className="flex h-11 items-center justify-center rounded-[6px] font-mono text-[11px] font-medium sm:text-xs"
                  style={m === null
                    ? { background: 'var(--secondary)', color: 'var(--muted-foreground)' }
                    : { background: `color-mix(in oklch, ${r.colore} ${Math.round(peso * 100)}%, var(--card))`, color: scuro ? 'white' : 'var(--foreground)' }}>
                  {m === null ? '—' : kEuro(m)}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </SchedaAnalisi>
  )
}
