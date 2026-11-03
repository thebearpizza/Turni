'use client'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import {
  giornoSett, mediaScontrino, eu, fN, dV, sgn, pc, k1, fdg, variazione, inBucket, WD,
  SOGLIA_DIFFERENZA, MIN_GIORNI_ALERT,
} from '@/lib/analisi'
import { KpiCard, GraficoEntrate } from '@/components/cassa/analisi/Grafici'
import { ORD, COLORI_PAG, COLORI_FAT, TEAL, etichetteSerie } from '@/components/cassa/analisi/comuni'
import type { Ctx } from '@/components/cassa/analisi/tipi'

// Vista normale di Analisi (design Manager Analisi, senza confronto):
// riproduce il template del prototipo sezione per sezione, con le stesse
// misure, gli stessi ritardi di comparsa e gli stessi tocchi.

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)

const CARD = 'anim-swapin flex min-w-0 flex-col rounded-[12px] border border-border bg-card'
const tocco = 'cursor-pointer active:scale-[0.98]'
const sfioro = 'hover:bg-[oklch(0.975_0.01_250)] dark:hover:bg-secondary/60'
const MUTO = 'text-muted-foreground'

function Titolo({ t, s, children }: { t: React.ReactNode; s?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className="text-[17px] font-semibold">{t}</span>
      {s && <span className={cn('text-[13px]', MUTO)}>{s}</span>}
      {children}
    </div>
  )
}

const ritardo = (ms: number) => ({ animationDelay: `${ms}ms` })

export function VistaNormale({ c }: { c: Ctx }) {
  const { v, MET, tel } = c
  const et = etichetteSerie(c)
  const giorniOrd = useMemo(() => {
    const g = new Map<string, number>()
    for (const r of v.rows) g.set(r.data, (g.get(r.data) ?? 0) + r.ent)
    return [...g.entries()].sort((p, q) => q[1] - p[1])
  }, [v.rows])
  const sottoGiorno = (d: string) => {
    const rs = v.rows.filter(r => r.data === d).sort((p, q) => q.ent - p.ent)
    return v.locSel.length > 1 ? `traina ${c.nomeLoc[rs[0].li]?.nome ?? ''}` : `${fN(rs[0].cop)} coperti`
  }
  const tot = v.X.ent
  const nGiorni = new Set(v.rows.map(r => r.data)).size || 1
  const maxEnt = Math.max(...v.sedi.map(s => s.x.ent), 1)
  const fT = c.gv(c.FA, 'tot')

  // Mappa per giorno della settimana: media per locale, scala teal min → max.
  const heat = v.locSel.map(l => ({ l, m: ORD.map(w => { const rs = v.rows.filter(r => r.li === l.id && giornoSett(r.data) === w); return rs.length ? sum(rs, r => r.ent) / rs.length : null }) }))
  const tutte = heat.flatMap(h => h.m).filter((x): x is number => x !== null), hmx = Math.max(...tutte), hmn = Math.min(...tutte)
  const alerts = v.sedi.map(s => ({ s, rs: s.rs.filter(r => Math.abs(r.dif) >= SOGLIA_DIFFERENZA) })).filter(x => x.rs.length >= MIN_GIORNI_ALERT)

  const cats = v.categorie.map(k => ({ ...k, t: sum(c.dati.spA.filter(x => x.categoria === k.c), x => x.importo) })).filter(k => k.t > 0)
  const totSp = sum(cats, k => k.t)
  const CIRC = 2 * Math.PI * 66
  const vendite = useMemo(() => { const m = new Map<string, number>(); for (const x of c.dati.veA) m.set(x.categoria, (m.get(x.categoria) ?? 0) + x.importo); return [...m.entries()].sort((p, q) => q[1] - p[1]) }, [c.dati.veA])
  const totVe = sum(vendite, x => x[1])
  const sedi = [...v.sedi].sort((p, q) => q.x.ent - p.x.ent)
  const COLS_SEDI = '170px 56px 130px 104px 104px 96px 96px 80px 110px 104px 104px 110px 120px 104px'

  return (
    <div className="flex flex-col gap-4">
      {/* KPI */}
      <div className={cn('grid gap-3', tel ? 'grid-cols-2' : 'grid-cols-3 lg:grid-cols-6')}>
        {MET.map((m, i) => {
          const val = m.f(v.rows), pr = m.f(v.prev)
          return (
            <KpiCard key={m.l} l={m.l} v={m.fmt(val)} ritardo={i * 50}
              tonoValore={i === 2 && val < 0 ? 'neg' : i === 3 ? (Math.abs(val) < 0.005 ? 'ok' : 'neg') : undefined}
              varz={v.prev.length ? variazione(val, pr, m.buono, m.ass) : null} vs={tel ? 'vs prima' : 'vs periodo prima'}
              serie={v.bySer(v.rows, v.bk, m.f)} colore={m.col} etichette={et} fmt={m.fmt}
              onApri={() => c.apri({ k: 'kpi', i })} />
          )
        })}
      </div>

      <div className={cn('grid gap-4', !tel && 'lg:grid-cols-[minmax(0,1fr)_360px]')}>
        {/* Andamento entrate */}
        <div className={cn(CARD, 'gap-2.5 px-5 pb-3.5 pt-[18px]')} style={ritardo(180)}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-[17px] font-semibold">Andamento entrate</span>
            <span className={cn('text-[13px]', MUTO)}>{v.mensile ? 'per mese' : 'per giorno · tocca un giorno'}</span>
            <span className="flex-1" />
            <div className={cn('flex flex-wrap items-center gap-x-3.5 gap-y-1.5', tel && 'basis-full')}>
              {v.locSel.map(l => (
                <span key={l.id} className="flex items-center gap-1.5 text-xs font-medium text-[oklch(0.35_0.01_250)] dark:text-foreground/80">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: l.tenue }} />{l.nome}
                </span>
              ))}
            </div>
          </div>
          <GraficoEntrate tel={tel} asse={v.bk.map(k => k.asse)} etichette={et} locali={v.locSel}
            ser={v.bk.map((k, j) => v.locSel.map(l => { const q = v.presenti.findIndex(p => p.id === l.id); return q < 0 ? 0 : v.ser[j][q] }))}
            serB={null} etichetteB={[]} conDati={v.bk.map(k => v.rows.some(r => inBucket(r.data, k)))}
            onApri={j => c.apri(v.mensile ? { k: 'month', j } : { k: 'day', d: v.bk[j].a })} />
        </div>

        <div className="flex flex-col gap-4">
          {giorniOrd.length > 0 && (
            <div className="anim-swapin grid grid-cols-2 gap-3" style={ritardo(240)}>
              {[{ d: giorniOrd[0], h: 'Giorno migliore', ok: true }, { d: giorniOrd[giorniOrd.length - 1], h: 'Giorno peggiore', ok: false }].map(x => (
                <button key={x.h} type="button" onClick={() => c.apri({ k: 'day', d: x.d[0] })}
                  className={cn('flex flex-col gap-1 rounded-[12px] px-4 py-3.5 text-left', tocco,
                    x.ok ? 'bg-[oklch(0.95_0.03_150)] dark:bg-ok-tint' : 'bg-[oklch(0.96_0.02_25)] dark:bg-neg-tint')}>
                  <span className={cn('text-[10px] font-semibold uppercase tracking-[.06em]', x.ok ? 'text-[oklch(0.4_0.08_150)] dark:text-ok' : 'text-[oklch(0.45_0.1_25)] dark:text-neg')}>{x.h}</span>
                  <span className="text-[15px] font-semibold">{fdg(x.d[0])}</span>
                  <span className={cn('font-mono text-[18px] font-semibold', x.ok ? 'text-[oklch(0.4_0.08_150)] dark:text-ok' : 'text-[oklch(0.45_0.1_25)] dark:text-neg')}>{eu(x.d[1], 0)}</span>
                  <span className={cn('text-xs', MUTO)}>{sottoGiorno(x.d[0])}</span>
                </button>
              ))}
            </div>
          )}
          {/* Pagamenti */}
          <div className={cn(CARD, 'flex-1 gap-3.5 px-5 py-[18px]')} style={ritardo(300)}>
            <span className="text-[17px] font-semibold">Pagamenti</span>
            <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-[7px]">
              {(['pos', 'con', 'bon'] as const).map(k => <div key={k} className="transition-[width] duration-[600ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]" style={{ width: `${tot ? (v.X[k] / tot) * 100 : 0}%`, background: COLORI_PAG[k] }} />)}
            </div>
            {([['POS', 'pos'], ['Contanti', 'con'], ['Bonifico', 'bon']] as const).map(([l, k]) => (
              <button key={k} type="button" onClick={c.fumPagamento(l, k)} className={cn('-mx-2 -my-1 grid min-h-9 grid-cols-[12px_1fr_auto_48px] items-center gap-2.5 rounded-[8px] px-2 text-left', tocco, sfioro)}>
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: COLORI_PAG[k] }} />
                <span className="text-sm font-medium">{l}</span>
                <span className="font-mono text-sm font-medium">{eu(v.X[k], 0)}</span>
                <span className={cn('text-right font-mono text-xs font-medium', MUTO)}>{pc(v.X[k], tot)}</span>
              </button>
            ))}
            <div className="mt-auto grid grid-cols-2 gap-2 border-t border-[oklch(0.93_0.01_250)] pt-3 dark:border-border">
              <button type="button" onClick={c.fumAsporto} className={cn('-mx-2 -my-1.5 flex flex-col gap-0.5 rounded-[8px] px-2 py-1.5 text-left', tocco, sfioro)}>
                <span className={cn('text-xs', MUTO)}>di cui asporto</span><span className="font-mono text-[15px] font-medium">{eu(v.X.asp, 0)}</span>
              </button>
              <button type="button" onClick={c.fumCoperti} className={cn('-mx-2 -my-1.5 flex flex-col gap-0.5 rounded-[8px] px-2 py-1.5 text-left', tocco, sfioro)}>
                <span className={cn('text-xs', MUTO)}>Coperti medi / giorno</span><span className="font-mono text-[15px] font-medium">{fN(v.X.cop / nGiorni)}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Acquisti da fatture */}
      <div className={cn(CARD, 'gap-3.5 px-5 py-[18px]')} style={ritardo(330)}>
        <Titolo t="Acquisti da fatture" s="fatture fornitori caricate · incidenza sul totale entrate" />
        {fT <= 0 ? <p className={cn('text-sm', MUTO)}>Nessuna fattura con articoli caricata nel periodo.</p> : (
          <div className={cn('grid items-stretch gap-5', !tel && 'lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]')}>
            <div className="flex flex-col gap-3">
              <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-[7px]">
                {(['fo', 'be', 'nf'] as const).map(k => <div key={k} className="transition-[width] duration-[600ms]" style={{ width: `${(c.gv(c.FA, k) / fT) * 100}%`, background: COLORI_FAT[k] }} />)}
              </div>
              <div className={cn('grid gap-2', tel ? 'grid-cols-2' : 'grid-cols-4')}>
                {([['Totale fatture', 'tot'], ['Food', 'fo'], ['Beverage', 'be'], ['No food', 'nf']] as const).map(([l, k]) => (
                  <button key={k} type="button" onClick={c.fumFattura(l, k)}
                    className={cn('flex flex-col gap-1 rounded-[10px] px-3.5 py-3 text-left hover:brightness-[0.985]', tocco, k === 'tot' ? 'bg-[oklch(0.965_0.01_250)] dark:bg-secondary' : 'bg-background')}>
                    <span className={cn('flex items-center gap-1.5 text-xs font-medium', MUTO)}>{k !== 'tot' && <span className="h-2 w-2 rounded-[2px]" style={{ background: COLORI_FAT[k] }} />}{l}</span>
                    <span className="whitespace-nowrap font-mono text-[18px] font-semibold tracking-[-.01em]">{eu(c.gv(c.FA, k), 0)}</span>
                    <span className={cn('text-[11px]', MUTO)}>{k === 'tot' ? `${pc(fT, tot)} delle entrate` : `${pc(c.gv(c.FA, k), fT)} degli acquisti`}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([['Food cost', 'fo', COLORI_FAT.fo], [tel ? 'Bev. cost' : 'Beverage cost', 'be', COLORI_FAT.be], [tel ? 'F&B cost' : 'Food & beverage cost', 'fb', 'var(--foreground)']] as const).map(([l, k, col]) => {
                const cv = tot ? (c.gv(c.FA, k) / tot) * 100 : 0, pv = v.P.ent ? (c.gv(c.FB, k) / v.P.ent) * 100 : null
                const dpt = pv === null ? null : cv - pv
                return (
                  <button key={k} type="button" onClick={c.fumIncidenza(l, k)} className={cn('flex flex-col gap-2 rounded-[10px] border border-border px-3.5 py-3 text-left', tocco, sfioro)}>
                    <span className={cn('text-xs font-medium', MUTO)}>{l}</span>
                    <span className="font-mono text-[24px] font-semibold tracking-[-.02em]">{pc(c.gv(c.FA, k), tot)}</span>
                    <div className="relative h-1.5 rounded-[3px] bg-[oklch(0.94_0.01_250)] dark:bg-secondary"><div className="absolute inset-y-0 left-0 rounded-[3px] transition-[width] duration-[600ms]" style={{ width: `${Math.min(100, (cv / 50) * 100)}%`, background: col }} /></div>
                    {dpt !== null && (
                      <span className={cn('flex items-center gap-[3px] self-start rounded-full px-[7px] py-0.5 font-mono text-[11px] font-semibold', dpt >= 0 ? 'bg-[oklch(0.94_0.04_25)] text-[oklch(0.45_0.1_25)] dark:bg-neg-tint dark:text-neg' : 'bg-[oklch(0.94_0.04_150)] text-[oklch(0.4_0.08_150)] dark:bg-ok-tint dark:text-ok')}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${dpt >= 0 ? 0 : 180}deg)` }} aria-hidden><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></svg>
                        {Math.abs(dpt).toFixed(1).replace('.', ',')} pt
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Confronto per ristorante */}
      <div className={cn(CARD, 'overflow-hidden')} style={ritardo(360)}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 pb-3 pt-[18px]">
          <span className="text-[17px] font-semibold">Confronto per ristorante</span>
          <span className={cn('text-[13px]', MUTO)}>tocca una riga per il dettaglio</span>
        </div>
        <div className="overflow-x-auto overscroll-x-contain">
          <div className="box-border grid w-max min-w-full gap-x-3 border-t border-[oklch(0.93_0.01_250)] bg-[oklch(0.97_0.01_250)] px-5 py-2.5 text-xs font-medium text-muted-foreground dark:border-border dark:bg-background" style={{ gridTemplateColumns: COLS_SEDI }}>
            <span className="sticky left-0 z-[1] -ml-5 bg-[oklch(0.97_0.01_250)] pl-5 dark:bg-background">Ristorante</span>
            {['Giorni', 'Totale entrate', 'Contanti', 'POS', 'Bonifico', 'Asporto', 'Coperti', 'Media / giorno', 'Totale spese', 'Spese / giorno', 'Media scontrino', 'Margine operativo', 'Differenza'].map(h => <span key={h} className="text-right">{h}</span>)}
          </div>
          {sedi.map(s => {
            const att = c.sel.length === 1 && c.sel[0] === s.l.id
            const mo = s.x.ent - s.x.sp, pari = Math.abs(s.x.dif) < 0.005
            const sfondo = att ? 'bg-[oklch(0.96_0.02_180)] dark:bg-[oklch(0.25_0.03_180)]' : 'bg-card'
            return (
              <div key={s.l.id} role="button" tabIndex={0} onClick={() => c.apri({ k: 'loc', li: s.l.id })} onKeyDown={e => { if (e.key === 'Enter') c.apri({ k: 'loc', li: s.l.id }) }}
                className={cn('box-border grid min-h-14 w-max min-w-full cursor-pointer items-center gap-x-3 border-t border-[oklch(0.93_0.01_250)] px-5 font-mono text-sm font-medium active:scale-[0.995] dark:border-border', att ? sfondo : 'hover:bg-[oklch(0.975_0.01_250)] dark:hover:bg-secondary/60')}
                style={{ gridTemplateColumns: COLS_SEDI }}>
                <span className={cn('sticky left-0 z-[1] -ml-5 flex items-center gap-2.5 self-stretch pl-5 font-sans text-sm font-semibold', sfondo)}>
                  <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: s.l.colore }} /><span className="truncate">{s.l.nome}</span>
                </span>
                <span className="text-right">{s.rs.length}</span>
                <span className="flex flex-col items-end gap-1">{eu(s.x.ent, 0)}
                  <span className="flex h-1 w-full justify-end overflow-hidden rounded-[2px] bg-[oklch(0.93_0.01_250)] dark:bg-secondary"><span className="rounded-[2px]" style={{ width: `${(s.x.ent / maxEnt) * 100}%`, background: s.l.colore }} /></span>
                </span>
                <span className="text-right">{eu(s.x.con, 0)}</span>
                <span className="text-right">{eu(s.x.pos, 0)}</span>
                <span className="text-right">{eu(s.x.bon, 0)}</span>
                <span className="text-right">{eu(s.x.asp, 0)}</span>
                <span className="text-right">{fN(s.x.cop)}</span>
                <span className="text-right">{eu(s.x.ent / (s.rs.length || 1), 0)}</span>
                <span className="text-right">{eu(s.x.sp)}</span>
                <span className="text-right">{eu(s.x.sp / (s.rs.length || 1))}</span>
                <span className="text-right">{s.x.cop ? eu(mediaScontrino(s.x)) : '—'}</span>
                <span className={cn('text-right', mo >= 0 ? 'text-[oklch(0.4_0.08_150)] dark:text-ok' : 'text-[oklch(0.45_0.1_25)] dark:text-neg')}>{eu(mo, 0)}</span>
                <span className={cn('text-right', pari ? 'text-[oklch(0.4_0.08_150)] dark:text-ok' : 'text-[oklch(0.45_0.1_25)] dark:text-neg')}>{dV(s.x.dif)}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className={cn('grid gap-4', !tel && 'lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]')}>
        {/* Giorni della settimana */}
        <div className={cn(CARD, 'gap-3 px-5 py-[18px]')} style={ritardo(420)}>
          <Titolo t="Giorni della settimana" s="entrate medie per locale" />
          <div className="grid items-center gap-1" style={{ gridTemplateColumns: `${tel ? '72px' : '120px'} repeat(7, minmax(0, 1fr))` }}>
            <span />
            {ORD.map(w => {
              const ha = v.rows.some(r => giornoSett(r.data) === w)
              return (
                <button key={w} type="button" disabled={!ha} onClick={ha ? c.fumGiornoSett(null, w) : undefined}
                  className={cn('flex h-8 items-center justify-center rounded-[6px] text-xs font-medium text-[oklch(0.35_0.01_250)] dark:text-foreground/80', ha ? 'cursor-pointer hover:bg-[oklch(0.95_0.01_250)] active:scale-[0.96] dark:hover:bg-secondary' : 'cursor-default')}>
                  {WD[w]}
                </button>
              )
            })}
            {heat.map(h => (
              <div key={h.l.id} className="contents">
                <span className="truncate text-[13px] font-medium">{h.l.nome}</span>
                {h.m.map((x, q) => {
                  if (x === null) return <div key={q} className="flex h-11 items-center justify-center rounded-[6px] font-mono text-xs font-medium text-muted-foreground" style={{ background: 'repeating-linear-gradient(45deg,oklch(0.96 0.01 250) 0 6px,oklch(0.93 0.01 250) 6px 12px)' }}>—</div>
                  const tt = hmx === hmn ? 1 : (x - hmn) / (hmx - hmn)
                  return (
                    <button key={q} type="button" onClick={c.fumGiornoSett(h.l.id, ORD[q])}
                      className={cn('flex h-11 items-center justify-center rounded-[6px] font-mono text-xs font-medium', tocco)}
                      style={{ background: `oklch(${(0.95 - tt * 0.4).toFixed(3)} ${(0.03 + tt * 0.09).toFixed(3)} 180)`, color: tt > 0.55 ? '#fff' : 'oklch(0.2 0.01 250)' }}>
                      {k1(x)}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Differenze ricorrenti */}
        <div className={cn(CARD, 'gap-3 px-5 py-[18px]')} style={ritardo(480)}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={alerts.length ? 'oklch(0.55 0.13 25)' : 'oklch(0.5 0.08 150)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4l9 16H3z" /><path d="M12 10v4" /><path d="M12 17.5v.01" /></svg>
            <span className="whitespace-nowrap text-[17px] font-semibold">Differenze ricorrenti</span>
            <span className={cn('text-[13px]', MUTO)}>oltre {SOGLIA_DIFFERENZA} € per almeno {MIN_GIORNI_ALERT} giorni</span>
          </div>
          {alerts.length === 0 ? (
            <div className="flex min-h-[120px] flex-1 items-center justify-center rounded-[8px] bg-[oklch(0.95_0.03_150)] text-sm font-medium text-[oklch(0.4_0.08_150)] dark:bg-ok-tint dark:text-ok">Nessun locale oltre soglia nel periodo</div>
          ) : alerts.map(x => {
            const t = sum(x.rs, r => r.dif)
            return (
              <button key={x.s.l.id} type="button" onClick={() => c.apri({ k: 'alert', li: x.s.l.id })} className={cn('flex flex-col gap-2 rounded-[8px] bg-[oklch(0.95_0.03_25)] px-3.5 py-3 text-left active:scale-[0.99] dark:bg-neg-tint', 'cursor-pointer')}>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[15px] font-semibold text-[oklch(0.42_0.12_25)] dark:text-neg">{x.s.l.nome} · {x.rs.length} giorni</span>
                  <span className="font-mono text-xs font-medium text-[oklch(0.45_0.1_25)] dark:text-neg">media {sgn(t / x.rs.length)} · totale {sgn(t)}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {x.rs.slice(0, 14).map(r => <span key={r.id} className="rounded-full bg-card px-2 py-[3px] font-mono text-[11px] font-medium text-[oklch(0.45_0.1_25)] dark:text-neg">{r.data.slice(8)}/{r.data.slice(5, 7)}</span>)}
                  {x.rs.length > 14 && <span className="rounded-full bg-card px-2 py-[3px] font-mono text-[11px] font-medium text-[oklch(0.45_0.1_25)] dark:text-neg">+{x.rs.length - 14}</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className={cn('grid gap-4', !tel && 'lg:grid-cols-2')}>
        {/* Spese per categoria */}
        <div className={cn(CARD, 'gap-3.5 px-5 py-[18px]')} style={ritardo(540)}>
          <Titolo t="Spese per categoria" s="pagate in contanti dalle chiusure" />
          {cats.length === 0 ? <p className={cn('text-sm', MUTO)}>Nessuna spesa di cassa nel periodo.</p> : (
            <div className={cn('grid items-center gap-5', !tel && 'grid-cols-[170px_1fr]')}>
              <div className="relative h-[170px] w-[170px] justify-self-center">
                <svg width="170" height="170" viewBox="0 0 170 170" style={{ transform: 'rotate(-90deg)' }} aria-hidden>
                  <circle cx="85" cy="85" r="66" fill="none" stroke="oklch(0.94 0.01 250)" strokeWidth="22" className="dark:stroke-[var(--secondary)]" />
                  {cats.map((k, i) => {
                    const off = sum(cats.slice(0, i), x => (x.t / totSp) * CIRC), len = (k.t / totSp) * CIRC
                    return <circle key={k.c} cx="85" cy="85" r="66" fill="none" stroke={k.col} strokeWidth="22" strokeDasharray={`${Math.max(0, len - 2).toFixed(2)} ${CIRC.toFixed(2)}`} strokeDashoffset={(-off).toFixed(2)} />
                  })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                  <span className={cn('text-xs', MUTO)}>Totale</span>
                  <span className="font-mono text-[17px] font-semibold">{eu(totSp)}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {cats.map(k => (
                  <button key={k.c} type="button" onClick={c.fumCategoria(k.c, c.dati.spA, true)} className={cn('-mx-2 grid min-h-9 grid-cols-[12px_1fr_auto_40px] items-center gap-2.5 rounded-[8px] px-2 text-left', tocco, sfioro)}>
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: k.col }} />
                    <span className="truncate text-sm font-medium">{k.c}</span>
                    <span className="font-mono text-[13px] font-medium">{eu(k.t)}</span>
                    <span className={cn('text-right font-mono text-xs font-medium', MUTO)}>{Math.round((k.t / totSp) * 100)}%</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Vendite per categoria */}
        <div className={cn(CARD, 'gap-3 px-5 py-[18px]')} style={ritardo(600)}>
          <Titolo t="Vendite per categoria" s="dal report di chiusura" />
          {vendite.length === 0 ? <p className={cn('text-sm', MUTO)}>Nessun report vendite caricato nel periodo.</p> : vendite.map(([cat, val], i) => (
            <button key={cat} type="button" onClick={c.fumCategoria(cat, c.dati.veA, false)}
              className={cn('-mx-2 grid min-h-9 items-center gap-3 rounded-[8px] px-2 text-left', tocco, sfioro)}
              style={{ gridTemplateColumns: tel ? '76px minmax(0,1fr) 84px 36px' : '96px 1fr 96px 40px' }}>
              <span className="truncate text-sm font-medium">{cat}</span>
              <div className="h-[22px] overflow-hidden rounded-[5px] bg-[oklch(0.95_0.01_250)] dark:bg-secondary">
                <div className="h-full rounded-[5px] transition-[width] duration-700 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]" style={{ width: `${(val / vendite[0][1]) * 100}%`, background: i ? `oklch(${(0.62 + Math.min(i, 6) * 0.05).toFixed(2)} ${(0.12 - Math.min(i, 6) * 0.012).toFixed(3)} 180)` : TEAL }} />
              </div>
              <span className="text-right font-mono text-[13px] font-medium">{eu(val, 0)}</span>
              <span className={cn('text-right font-mono text-xs font-medium', MUTO)}>{Math.round((val / totVe) * 100)}%</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
