// Andamento a 7 giorni (design MTHome): linea con area tenue, i giorni
// senza chiusura restano un vuoto.
export function Sparkline({ valori, colore, w = 96, h = 28 }: { valori: (number | null)[]; colore: string; w?: number; h?: number }) {
  const pieni = valori.filter((v): v is number => v !== null)
  if (pieni.length < 2) return <svg width={w} height={h} aria-hidden />
  const min = Math.min(...pieni), max = Math.max(...pieni), r = max - min || 1
  const pts = valori.map((v, i) => (v === null ? null : [(i / (valori.length - 1)) * w, h - 3 - ((v - min) / r) * (h - 6)] as const))
  const segmenti: string[] = []
  let cur = ''
  for (const p of pts) {
    if (!p) { if (cur) segmenti.push(cur); cur = ''; continue }
    cur += `${cur ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`
  }
  if (cur) segmenti.push(cur)
  const validi = pts.filter(Boolean) as (readonly [number, number])[]
  const area = `M${validi[0][0]} ${h}` + validi.map(p => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + `L${validi[validi.length - 1][0]} ${h}Z`
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <path d={area} fill={colore} opacity={0.12} />
      {segmenti.map((d, i) => <path key={i} d={d} fill="none" stroke={colore} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />)}
    </svg>
  )
}
