'use client'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { delta, type Tono } from '@/lib/analisi'
import { Card } from '@/components/cassa/analisi/comuni'
import { InfoFumetto } from '@/components/cassa/analisi/InfoFumetto'
import type { Figlio, RigaFumetto } from '@/components/cassa/analisi/Sovrapposizioni'
import { eur, eur0, meseNome } from '@/components/cassa/comuni'
import { RIFERIMENTI, VOCE_GRUPPO, type Movimento } from '@/lib/utile'
import { somma, useSerieUtile, type MeseUtile } from './serie'
import type { ApriFumetto } from './ResocontoUtile'

// Utile nel confronto di Analisi: A contro B (due periodi o due locali),
// solo con i mesi segnati completi in Cassa → Utile da ciascuna parte.
// Le voci si toccano: il fumetto mostra le sottocategorie con A e B, e
// toccandone una le spese di A e di B.

const MUTO = 'text-muted-foreground'
const C_A = 'oklch(0.58 0.12 180)'
const C_B = 'oklch(0.76 0.012 250)'
const PILL: Record<Tono, string> = { ok: 'bg-ok-tint text-ok', neg: 'bg-neg-tint text-neg', neutro: 'bg-[oklch(0.94_0.01_250)] text-muted-foreground dark:bg-secondary' }

const pc = (v: number, base: number) => (base > 0 ? (v / base) * 100 : 0)
const pcT = (v: number, base: number) => (base > 0 ? `${pc(v, base).toFixed(1).replace('.', ',')}%` : '—')
const segnato = (v: number) => `${v < 0 ? '−' : ''}${eur0(v)}`
/** Differenza in punti percentuali: per i costi scendere è buono. */
const dpt = (a: number, b: number): { testo: string; tono: Tono } => {
  const d = a - b
  return { testo: `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1).replace('.', ',')} pt`, tono: Math.abs(d) < 0.05 ? 'neutro' : d < 0 ? 'ok' : 'neg' }
}

function Lettera({ l }: { l: 'A' | 'B' }) {
  return <span className={cn('inline-flex h-4 w-4 flex-none items-center justify-center rounded-[4px] text-[9px] font-semibold', l === 'A' ? 'bg-[oklch(0.58_0.12_180)] text-white' : 'bg-[oklch(0.76_0.012_250)] text-[oklch(0.25_0.01_250)] dark:bg-[oklch(0.46_0.012_250)] dark:text-[oklch(0.95_0.01_250)]')}>{l}</span>
}
function Pillola({ d }: { d: { testo: string; tono: Tono } }) {
  return <span className={cn('inline-flex h-[22px] flex-none items-center whitespace-nowrap rounded-full px-2 font-mono text-[11.5px] font-semibold', PILL[d.tono])}>{d.testo}</span>
}

const periodo = (s: MeseUtile[]) => (s.length === 0 ? 'nessun mese completo' : s.length === 1 ? `${meseNome(s[0].m01)} ${s[0].m01.slice(0, 4)}` : `${s.length} mesi completi`)

export function ConfrontoUtile({ idsA, idsB, A, B, et, nomi, tel, fumetto }: {
  idsA: string[]; idsB: string[]; A: { a: string; b: string }; B: { a: string; b: string }
  et: { a: string; b: string }; nomi: Record<string, { nome: string }>; tel: boolean; fumetto: ApriFumetto
}) {
  const sa = useSerieUtile(idsA, A.a, A.b)
  const sb = useSerieUtile(idsB, B.a, B.b)
  const ta = useMemo(() => somma(sa.serie.map(s => s.ce)), [sa.serie])
  const tb = useMemo(() => somma(sb.serie.map(s => s.ce)), [sb.serie])
  const movA = useMemo(() => sa.serie.flatMap(s => s.mov), [sa.serie])
  const movB = useMemo(() => sb.serie.flatMap(s => s.mov), [sb.serie])
  const voci = useMemo(() => {
    const m = new Map<string, { a: number; b: number }>()
    for (const x of movA) { const o = m.get(x.voce) ?? { a: 0, b: 0 }; o.a += x.importo; m.set(x.voce, o) }
    for (const x of movB) { const o = m.get(x.voce) ?? { a: 0, b: 0 }; o.b += x.importo; m.set(x.voce, o) }
    return [...m.entries()].filter(([, v]) => v.a > 0.004 || v.b > 0.004).sort((p, q) => Math.max(q[1].a, q[1].b) - Math.max(p[1].a, p[1].b)).map(([l, v]) => ({ l, ...v }))
  }, [movA, movB])

  if (!sa.pronto || !sb.pronto || (!sa.serie.length && !sb.serie.length)) return null

  // ── Fumetto di una voce: sottocategorie con A e B, poi le spese ─────
  const multi = idsA.length + idsB.length > 2
  const figli = (xs: Movimento[], l: 'A' | 'B'): Figlio[] => {
    const g = new Map<string, { descr: string; n: number; v: number; li: Set<string> }>()
    for (const x of xs) {
      const k = `${x.fonte}|${x.descr.trim().toLowerCase()}`
      const o = g.get(k) ?? { descr: x.descr, n: 0, v: 0, li: new Set<string>() }
      o.n++; o.v += x.importo
      if (x.li) o.li.add(x.li)
      g.set(k, o)
    }
    return [...g.values()].sort((p, q) => q.v - p.v).map(r => ({
      l: `${l} · ${r.descr}`,
      s: `${r.n} ${r.n === 1 ? 'voce' : 'voci'}${multi && r.li.size ? ` · ${[...r.li].map(x => nomi[x]?.nome ?? '').join(', ')}` : ''}`,
      v: eur(r.v),
    }))
  }
  const apri = (titolo: string, vv: string[]) => {
    const xa = movA.filter(x => vv.includes(x.voce)), xb = movB.filter(x => vv.includes(x.voce))
    const sotto = [...new Set([...xa, ...xb].map(x => x.sotto))]
    const righe: RigaFumetto[] = sotto.map(s => {
      const ra = xa.filter(x => x.sotto === s), rb = xb.filter(x => x.sotto === s)
      const va = ra.reduce((t, x) => t + x.importo, 0), vb = rb.reduce((t, x) => t + x.importo, 0)
      return { l: s, v: eur0(va), p: `B ${eur0(vb)}`, dot: C_A, figli: [...figli(ra, 'A'), ...figli(rb, 'B')], _o: Math.max(va, vb) }
    }).sort((p, q) => q._o - p._o).map(({ _o, ...r }) => { void _o; return r })
    const va = xa.reduce((t, x) => t + x.importo, 0), vb = xb.reduce((t, x) => t + x.importo, 0)
    return fumetto(titolo, `${et.a} ${eur0(va)} · ${et.b} ${eur0(vb)} · tocca per le spese`, righe)
  }

  const kpi = [
    { l: 'Ricavi netti', a: eur0(ta.ricavi), b: eur0(tb.ricavi), d: delta(ta.ricavi, tb.ricavi, 'su') },
    { l: 'Costi', a: eur0(ta.costi), b: eur0(tb.costi), d: delta(ta.costi, tb.costi, 'giu') },
    { l: 'Utile operativo', a: segnato(ta.utile), b: segnato(tb.utile), d: delta(ta.utile, tb.utile, 'su'), ta: ta.utile < 0 ? 'text-neg' : 'text-ok' },
    { l: 'Margine', a: pcT(ta.utile, ta.ricavi), b: pcT(tb.utile, tb.ricavi), d: dpt(-pc(ta.utile, ta.ricavi), -pc(tb.utile, tb.ricavi)) },
  ]
  const indicatori = [
    { l: 'Costo merci', a: ta.merci, b: tb.merci, rif: RIFERIMENTI.food, voci: [VOCE_GRUPPO.merci], info: 'Food e beverage delle fatture più la merce pagata in contanti, in percentuale sui ricavi netti di A e di B.' },
    { l: 'Personale', a: ta.personale, b: tb.personale, rif: RIFERIMENTI.personale, voci: [VOCE_GRUPPO.personale], info: 'Buste paga e contributi inseriti a mano più il personale pagato in contanti, in percentuale sui ricavi netti di A e di B.' },
    { l: 'Prime cost', a: ta.primeCost, b: tb.primeCost, rif: RIFERIMENTI.primeCost, voci: [VOCE_GRUPPO.merci, VOCE_GRUPPO.personale], info: 'Costo merci + personale sui ricavi netti. Il verde nella pillola vuol dire che A pesa meno di B.' },
  ]
  const maxV = Math.max(...voci.map(v => Math.max(v.a, v.b)), 1)
  const COLS = tel ? 'minmax(0,1fr) 92px 62px' : 'minmax(0,180px) minmax(0,1fr) 110px 74px'

  return (
    <Card titolo="Utile" sotto={`${et.a}: ${periodo(sa.serie)} · ${et.b}: ${periodo(sb.serie)} · solo mesi segnati completi in Cassa → Utile`}
      destra={<span className="flex items-center gap-3.5 text-[12px] font-medium text-muted-foreground"><span className="flex items-center gap-1.5"><Lettera l="A" />{et.a}</span><span className="flex items-center gap-1.5"><Lettera l="B" />{et.b}</span></span>}>
      {(!sa.serie.length || !sb.serie.length) && (
        <span className="rounded-[10px] bg-warn-tint px-3.5 py-2.5 text-[13px] text-warn">
          {!sa.serie.length ? et.a : et.b} non ha mesi segnati completi in questo periodo: i suoi valori restano a zero finché non li spunti in Cassa → Utile.
        </span>
      )}

      <div className={cn('grid gap-2.5', tel ? 'grid-cols-2' : 'grid-cols-4')}>
        {kpi.map(k => (
          <div key={k.l} className="flex flex-col gap-1 rounded-[10px] bg-[oklch(0.965_0.006_250)] px-3.5 py-3 dark:bg-secondary/60">
            <span className="flex items-center gap-2">
              <span className={cn('flex-1 text-[10px] font-semibold uppercase tracking-[.06em]', MUTO)}>{k.l}</span>
              <Pillola d={k.d} />
            </span>
            <span className="flex items-center gap-2"><Lettera l="A" /><span className={cn('font-mono text-[18px] font-semibold tabular-nums', k.ta)}>{k.a}</span></span>
            <span className="flex items-center gap-2"><Lettera l="B" /><span className={cn('font-mono text-[14px] font-medium tabular-nums', MUTO)}>{k.b}</span></span>
          </div>
        ))}
      </div>

      <div className={cn('grid gap-5', !tel && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]')}>
        {/* Indicatori A/B */}
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold">Indicatori</span>
          {indicatori.map(x => {
            const pa = pc(x.a, ta.ricavi), pb = pc(x.b, tb.ricavi), scala = 80
            return (
              <button key={x.l} type="button" onClick={apri(x.l, x.voci)} className="flex flex-col gap-1 rounded-[8px] py-1.5 text-left active:bg-secondary/60">
                <span className="flex items-center gap-2 text-[13px]">
                  <span className="flex flex-1 items-center gap-1 font-medium">{x.l}<InfoFumetto titolo={x.l} testo={`${x.info} Riferimento ${x.rif.da}–${x.rif.a}%.`} /></span>
                  <span className="font-mono font-semibold tabular-nums">{pcT(x.a, ta.ricavi)}</span>
                  <span className={cn('w-12 text-right font-mono text-xs tabular-nums', MUTO)}>{pcT(x.b, tb.ricavi)}</span>
                  <Pillola d={dpt(pa, pb)} />
                </span>
                {[{ p: pa, c: C_A }, { p: pb, c: C_B }].map((r, i) => (
                  <span key={i} className="relative h-2 overflow-hidden rounded-full bg-[oklch(0.93_0.01_250)] dark:bg-secondary">
                    <span className="absolute inset-y-0 bg-[oklch(0.85_0.06_150)] dark:bg-[oklch(0.4_0.06_150)]" style={{ left: `${(x.rif.da / scala) * 100}%`, width: `${((x.rif.a - x.rif.da) / scala) * 100}%` }} />
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (r.p / scala) * 100)}%`, background: r.c }} />
                  </span>
                ))}
              </button>
            )
          })}
        </div>

        {/* Voci di costo A/B */}
        <div className="flex min-w-0 flex-col">
          <span className="pb-1 text-[13px] font-semibold">Costi per voce <span className={cn('font-normal', MUTO)}>· tocca una voce</span></span>
          {voci.map(v => (
            <button key={v.l} type="button" onClick={apri(v.l, [v.l])}
              className="-mx-2 grid min-h-[48px] items-center gap-3 rounded-[8px] border-t border-border px-2 text-left active:bg-secondary/60" style={{ gridTemplateColumns: COLS }}>
              <span className="min-w-0 text-[13.5px] font-medium leading-[1.25] [overflow-wrap:anywhere]">{v.l.replace(/\//g, '/​')}</span>
              {!tel && (
                <span className="flex min-w-0 flex-col gap-[3px]">
                  <span className="h-2 rounded-[4px] bg-[oklch(0.95_0.01_250)] dark:bg-secondary"><span className="block h-full rounded-[4px]" style={{ width: `${(v.a / maxV) * 100}%`, background: C_A }} /></span>
                  <span className="h-2 rounded-[4px] bg-[oklch(0.95_0.01_250)] dark:bg-secondary"><span className="block h-full rounded-[4px]" style={{ width: `${(v.b / maxV) * 100}%`, background: C_B }} /></span>
                </span>
              )}
              <span className="flex flex-col items-end gap-px">
                <span className="whitespace-nowrap font-mono text-[13px] font-medium tabular-nums">{eur0(v.a)}</span>
                <span className={cn('whitespace-nowrap font-mono text-[11.5px] tabular-nums', MUTO)}>{eur0(v.b)}</span>
              </span>
              <span className="justify-self-end"><Pillola d={dpt(pc(v.a, ta.ricavi), pc(v.b, tb.ricavi))} /></span>
            </button>
          ))}
          <span className={cn('pt-2 text-xs', MUTO)}>La pillola confronta il peso sui ricavi netti: verde se in A la voce pesa meno.</span>
        </div>
      </div>
    </Card>
  )
}
