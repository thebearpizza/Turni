'use client'
import { useMemo, useState } from 'react'
import { LineChart, Line, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts'
import { CassaPill } from '@/components/cassa/CassaPill'
import { usePrefersReducedMotion } from '@/components/cassa/usePrefersReducedMotion'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'

export interface PuntoStorico {
  data: string // yyyy-MM-dd
  prezzo: number // già normalizzato (prezzo_unitario / fattore_conversione)
}

interface Candela {
  mese: string // yyyy-MM
  meseLabel: string
  low: number
  high: number
  open: number
  close: number
}

function raggruppaPerMese(storico: PuntoStorico[]): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (const p of storico) {
    const mese = p.data.slice(0, 7)
    if (!map.has(mese)) map.set(mese, [])
    map.get(mese)!.push(p.prezzo)
  }
  return map
}

function costruisciCandele(storico: PuntoStorico[]): Candela[] {
  const map = raggruppaPerMese(storico)
  return Array.from(map.entries()).map(([mese, prezzi]) => ({
    mese,
    meseLabel: format(new Date(`${mese}-01T12:00:00Z`), 'MMM yyyy', { locale: it }),
    low: Math.min(...prezzi),
    high: Math.max(...prezzi),
    open: prezzi[0],
    close: prezzi[prezzi.length - 1],
  }))
}

// Corpo/stoppino della candela: il Bar sottostante rappresenta il range
// [low, high] (recharts supporta dataKey ad array per barre "floating"),
// lo shape personalizzato aggiunge lo stoppino sottile su tutto il range e
// il corpo colorato tra open e close, verde se sale, rame/rosso se scende.
function CandleShape(props: unknown) {
  const { x, y, width, height, payload } = props as { x: number; y: number; width: number; height: number; payload: Candela }
  const { open, close, high, low } = payload
  if (high === low) {
    // Nessuna variazione nel mese: un solo trattino orizzontale.
    return <line x1={x} x2={x + width} y1={y + height / 2} y2={y + height / 2} stroke="hsl(var(--muted-foreground))" strokeWidth={2} />
  }
  const priceToY = (price: number) => y + height * (high - price) / (high - low)
  const bodyTop = priceToY(Math.max(open, close))
  const bodyBottom = priceToY(Math.min(open, close))
  const salito = close >= open
  const colore = salito ? 'hsl(var(--cassa-positive))' : '#9C4B3D'
  const cx = x + width / 2
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={colore} strokeWidth={1.5} />
      <rect
        x={x + width * 0.2}
        y={bodyTop}
        width={width * 0.6}
        height={Math.max(bodyBottom - bodyTop, 1.5)}
        fill={colore}
        rx={1}
      />
    </g>
  )
}

interface Props {
  storico: PuntoStorico[]
  unitaMisura: string | null
}

// Vista di default a linea/gradini (funziona sempre); se nello storico
// esiste più di un acquisto nello stesso mese, offre anche la vista a
// candela per quel raggruppamento mensile.
export function ArticoloPrezzoChart({ storico, unitaMisura }: Props) {
  const reducedMotion = usePrefersReducedMotion()
  const raggruppato = useMemo(() => raggruppaPerMese(storico), [storico])
  const puoUsareCandele = useMemo(() => Array.from(raggruppato.values()).some(v => v.length > 1), [raggruppato])
  const [vista, setVista] = useState<'linea' | 'candela'>('linea')

  const datiLinea = useMemo(
    () => storico.map(p => ({ data: p.data, label: format(new Date(`${p.data}T12:00:00Z`), 'dd/MM', { locale: it }), prezzo: p.prezzo })),
    [storico]
  )
  const candele = useMemo(() => (puoUsareCandele ? costruisciCandele(storico) : []), [storico, puoUsareCandele])

  if (storico.length === 0) {
    return <p className="text-xs text-muted-foreground">Nessuno storico prezzi disponibile.</p>
  }

  return (
    <div className="space-y-2">
      {puoUsareCandele && (
        <div className="flex gap-2">
          <CassaPill active={vista === 'linea'} onClick={() => setVista('linea')}>Linea</CassaPill>
          <CassaPill active={vista === 'candela'} onClick={() => setVista('candela')}>Candela</CassaPill>
        </div>
      )}

      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {vista === 'linea' || !puoUsareCandele ? (
            <LineChart data={datiLinea} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={50} domain={['auto', 'auto']} />
              <Tooltip formatter={(v: unknown) => [`€ ${Number(v).toFixed(2)}${unitaMisura ? ` / ${unitaMisura}` : ''}`, 'Prezzo']} labelFormatter={l => l} />
              <Line type="stepAfter" dataKey="prezzo" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={!reducedMotion} />
            </LineChart>
          ) : (
            <ComposedChart data={candele} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="meseLabel" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={50} domain={['auto', 'auto']} />
              <Tooltip
                formatter={(_v: unknown, _n: unknown, item: unknown) => {
                  const c = (item as { payload: Candela }).payload
                  return [`apertura € ${c.open.toFixed(2)} · chiusura € ${c.close.toFixed(2)} · min € ${c.low.toFixed(2)} · max € ${c.high.toFixed(2)}`, '']
                }}
              />
              <Bar dataKey={(d: Candela) => [d.low, d.high]} shape={CandleShape} isAnimationActive={!reducedMotion} />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
