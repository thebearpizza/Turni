'use client'
import { useMemo } from 'react'
import { Sparkline } from '@/components/home/Sparkline'
import { ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Riga {
  data?: string
  totale_entrate: number
  totale_spese_giornaliere: number
  differenza: number
  coperti?: number
  incasso_asporto?: number
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

// Badge della variazione (design): pillola tinta verde o rossa secondo se
// è un miglioramento per quella metrica, freccia nel verso del segno.
function VarianceBadge({ value, direzioneBuona }: { value: number | null; direzioneBuona: 'su' | 'giu' }) {
  if (value === null) return null
  const isUp = value >= 0
  const isGood = direzioneBuona === 'su' ? isUp : !isUp
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-px font-mono text-[10px] font-semibold', isGood ? 'bg-ok-tint text-ok' : 'bg-neg-tint text-neg')}>
      {isUp ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(value).toFixed(1).replace('.', ',')}%
    </span>
  )
}

const eur = (n: number, dec = 0) => `${n < 0 ? '−' : ''}€ ${Math.abs(n).toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`

export function AnalisiKpiRow({ righe, righePeriodoPrecedente }: Props) {
  const current = useMemo(() => aggregate(righe), [righe])
  const previous = useMemo(() => righePeriodoPrecedente ? aggregate(righePeriodoPrecedente) : null, [righePeriodoPrecedente])
  const coperti = (rs: Riga[]) => rs.reduce((t, r) => t + (r.coperti ?? 0), 0)
  const media = (rs: Riga[]) => { const c = coperti(rs); return c ? rs.reduce((t, r) => t + r.totale_entrate - (r.incasso_asporto ?? 0), 0) / c : 0 }

  // Serie per giorno per i mini-grafici.
  const serie = useMemo(() => {
    const giorni = new Map<string, Riga[]>()
    for (const r of righe) if (r.data) giorni.set(r.data, [...(giorni.get(r.data) ?? []), r])
    return Array.from(giorni).sort(([a], [b]) => a.localeCompare(b)).map(([, rs]) => rs)
  }, [righe])

  const tiles = [
    { label: 'Totale entrate', value: current.totaleEntrate, prev: previous?.totaleEntrate, direzioneBuona: 'su' as const, useAbs: false, fmt: (n: number) => eur(n), colore: 'oklch(0.58 0.12 180)', s: serie.map(rs => aggregate(rs).totaleEntrate) },
    { label: 'Totale spese', value: current.totaleSpese, prev: previous?.totaleSpese, direzioneBuona: 'giu' as const, useAbs: false, fmt: (n: number) => eur(n), colore: 'oklch(0.6 0.11 250)', s: serie.map(rs => aggregate(rs).totaleSpese) },
    { label: 'Margine operativo', value: current.margineOperativo, prev: previous?.margineOperativo, direzioneBuona: 'su' as const, useAbs: false, fmt: (n: number) => eur(n), colore: 'oklch(0.58 0.12 180)', s: serie.map(rs => aggregate(rs).margineOperativo) },
    // Differenza cumulata: allontanarsi da zero è un peggioramento in entrambi
    // i versi, quindi il confronto usa il valore assoluto.
    { label: 'Differenza cumulata', value: current.differenzaCumulata, prev: previous?.differenzaCumulata, direzioneBuona: 'giu' as const, useAbs: true, fmt: (n: number) => eur(n, 2), colore: 'oklch(0.6 0.13 25)', s: serie.map(rs => aggregate(rs).differenzaCumulata), segno: true },
    { label: 'Coperti', value: coperti(righe), prev: righePeriodoPrecedente ? coperti(righePeriodoPrecedente) : undefined, direzioneBuona: 'su' as const, useAbs: false, fmt: (n: number) => n.toLocaleString('it-IT'), colore: 'oklch(0.72 0.12 75)', s: serie.map(coperti) },
    { label: 'Media scontrino', value: media(righe), prev: righePeriodoPrecedente ? media(righePeriodoPrecedente) : undefined, direzioneBuona: 'su' as const, useAbs: false, fmt: (n: number) => eur(n, 2), colore: 'oklch(0.62 0.12 330)', s: serie.map(media) },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {tiles.map((t, i) => {
        const neg = t.segno && t.value < 0
        return (
          <div key={t.label} className="anim-inrise flex flex-col gap-1.5 rounded-[12px] border border-border bg-card p-4" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="text-[13px] text-muted-foreground">{t.label}</span>
            <span className={cn('font-mono text-[22px] font-medium leading-tight', neg && 'text-neg')}>{t.fmt(t.value)}</span>
            {t.prev !== undefined && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <VarianceBadge value={t.useAbs ? variance(Math.abs(t.value), Math.abs(t.prev)) : variance(t.value, t.prev)} direzioneBuona={t.direzioneBuona} />
                vs prima
              </span>
            )}
            <div className="mt-1"><Sparkline valori={t.s} colore={t.colore} w={140} h={30} pieno /></div>
          </div>
        )
      })}
    </div>
  )
}
