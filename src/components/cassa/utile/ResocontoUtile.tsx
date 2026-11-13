'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { cassaChartColor } from '@/components/cassa/chartPalette'
import { Card } from '@/components/cassa/analisi/comuni'
import { eur, eur0, meseNome } from '@/components/cassa/comuni'
import type { Figlio, RigaFumetto } from '@/components/cassa/analisi/Sovrapposizioni'
import { InfoFumetto } from '@/components/cassa/analisi/InfoFumetto'
import { RIFERIMENTI, VOCE_GRUPPO, type ContoEconomico, type Movimento } from '@/lib/utile'
import { caricaUtile, chiaveCompleto, contoMese, type DatiUtile } from './dati'

// Resoconto dell'utile in Analisi: solo i mesi che il manager ha segnato
// come completi in Cassa → Utile, per i locali scelti. Tutto si tocca: un
// mese filtra ripartizione e indicatori, una voce apre il dettaglio delle
// spese che la compongono.

const TZ = 'Europe/Rome'
const MUTO = 'text-muted-foreground'
const C_RICAVI = 'oklch(0.8 0.01 250)'
const C_COSTI = 'oklch(0.72 0.12 75)'
const C_UTILE = 'oklch(0.56 0.1 175)'
const C_PERDITA = 'oklch(0.6 0.15 25)'

const pc = (v: number, base: number) => (base > 0 ? (v / base) * 100 : 0)
const pcT = (v: number, base: number) => (base > 0 ? `${pc(v, base).toFixed(1).replace('.', ',')}%` : '—')
const segnato = (v: number) => `${v < 0 ? '−' : ''}${eur0(v)}`

function mesiTra(a: string, b: string): string[] {
  const out: string[] = []
  let [y, m] = a.slice(0, 7).split('-').map(Number)
  const fine = b.slice(0, 7)
  for (let i = 0; i < 60; i++) {
    const k = `${y}-${String(m).padStart(2, '0')}`
    if (k > fine) break
    out.push(`${k}-01`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}

const SOMMABILI = ['incassi', 'ricavi', 'food', 'beverage', 'merciContanti', 'merci', 'personaleMano', 'personaleContanti', 'personale', 'primeCost', 'materiali', 'contanti', 'costi', 'utile'] as const
function somma(xs: ContoEconomico[]): ContoEconomico {
  const o = { operativi: [] } as unknown as ContoEconomico
  for (const k of SOMMABILI) (o as unknown as Record<string, number>)[k] = xs.reduce((t, x) => t + x[k], 0)
  return o
}

interface Mese { m01: string; locali: string[]; ce: ContoEconomico; mov: Movimento[] }

type ApriFumetto = (titolo: string, sotto: string, righe: RigaFumetto[]) => (e: React.MouseEvent<Element>) => void

export function ResocontoUtile({ ids, a, b, nomi, tel, fumetto }: { ids: string[]; a: string; b: string; nomi: Record<string, { nome: string }>; tel: boolean; fumetto: ApriFumetto }) {
  const meseOggi = formatInTimeZone(new Date(), TZ, 'yyyy-MM')
  // Solo mesi già finiti: quello in corso non può essere completo.
  const mesi = useMemo(() => mesiTra(a, b).filter(m => m.slice(0, 7) < meseOggi), [a, b, meseOggi])
  const [dati, setDati] = useState<DatiUtile | null>(null)
  const req = useRef(0)
  const chiave = ids.join(',')
  const carica = useCallback(async () => {
    const n = ++req.current
    const lista = chiave ? chiave.split(',') : []
    if (!mesi.length || !lista.length) { setDati(null); return }
    const r = await caricaUtile(createClient(), lista, mesi[0], mesi[mesi.length - 1])
    if (n === req.current) setDati(r.errore ? null : r.dati)
  }, [chiave, mesi])
  useEffect(() => { carica() }, [carica])

  const serie: Mese[] = useMemo(() => {
    if (!dati) return []
    return mesi.flatMap(m01 => {
      const locali = ids.filter(id => dati.completi.has(chiaveCompleto(id, m01)))
      if (!locali.length) return []
      const { ce, mov } = contoMese(dati, m01, new Set(locali))
      return [{ m01, locali, ce, mov }]
    })
  }, [dati, mesi, ids])

  const [meseSel, setMeseSel] = useState<string | null>(null)
  const scelti = meseSel ? serie.filter(s => s.m01 === meseSel) : serie
  const tot = useMemo(() => somma(scelti.map(s => s.ce)), [scelti])
  const mov = useMemo(() => scelti.flatMap(s => s.mov.map(m => ({ ...m, mese: s.m01 }))), [scelti])
  const voci = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of mov) m.set(x.voce, (m.get(x.voce) ?? 0) + x.importo)
    return [...m.entries()].filter(([, v]) => v > 0.004).sort((p, q) => q[1] - p[1]).map(([l, v], i) => ({ l, v, c: cassaChartColor(i) }))
  }, [mov])

  // ── Dettaglio: fumetto come nel resto di Analisi ───────────────────
  // Una voce apre le sue sottocategorie (Costo merci → Food, Beverage,
  // Merce pagata in contanti); toccando una sottocategoria si espandono le
  // spese che la compongono, raggruppate per nome.
  const figliDi = (xs: typeof mov): Figlio[] => {
    const g = new Map<string, { descr: string; fonte: string; n: number; v: number; date: string[]; locali: Set<string> }>()
    for (const x of xs) {
      const k = `${x.fonte}|${x.descr.trim().toLowerCase()}`
      const o = g.get(k) ?? { descr: x.descr, fonte: x.fonte, n: 0, v: 0, date: [], locali: new Set<string>() }
      o.n++; o.v += x.importo
      if (x.data && x.fonte !== 'a mano') o.date.push(x.data)
      if (x.li) o.locali.add(x.li)
      g.set(k, o)
    }
    return [...g.values()].sort((p, q) => q.v - p.v).map(r => {
      const date = r.date.sort()
      const quando = r.fonte === 'a mano' ? 'inserita a mano'
        : r.n === 1 && date[0] ? new Date(`${date[0]}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
        : `${r.n} ${r.fonte === 'fattura' ? 'fatture' : 'spese'}`
      const loc = ids.length > 1 && r.locali.size ? ` · ${[...r.locali].map(l => nomi[l]?.nome ?? '').join(', ')}` : ''
      return { l: r.descr, s: `${quando}${loc}`, v: eur(r.v) }
    })
  }
  const righeSotto = (vv: string[]): RigaFumetto[] => {
    const g = new Map<string, typeof mov>()
    for (const x of mov) if (vv.includes(x.voce)) g.set(x.sotto, [...(g.get(x.sotto) ?? []), x])
    return [...g.entries()]
      .map(([l, xs]) => ({ l, xs, v: xs.reduce((t, x) => t + x.importo, 0) }))
      .sort((p, q) => q.v - p.v)
      .map((r, i) => ({ l: r.l, v: eur0(r.v), p: pcT(r.v, tot.ricavi), dot: cassaChartColor(i), figli: figliDi(r.xs) }))
  }
  const apri = (titolo: string, vv: string[]) => {
    const v = mov.filter(x => vv.includes(x.voce)).reduce((t, x) => t + x.importo, 0)
    return fumetto(titolo, `${periodoTesto} · ${eur0(v)} · ${pcT(v, tot.ricavi)} dei ricavi · tocca per le spese`, righeSotto(vv))
  }

  if (!serie.length) return null

  const periodoTesto = meseSel ? `${meseNome(meseSel)} ${meseSel.slice(0, 4)}` : serie.length === 1 ? `${meseNome(serie[0].m01)} ${serie[0].m01.slice(0, 4)}` : `${serie.length} mesi completi`
  const parziali = serie.filter(s => s.locali.length < ids.length)
  const maxBar = Math.max(...serie.map(s => Math.max(s.ce.ricavi, s.ce.costi)), 1)
  const totTutti = somma(serie.map(s => s.ce))

  // Ciambella
  const R = 62, CIRC = 2 * Math.PI * R, totVoci = voci.reduce((t, v) => t + v.v, 0) || 1
  const archi = voci.map((v, i) => ({ ...v, len: (v.v / totVoci) * CIRC, off: voci.slice(0, i).reduce((t, x) => t + (x.v / totVoci) * CIRC, 0) }))

  const indicatori = [
    { l: 'Costo merci', v: tot.merci, rif: RIFERIMENTI.food, voci: [VOCE_GRUPPO.merci],
      info: `Food e beverage delle fatture più la merce pagata in contanti, in percentuale sui ricavi netti. In un ristorante con servizio al tavolo di solito sta fra il ${RIFERIMENTI.food.da} e il ${RIFERIMENTI.food.a}%: sopra, controlla prezzi d'acquisto, sprechi e porzioni.` },
    { l: 'Personale', v: tot.personale, rif: RIFERIMENTI.personale, voci: [VOCE_GRUPPO.personale],
      info: `Buste paga e contributi inseriti a mano più il personale pagato in contanti (extra, lavapiatti, rider), in percentuale sui ricavi netti. Riferimento ${RIFERIMENTI.personale.da}–${RIFERIMENTI.personale.a}%.` },
    { l: 'Prime cost', v: tot.primeCost, rif: RIFERIMENTI.primeCost, voci: [VOCE_GRUPPO.merci, VOCE_GRUPPO.personale],
      info: `Costo merci + personale: le due spese più grandi e quelle su cui si può intervenire. Fra il ${RIFERIMENTI.primeCost.da} e il ${RIFERIMENTI.primeCost.a}% dei ricavi netti resta margine per affitto, utenze e utile; sopra il ${RIFERIMENTI.primeCost.a}% il locale fatica a guadagnare. La fascia verde sulla barra è il riferimento.` },
  ]

  return (
    <Card titolo="Utile" sotto={`${periodoTesto} · solo mesi segnati completi in Cassa → Utile`}
      destra={meseSel ? <button type="button" onClick={() => setMeseSel(null)} className="h-9 rounded-[8px] border border-line-strong px-3 text-[13px] font-semibold active:scale-[0.97]">Tutti i mesi</button> : undefined}>
      {parziali.length > 0 && (
        <span className={cn('-mt-1 text-xs', MUTO)}>
          {parziali.map(s => `${meseNome(s.m01)}: solo ${s.locali.map(l => nomi[l]?.nome ?? '').join(', ')}`).join(' · ')}
        </span>
      )}

      {/* KPI */}
      <div className={cn('grid gap-2.5', tel ? 'grid-cols-2' : 'grid-cols-4')}>
        {[
          { l: 'Ricavi netti', v: eur0(tot.ricavi), s: `${eur0(tot.incassi)} IVA inclusa` },
          { l: 'Costi', v: eur0(tot.costi), s: `${pcT(tot.costi, tot.ricavi)} dei ricavi` },
          { l: 'Utile operativo', v: segnato(tot.utile), s: `margine ${pcT(tot.utile, tot.ricavi)}`, tono: tot.utile < 0 ? 'text-neg' : 'text-ok' },
          { l: 'Prime cost', v: pcT(tot.primeCost, tot.ricavi), s: `rif. ${RIFERIMENTI.primeCost.da}–${RIFERIMENTI.primeCost.a}%` },
        ].map(k => (
          <div key={k.l} className="flex flex-col gap-0.5 rounded-[10px] bg-[oklch(0.965_0.006_250)] px-3.5 py-3 dark:bg-secondary/60">
            <span className={cn('text-[10px] font-semibold uppercase tracking-[.06em]', MUTO)}>{k.l}</span>
            <span className={cn('font-mono text-[19px] font-semibold tabular-nums', k.tono)}>{k.v}</span>
            <span className={cn('text-xs', MUTO)}>{k.s}</span>
          </div>
        ))}
      </div>

      <div className={cn('grid gap-4', !tel && 'lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]')}>
        {/* Andamento mensile */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs font-medium">
            <span className="text-[13px] font-semibold">Andamento mensile</span>
            <span className={MUTO}>tocca un mese</span>
            <span className="flex-1" />
            {[['Ricavi netti', C_RICAVI], ['Costi', C_COSTI], ['Utile', C_UTILE]].map(([l, c]) => (
              <span key={l} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />{l}</span>
            ))}
          </div>
          <div className="flex h-[190px] items-end gap-2 overflow-x-auto pb-1">
            {serie.map(s => {
              const on = meseSel === s.m01, spento = meseSel && !on
              const h = (v: number) => `${Math.max(2, (Math.abs(v) / maxBar) * 140)}px`
              return (
                <button key={s.m01} type="button" onClick={() => setMeseSel(on ? null : s.m01)} aria-pressed={on}
                  className={cn('flex min-w-[64px] flex-1 flex-col items-center gap-1.5 rounded-[8px] px-1 pt-1 transition-opacity active:scale-[0.98]', on && 'bg-[oklch(0.95_0.02_180)] dark:bg-secondary', spento && 'opacity-40')}>
                  <span className={cn('font-mono text-[11px] font-semibold tabular-nums', s.ce.utile < 0 ? 'text-neg' : 'text-ok')}>{pcT(s.ce.utile, s.ce.ricavi)}</span>
                  <span className="flex items-end gap-[3px]">
                    <span className="w-3 rounded-t-[3px]" style={{ height: h(s.ce.ricavi), background: C_RICAVI }} />
                    <span className="w-3 rounded-t-[3px]" style={{ height: h(s.ce.costi), background: C_COSTI }} />
                    <span className="w-3 rounded-t-[3px]" style={{ height: h(s.ce.utile), background: s.ce.utile < 0 ? C_PERDITA : C_UTILE }} />
                  </span>
                  <span className="text-[11px] font-medium">{meseNome(s.m01).slice(0, 3)} {s.m01.slice(2, 4)}</span>
                </button>
              )
            })}
          </div>
          {serie.length > 1 && !meseSel && (
            <span className={cn('text-xs', MUTO)}>Totale: utile {segnato(totTutti.utile)} su {eur0(totTutti.ricavi)} di ricavi netti</span>
          )}

          {/* Indicatori */}
          <div className="mt-2 flex flex-col gap-1">
            <span className="text-[13px] font-semibold">Indicatori</span>
            {indicatori.map(x => {
              const p = pc(x.v, tot.ricavi), scala = 80
              const fuori = p > x.rif.a
              return (
                <button key={x.l} type="button" onClick={apri(x.l, x.voci)} className="flex flex-col gap-1 rounded-[8px] py-1.5 text-left active:bg-secondary/60">
                  <span className="flex items-baseline gap-2 text-[13px]">
                    <span className="flex flex-1 items-center gap-1 font-medium">{x.l}<InfoFumetto titolo={x.l} testo={x.info} /></span>
                    <span className={cn('text-xs', MUTO)}>rif. {x.rif.da}–{x.rif.a}%</span>
                    <span className={cn('w-14 text-right font-mono font-semibold tabular-nums', fuori ? 'text-neg' : 'text-foreground')}>{pcT(x.v, tot.ricavi)}</span>
                  </span>
                  <span className="relative h-2.5 overflow-hidden rounded-full bg-[oklch(0.93_0.01_250)] dark:bg-secondary">
                    <span className="absolute inset-y-0 bg-[oklch(0.85_0.06_150)] dark:bg-[oklch(0.4_0.06_150)]" style={{ left: `${(x.rif.da / scala) * 100}%`, width: `${((x.rif.a - x.rif.da) / scala) * 100}%` }} />
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (p / scala) * 100)}%`, background: fuori ? C_PERDITA : C_UTILE, opacity: 0.85 }} />
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Ripartizione costi */}
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-[13px] font-semibold">Ripartizione costi <span className={cn('font-normal', MUTO)}>· tocca una voce</span></span>
          <div className={cn('flex gap-4', tel ? 'flex-col items-center' : 'items-start')}>
            <svg width="150" height="150" viewBox="0 0 150 150" className="flex-none" role="img" aria-label="Ripartizione dei costi">
              <circle cx="75" cy="75" r={R} fill="none" stroke="var(--border)" strokeWidth="18" />
              {archi.map(v => (
                <circle key={v.l} cx="75" cy="75" r={R} fill="none" stroke={v.c} strokeWidth="18"
                  strokeDasharray={`${Math.max(0, v.len - 1.5)} ${CIRC}`} strokeDashoffset={-v.off} transform="rotate(-90 75 75)"
                  className="cursor-pointer" onClick={apri(v.l, [v.l])} />
              ))}
              <text x="75" y="72" textAnchor="middle" className="fill-muted-foreground text-[10px] font-semibold uppercase tracking-[.06em]">Costi</text>
              <text x="75" y="90" textAnchor="middle" className="fill-foreground font-mono text-[14px] font-semibold">{eur0(tot.costi)}</text>
            </svg>
            <div className="flex w-full min-w-0 flex-col">
              {voci.map(v => (
                <button key={v.l} type="button" onClick={apri(v.l, [v.l])} className="flex items-center gap-2.5 rounded-[6px] px-1 py-1.5 text-left active:bg-secondary/60">
                  <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: v.c }} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{v.l}</span>
                  <span className={cn('font-mono text-[11px] tabular-nums', MUTO)}>{pcT(v.v, tot.ricavi)}</span>
                  <span className="w-[84px] text-right font-mono text-[13px] tabular-nums">{eur0(v.v)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

    </Card>
  )
}
