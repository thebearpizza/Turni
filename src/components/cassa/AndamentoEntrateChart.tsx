'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Line, ComposedChart, Cell } from 'recharts'
import type { MouseHandlerDataParam } from 'recharts/types/synchronisation/types'
import { usePrefersReducedMotion } from '@/components/cassa/usePrefersReducedMotion'
import { SchedaAnalisi } from '@/components/cassa/SchedaAnalisi'
import { cn, eur2 } from '@/lib/utils'
import { format, startOfWeek, startOfMonth, subYears } from 'date-fns'
import { it } from 'date-fns/locale'

interface Riga {
  data: string
  restaurant_id: string
  totale_entrate: number
  totale_spese_giornaliere: number
  differenza: number
}

export interface LocaleGrafico { id: string; nome: string; colore: string }

type Granularita = 'giorno' | 'settimana' | 'mese'
const ETICHETTE: Record<Granularita, string> = { giorno: 'per giorno', settimana: 'per settimana', mese: 'per mese' }

type Bucket = {
  key: string
  asse: string
  titolo: string
  totale: number
  spese: number
  differenza: number
  precedente?: number | null
} & Record<string, number | string | null | undefined>

function chiave(dateStr: string, g: Granularita): { key: string; asse: string; titolo: string } {
  const d = new Date(`${dateStr}T12:00:00Z`)
  if (g === 'giorno') {
    const gg = format(d, 'EEEEEE', { locale: it }).charAt(0).toUpperCase()
    return { key: dateStr, asse: `${gg} ${format(d, 'd')}`, titolo: format(d, 'EEE d MMM', { locale: it }) }
  }
  if (g === 'settimana') {
    const s = startOfWeek(d, { weekStartsOn: 1 })
    return { key: format(s, 'yyyy-MM-dd'), asse: format(s, 'd/M'), titolo: `Settimana dal ${format(s, 'd MMM', { locale: it })}` }
  }
  const m = startOfMonth(d)
  return { key: format(m, 'yyyy-MM'), asse: format(m, 'MMM', { locale: it }), titolo: format(m, 'MMMM yyyy', { locale: it }) }
}

function chiaveAnnoPrima(key: string, g: Granularita): string {
  if (g === 'mese') { const [y, m] = key.split('-'); return `${Number(y) - 1}-${m}` }
  return format(subYears(new Date(`${key}T12:00:00Z`), 1), 'yyyy-MM-dd')
}

function aggrega(righe: Riga[], g: Granularita, locali: LocaleGrafico[]): Bucket[] {
  const m = new Map<string, Bucket>()
  for (const r of righe) {
    const k = chiave(r.data, g)
    let b = m.get(k.key)
    if (!b) {
      b = { ...k, totale: 0, spese: 0, differenza: 0 } as Bucket
      for (const l of locali) b[l.id] = 0
      m.set(k.key, b)
    }
    b.totale += r.totale_entrate
    b.spese += r.totale_spese_giornaliere
    b.differenza += r.differenza
    b[r.restaurant_id] = ((b[r.restaurant_id] as number) ?? 0) + r.totale_entrate
  }
  return Array.from(m.values()).sort((a, b) => a.key.localeCompare(b.key))
}

const kEuro = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n))

// Blocca lo scroll verticale mentre il dito scorre sul grafico (i listener
// React sono passive: serve quello nativo per poter fare preventDefault).
function useBloccaScroll(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const stop = (e: TouchEvent) => e.preventDefault()
    el.addEventListener('touchmove', stop, { passive: false })
    return () => el.removeEventListener('touchmove', stop)
  }, [ref])
}

// "Andamento entrate" del design: barre impilate per locale, un colore per
// locale come nelle pillole dei filtri. Tocca (o scorri) per vedere il
// dettaglio del giorno; col confronto attivo la linea tratteggiata è
// l'incasso dello stesso periodo dell'anno prima.
export function AndamentoEntrateChart({ righe, righePrecedenti, locali }: {
  righe: Riga[]
  righePrecedenti?: Riga[]
  locali: LocaleGrafico[]
}) {
  const [granularita, setGranularita] = useState<Granularita>('giorno')
  const [attivo, setAttivo] = useState<string | null>(null)
  const ridotto = usePrefersReducedMotion()
  const area = useRef<HTMLDivElement>(null)
  useBloccaScroll(area)
  const conConfronto = !!righePrecedenti?.length

  const localiPresenti = useMemo(() => locali.filter(l => righe.some(r => r.restaurant_id === l.id)), [locali, righe])
  const dati = useMemo(() => {
    const cur = aggrega(righe, granularita, localiPresenti)
    if (!conConfronto) return cur
    const prev = new Map(aggrega(righePrecedenti!, granularita, localiPresenti).map(b => [b.key, b.totale]))
    return cur.map(b => ({ ...b, precedente: prev.get(chiaveAnnoPrima(b.key, granularita)) ?? null }) as Bucket)
  }, [righe, righePrecedenti, granularita, localiPresenti, conConfronto])

  const sel = dati.find(b => b.key === attivo) ?? null

  function segui(s: MouseHandlerDataParam) {
    const i = s?.activeIndex != null ? Number(s.activeIndex) : NaN
    const k = Number.isNaN(i) ? undefined : dati[i]?.key
    if (k) setAttivo(k)
  }

  const Grafico = conConfronto ? ComposedChart : BarChart
  const ultimo = localiPresenti[localiPresenti.length - 1]?.id

  return (
    <SchedaAnalisi
      titolo="Andamento entrate"
      sotto={`${ETICHETTE[granularita]} · tocca ${granularita === 'giorno' ? 'un giorno' : granularita === 'settimana' ? 'una settimana' : 'un mese'}`}
      destra={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {localiPresenti.length > 1 && localiPresenti.map(l => (
            <span key={l.id} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: l.colore }} />{l.nome}</span>
          ))}
          {conConfronto && <span className="flex items-center gap-1.5"><span className="w-3 border-t-2 border-dashed border-muted-foreground" />Anno prima</span>}
        </div>
      }
    >
      <div className="flex gap-1 self-start rounded-[10px] bg-secondary p-1">
        {(Object.keys(ETICHETTE) as Granularita[]).map(g => (
          <button key={g} type="button" onClick={() => { setGranularita(g); setAttivo(null) }}
            className={cn('h-8 rounded-[7px] px-3 text-[13px] font-medium capitalize', granularita === g ? 'bg-card shadow-sm' : 'text-muted-foreground')}>
            {g}
          </button>
        ))}
      </div>

      <div className={cn('grid grid-cols-2 gap-2 rounded-[10px] bg-background px-3.5 py-2.5 sm:grid-cols-4', !sel && 'opacity-70')}>
        <div className="col-span-2 flex flex-col sm:col-span-1">
          <span className="text-[11px] text-muted-foreground">{sel ? 'Selezionato' : 'Nel periodo'}</span>
          <span className="text-[14px] font-semibold capitalize">{sel ? sel.titolo : `${dati.length} ${granularita === 'giorno' ? 'giorni' : granularita === 'settimana' ? 'settimane' : 'mesi'}`}</span>
        </div>
        {[
          ['Entrate', sel ? sel.totale : dati.reduce((s, b) => s + b.totale, 0), ''],
          ['Spese', sel ? sel.spese : dati.reduce((s, b) => s + b.spese, 0), ''],
          ['Differenza', sel ? sel.differenza : dati.reduce((s, b) => s + b.differenza, 0), 'diff'],
        ].map(([l, v, t]) => (
          <div key={l as string} className="flex flex-col">
            <span className="text-[11px] text-muted-foreground">{l}</span>
            <span className={cn('whitespace-nowrap font-mono text-[14px] font-semibold', t === 'diff' && ((v as number) < -0.005 ? 'text-neg' : (v as number) > 0.005 ? 'text-ok' : ''))}>
              {(v as number) < 0 ? '−' : ''}€ {eur2(Math.abs(v as number))}
            </span>
          </div>
        ))}
        {sel && localiPresenti.length > 1 && (
          <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 sm:col-span-4">
            {localiPresenti.map(l => (
              <span key={l.id} className="flex items-center gap-1.5 text-xs">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: l.colore }} />{l.nome}
                <span className="font-mono text-muted-foreground">€ {eur2((sel[l.id] as number) ?? 0)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div ref={area} className="h-64 w-full sm:h-72" style={{ touchAction: 'none' }} onMouseLeave={() => setAttivo(null)}>
        <ResponsiveContainer width="100%" height="100%">
          <Grafico data={dati} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} onMouseMove={segui} onTouchStart={segui} onTouchMove={segui} onClick={segui}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="asse" tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval="preserveStartEnd" minTickGap={8}
              tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'var(--muted-foreground)' }} />
            <YAxis tickFormatter={kEuro} tickLine={false} axisLine={false} width={44}
              tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'var(--muted-foreground)' }} />
            {localiPresenti.map(l => (
              <Bar key={l.id} dataKey={l.id} name={l.nome} stackId="e" fill={l.colore} maxBarSize={44}
                radius={l.id === ultimo ? [5, 5, 0, 0] : 0} isAnimationActive={!ridotto} animationDuration={600}
                stroke="var(--card)" strokeWidth={1}>
                {dati.map(b => <Cell key={b.key} fillOpacity={!sel || sel.key === b.key ? 0.9 : 0.35} />)}
              </Bar>
            ))}
            {conConfronto && (
              <Line type="monotone" dataKey="precedente" name="Anno prima" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={!ridotto} />
            )}
          </Grafico>
        </ResponsiveContainer>
      </div>
    </SchedaAnalisi>
  )
}
