'use client'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import { cassaChartColor } from '@/components/cassa/chartPalette'
import { CassaFileViewer } from '@/components/cassa/CassaFileViewer'
import { AnalisiAiDialog } from '@/components/cassa/AnalisiAiDialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  aggrega, buckets, inBucket, etichettaBucket, mediaScontrino, giorni, piuGiorni, unAnnoPrima, giornoSett,
  eu, sgn, dV, fN, pc, k1, fd, fdg, fdl, intervallo, variazione, delta, capit, MESI, WDL, WD,
  TONO_TESTO, TONO_PILLOLA, SOGLIA_DIFFERENZA, MIN_GIORNI_ALERT,
  type Chiusura, type Voce, type Acquisto, type Aggregato, type Tono, type Bucket,
} from '@/lib/analisi'
import { caricaChiusure, caricaVoci, caricaAcquisti } from '@/components/cassa/analisi/dati'
import { FoglioDettaglio, FumettoAncorato, USCITA_MS, type Scheda, type Riga, type Sotto, type Fumetto, type RigaFumetto } from '@/components/cassa/analisi/Sovrapposizioni'
import { KpiCard, GraficoEntrate, Cumulata, BarreAB, PillolaB } from '@/components/cassa/analisi/Grafici'
import { PilloleLocali, BarraPeriodo, MenuConfronto, leggiOrdine, type Periodo, type ModoConfronto, type Intervallo } from '@/components/cassa/analisi/Filtri'

// Analisi cassa del manager (design Manager Analisi). Tutto si tocca:
// locali, periodo, KPI, giorni del grafico, righe delle tabelle, celle
// della mappa settimanale, categorie e acquisti. I dettagli lunghi si
// aprono nel foglio laterale (a pila, con indietro), quelli brevi in un
// fumetto accanto all'elemento toccato.

const TZ = 'Europe/Rome'
const TEAL = 'oklch(0.58 0.12 180)'

interface Props { restaurants: { id: string; name: string }[] }

type Nodo =
  | { k: 'day'; d: string; src?: 'B' }
  | { k: 'month'; j: number }
  | { k: 'kpi'; i: number }
  | { k: 'loc'; li: string }
  | { k: 'alert'; li: string }

interface Dati {
  A: Chiusura[]; B: Chiusura[]
  spA: Voce[]; spB: Voce[]; veA: Voce[]; veB: Voce[]
  acA: Acquisto[]; acB: Acquisto[]
}
const VUOTO: Dati = { A: [], B: [], spA: [], spB: [], veA: [], veB: [], acA: [], acB: [] }

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)
const oggiRoma = () => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')

function intervalloPeriodo(p: Periodo, oggi: string): Intervallo {
  const y = oggi.slice(0, 4), m = oggi.slice(0, 7)
  if (p.k === 'oggi') return { a: oggi, b: oggi }
  if (p.k === 'sett') return { a: piuGiorni(oggi, -((giornoSett(oggi) + 6) % 7)), b: oggi }
  if (p.k === 'anno') return { a: `${y}-01-01`, b: oggi }
  if (p.k === 'custom') return p.r
  const mese = p.k === 'mesi' ? p.mese : m
  const [yy, mm] = mese.split('-').map(Number)
  const fine = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10)
  return { a: `${mese}-01`, b: fine < oggi ? fine : oggi }
}

// Telefono o tablet: alcune etichette si accorciano come nel design.
function useTelefono() {
  return useSyncExternalStore(
    cb => { const mq = window.matchMedia('(max-width: 639px)'); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb) },
    () => window.matchMedia('(max-width: 639px)').matches,
    () => false
  )
}
// Ordine delle pillole salvato sul dispositivo (pressione lunga per spostarle).
function useOrdineSalvato() {
  const raw = useSyncExternalStore(() => () => {}, () => { try { return localStorage.getItem('inturno.locOrderL') ?? '[]' } catch { return '[]' } }, () => '[]')
  return useMemo(() => { try { return JSON.parse(raw) as string[] } catch { return leggiOrdine() } }, [raw])
}

export function AnalisiClient({ restaurants }: Props) {
  const tel = useTelefono()
  const ordineSalvato = useOrdineSalvato()
  const [ordine, setOrdine] = useState<string[] | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [periodo, setPeriodo] = useState<Periodo>({ k: 'mese' })
  const [cmp, setCmp] = useState<ModoConfronto>(null)
  const [cmpC, setCmpC] = useState<Intervallo | null>(null)
  const [dati, setDati] = useState<Dati>(VUOTO)
  const [stato, setStato] = useState<'carica' | 'ok' | 'errore'>('carica')
  const [pila, setPila] = useState<Nodo[]>([])
  const [pilaEsce, setPilaEsce] = useState(false)
  const [fum, setFum] = useState<Fumetto | null>(null)
  const [fumEsce, setFumEsce] = useState(false)
  const apriConfronto = useRef<(() => void) | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [esporta, setEsporta] = useState<'pdf' | 'xlsx' | null>(null)
  const [menuEsporta, setMenuEsporta] = useState(false)

  const oggi = oggiRoma()
  const { a, b } = intervalloPeriodo(periodo, oggi)
  const n = giorni(a, b)
  const B: Intervallo = cmp === 'yoy' ? { a: unAnnoPrima(a), b: unAnnoPrima(b) }
    : cmp === 'custom' && cmpC ? cmpC
    : { a: piuGiorni(a, -n), b: piuGiorni(a, -1) }

  const locali = useMemo(() => restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) })), [restaurants])
  const nomeLoc = useMemo(() => Object.fromEntries(locali.map(l => [l.id, l])), [locali])
  const target = useMemo(() => (sel.length ? sel : locali.map(l => l.id)), [sel, locali])
  const chiaveTarget = target.join(',')

  const mesi = useMemo(() => {
    const [y, m] = oggi.split('-').map(Number)
    return [1, 2, 3].map(q => { const d = new Date(Date.UTC(y, m - 1 - q, 1)); return { k: d.toISOString().slice(0, 7), l: capit(MESI[d.getUTCMonth()]) } })
  }, [oggi])

  // ── Caricamento ────────────────────────────────────────────────────
  const req = useRef(0)
  const carica = useCallback(async () => {
    const mio = ++req.current
    setStato('carica')
    const sb = createClient()
    const ids = chiaveTarget ? chiaveTarget.split(',') : []
    const [A, Bc, acA, acB] = await Promise.all([
      caricaChiusure(sb, ids, a, b), caricaChiusure(sb, ids, B.a, B.b),
      caricaAcquisti(sb, ids, a, b), caricaAcquisti(sb, ids, B.a, B.b),
    ])
    const [spA, spB, veA, veB] = await Promise.all([
      caricaVoci(sb, A.righe, 'spese'), caricaVoci(sb, Bc.righe, 'spese'),
      caricaVoci(sb, A.righe, 'vendite'), caricaVoci(sb, Bc.righe, 'vendite'),
    ])
    if (req.current !== mio) return
    if (A.errore) { setStato('errore'); return }
    setDati({ A: A.righe, B: Bc.righe, spA: spA.voci, spB: spB.voci, veA: veA.voci, veB: veB.voci, acA, acB })
    setStato('ok')
  }, [a, b, B.a, B.b, chiaveTarget])

  useEffect(() => { carica() }, [carica])
  useEffect(() => {
    const sb = createClient()
    const ch = sb.channel('cassa_chiusure_analisi')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cassa_chiusure' }, () => carica())
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [carica])

  // ── Calcoli ────────────────────────────────────────────────────────
  const v = useMemo(() => {
    const { A: rows, B: prev } = dati
    const X = aggrega(rows), P = aggrega(prev)
    const { lista: bk, mensile } = buckets(a, b)
    const cbk = buckets(B.a, B.b, mensile).lista
    const locSel = locali.filter(l => target.includes(l.id))
    const presenti = locSel.filter(l => rows.some(r => r.li === l.id))
    const ser = bk.map(k => presenti.map(l => sum(rows.filter(r => r.li === l.id && inBucket(r.data, k)), r => r.ent)))
    const serB = bk.map((_, j) => (cbk[j] ? sum(prev.filter(r => inBucket(r.data, cbk[j])), r => r.ent) : 0))
    const bySer = (rs: Chiusura[], ks: Bucket[], f: (x: Chiusura[]) => number) => ks.map(k => f(rs.filter(r => inBucket(r.data, k))))
    const sedi = presenti.map(l => { const rs = rows.filter(r => r.li === l.id); return { l, rs, x: aggrega(rs), y: aggrega(prev.filter(r => r.li === l.id)) } })
    // Categorie di spesa in ordine di importo, ciascuna col suo colore.
    const catTot = new Map<string, number>()
    for (const x of dati.spA) catTot.set(x.categoria, (catTot.get(x.categoria) ?? 0) + x.importo)
    for (const x of dati.spB) if (!catTot.has(x.categoria)) catTot.set(x.categoria, 0)
    const categorie = [...catTot.entries()].sort((p, q) => q[1] - p[1]).map(([c], i) => ({ c, col: cassaChartColor(i) }))
    const colCat = Object.fromEntries(categorie.map(x => [x.c, x.col]))
    return { rows, prev, X, P, bk, cbk, mensile, locSel, presenti, ser, serB, bySer, sedi, categorie, colCat }
  }, [dati, a, b, B.a, B.b, locali, target])

  const cmpAttivo = !!cmp
  const etichettaB = (k: Bucket | undefined) => {
    if (!k) return '—'
    if (v.mensile) { const d = new Date(`${k.a}T12:00:00Z`); return `${MESI[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}` }
    return fdg(k.a) + (cmp === 'yoy' ? ` ${k.a.slice(0, 4)}` : '')
  }
  const sottotitolo = `${intervallo(a, b)} · ${sel.length ? `${sel.length} ${sel.length === 1 ? 'locale' : 'locali'}` : 'tutti i locali'}`

  // ── Metriche ───────────────────────────────────────────────────────
  const MET: { l: string; f: (rs: Chiusura[]) => number; fmt: (x: number) => string; buono: 'su' | 'giu'; ass?: boolean; col: string }[] = [
    { l: 'Totale entrate', f: rs => sum(rs, r => r.ent), fmt: x => eu(x, 0), buono: 'su', col: TEAL },
    { l: 'Totale spese', f: rs => sum(rs, r => r.sp), fmt: x => eu(x, 0), buono: 'giu', col: 'oklch(0.6 0.11 250)' },
    { l: 'Margine operativo', f: rs => sum(rs, r => r.ent - r.sp), fmt: x => eu(x, 0), buono: 'su', col: TEAL },
    { l: 'Differenza cumulata', f: rs => sum(rs, r => r.dif), fmt: dV, buono: 'giu', ass: true, col: Math.abs(v.X.dif) < 0.005 ? 'oklch(0.55 0.1 150)' : 'oklch(0.6 0.13 25)' },
    { l: 'Coperti', f: rs => sum(rs, r => r.cop), fmt: fN, buono: 'su', col: 'oklch(0.72 0.12 75)' },
    { l: 'Media scontrino', f: rs => mediaScontrino({ ent: sum(rs, r => r.ent), asp: sum(rs, r => r.asp), cop: sum(rs, r => r.cop) }), fmt: x => (x ? eu(x) : '—'), buono: 'su', col: 'oklch(0.62 0.12 330)' },
  ]

  // ── Foglio di dettaglio ────────────────────────────────────────────
  const timerUscita = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apri = (nodo: Nodo) => { setFum(null); setPilaEsce(false); if (timerUscita.current) clearTimeout(timerUscita.current); setPila([nodo]) }
  const chiudiPila = useCallback(() => {
    setPilaEsce(true)
    timerUscita.current = setTimeout(() => { setPila([]); setPilaEsce(false) }, USCITA_MS)
  }, [])
  const idFumAperto = fum?.id
  const chiudiFum = useCallback(() => {
    setFumEsce(true)
    setTimeout(() => { setFum(f => (f && f.id === idFumAperto ? null : f)); setFumEsce(false) }, USCITA_MS)
  }, [idFumAperto])
  const vai = (nodo: Nodo) => setPila(p => [...p, nodo])

  const vociSpesa = (rs: Chiusura[], src: Voce[]) => { const ids = new Set(rs.map(r => `${r.data}|${r.li}`)); return src.filter(x => ids.has(`${x.data}|${x.li}`)) }

  function rigaSpese(rs: Chiusura[], src: Voce[]): Riga {
    const voci = vociSpesa(rs, src).sort((p, q) => q.data.localeCompare(p.data))
    const multiLoc = new Set(rs.map(r => r.li)).size > 1
    let sotto: Sotto[]
    if (rs.length > 1) {
      const g = new Map<string, Voce[]>()
      for (const x of voci) g.set(x.categoria, [...(g.get(x.categoria) ?? []), x])
      sotto = [...g.entries()].map(([c, xs]) => ({ c, xs, t: sum(xs, x => x.importo) })).sort((p, q) => q.t - p.t).map(({ c, xs, t }) => ({
        l: c, s: `${xs.length} ${xs.length === 1 ? 'voce' : 'voci'}`, v: eu(t), dot: v.colCat[c],
        figli: xs.map(x => ({ l: x.nome, s: fd(x.data) + (multiLoc ? ` · ${nomeLoc[x.li]?.nome ?? ''}` : ''), v: eu(x.importo) })),
      }))
    } else {
      sotto = voci.map(x => ({ l: x.nome, s: `${x.categoria} · pagato in contanti`, v: eu(x.importo), dot: v.colCat[x.categoria] }))
    }
    return { tipo: 'espandi', l: 'Spese', v: eu(sum(rs, r => r.sp)), sotto }
  }

  function campi(x: Aggregato, rs: Chiusura[], src: Voce[]): Riga[] {
    const tdif: Tono = Math.abs(x.dif) < 0.005 ? 'ok' : 'neg'
    return [
      { tipo: 'stat', l: 'Totale entrate', v: eu(x.ent) },
      { tipo: 'stat', l: 'Contanti', v: eu(x.con) },
      { tipo: 'stat', l: 'POS', v: eu(x.pos) },
      { tipo: 'stat', l: 'Bonifico', v: eu(x.bon) },
      { tipo: 'stat', l: 'di cui asporto', v: eu(x.asp) },
      { tipo: 'stat', l: 'Coperti', v: fN(x.cop) },
      { tipo: 'stat', l: 'Media scontrino', v: x.cop ? eu(mediaScontrino(x)) : '—' },
      rigaSpese(rs, src),
      { tipo: 'stat', l: 'Differenza', v: dV(x.dif), tono: tdif },
    ]
  }
  const st4 = (x: Aggregato) => [
    { l: 'Totale entrate', v: eu(x.ent, 0) }, { l: 'Coperti', v: fN(x.cop) },
    { l: 'Media scontrino', v: x.cop ? eu(mediaScontrino(x)) : '—' }, { l: 'Differenza', v: dV(x.dif), tono: (Math.abs(x.dif) < 0.005 ? 'ok' : 'neg') as Tono },
  ]

  function costruisci(d: Nodo): Scheda {
    if (d.k === 'day') {
      const fonte = d.src === 'B' ? v.prev : v.rows, voci = d.src === 'B' ? dati.spB : dati.spA
      const rs = fonte.filter(r => r.data === d.d)
      return {
        titolo: fdl(d.d) + (d.src === 'B' ? `${cmp === 'yoy' ? ` ${d.d.slice(0, 4)}` : ''} · periodo B` : ''),
        sotto: `${rs.length} ${rs.length === 1 ? 'chiusura confermata' : 'chiusure confermate'}`,
        stats: st4(aggrega(rs)),
        sezioni: rs.map(r => ({ h: nomeLoc[r.li]?.nome ?? '—', dot: nomeLoc[r.li]?.colore, righe: campi(aggrega([r]), [r], voci) })),
      }
    }
    if (d.k === 'month') {
      const k = v.bk[d.j], rs = v.rows.filter(r => inBucket(r.data, k))
      const ds = [...new Set(rs.map(r => r.data))].sort().reverse()
      return {
        titolo: etichettaBucket(k, true), sotto: `${ds.length} giorni di apertura`, stats: st4(aggrega(rs)),
        sezioni: [{ h: 'Giorni', righe: ds.map(g => { const y = aggrega(rs.filter(r => r.data === g)); return { tipo: 'link' as const, l: fdl(g), s: `${fN(y.cop)} coperti${Math.abs(y.dif) >= 0.005 ? ` · diff. ${dV(y.dif)}` : ''}`, v: eu(y.ent, 0), apri: () => vai({ k: 'day', d: g }) } }) }],
      }
    }
    if (d.k === 'kpi') {
      const m = MET[d.i]
      return {
        titolo: m.l, sotto: sottotitolo,
        stats: [{ l: 'Periodo', v: m.fmt(m.f(v.rows)), tono: d.i === 3 ? (Math.abs(v.X.dif) < 0.005 ? 'ok' : 'neg') : undefined }, { l: cmpAttivo ? 'Periodo B' : 'Periodo prima', v: v.prev.length ? m.fmt(m.f(v.prev)) : '—' }],
        sezioni: [
          { h: 'Per locale', righe: v.sedi.map(s => ({ tipo: 'link' as const, l: s.l.nome, dot: s.l.colore, s: `${s.rs.length} chiusure`, v: m.fmt(m.f(s.rs)), apri: () => vai({ k: 'loc', li: s.l.id }) })) },
          { h: v.mensile ? 'Per mese' : 'Per giorno', righe: v.bk.map((k, j) => ({ k, j, rs: v.rows.filter(r => inBucket(r.data, k)) })).filter(o => o.rs.length).reverse().map(o => ({
            tipo: 'link' as const, l: v.mensile ? capit(MESI[new Date(`${o.k.a}T12:00:00Z`).getUTCMonth()]) : fdl(o.k.a), v: m.fmt(m.f(o.rs)),
            tono: d.i === 3 ? (Math.abs(m.f(o.rs)) < 0.005 ? 'ok' : 'neg') as Tono : undefined,
            apri: () => vai(v.mensile ? { k: 'month', j: o.j } : { k: 'day', d: o.k.a }),
          })) },
        ],
      }
    }
    if (d.k === 'loc') {
      const l = nomeLoc[d.li], rs = v.rows.filter(r => r.li === d.li).sort((p, q) => q.data.localeCompare(p.data)), x = aggrega(rs)
      const solo = sel.length === 1 && sel[0] === d.li
      return {
        titolo: l?.nome ?? '—', sotto: `${rs.length} chiusure · ${intervallo(a, b)}`,
        stats: [
          { l: 'Totale entrate', v: eu(x.ent, 0) }, { l: 'Margine operativo', v: eu(x.ent - x.sp, 0), tono: x.ent - x.sp >= 0 ? 'ok' : 'neg' },
          { l: 'Media scontrino', v: x.cop ? eu(mediaScontrino(x)) : '—' }, { l: 'Differenza', v: dV(x.dif), tono: Math.abs(x.dif) < 0.005 ? 'ok' : 'neg' },
        ],
        sezioni: [
          { h: 'Riepilogo', dot: l?.colore, righe: campi(x, rs, dati.spA) },
          { h: 'Chiusure', righe: rs.map(r => ({ tipo: 'link' as const, l: fdl(r.data), s: `${fN(r.cop)} coperti · spese ${eu(r.sp)}`, v: eu(r.ent, 0), apri: () => vai({ k: 'day', d: r.data }) })) },
        ],
        azione: { l: solo ? 'Torna a tutti i locali' : `Filtra l’analisi su ${l?.nome ?? ''}`, fai: () => { setSel(solo ? [] : [d.li]); chiudiPila() } },
      }
    }
    const l = nomeLoc[d.li], rs = v.rows.filter(r => r.li === d.li && Math.abs(r.dif) >= SOGLIA_DIFFERENZA).sort((p, q) => q.data.localeCompare(p.data)), tt = sum(rs, r => r.dif)
    return {
      titolo: `${l?.nome ?? ''} · differenze`, sotto: `giorni oltre ${SOGLIA_DIFFERENZA} € nel periodo`,
      stats: [{ l: 'Giorni', v: String(rs.length) }, { l: 'Totale', v: dV(tt), tono: Math.abs(tt) < 0.005 ? 'ok' : 'neg' }],
      sezioni: [{ h: 'Giorni', dot: l?.colore, righe: rs.map(r => ({ tipo: 'link' as const, l: fdl(r.data), s: `contanti ${eu(r.con)} · spese ${eu(r.sp)}`, v: dV(r.dif), tono: 'neg' as Tono, apri: () => vai({ k: 'day', d: r.data }) })) }],
    }
  }
  const schede = pila.map(costruisci)

  // ── Fumetti ────────────────────────────────────────────────────────
  const fumetto = (titolo: string, sotto: string, righe: RigaFumetto[]) => (e: React.MouseEvent<Element>) => {
    e.stopPropagation()
    setFumEsce(false)
    setFum({ id: e.timeStamp + Math.random(), titolo, sotto, righe, ancora: e.currentTarget.getBoundingClientRect() })
  }
  const perLocale = (val: (s: (typeof v.sedi)[number]) => string, p?: (s: (typeof v.sedi)[number]) => string): RigaFumetto[] =>
    v.sedi.map(s => ({ l: s.l.nome, v: val(s), p: p?.(s), dot: s.l.colore }))

  const fumPagamento = (l: string, k: 'pos' | 'con' | 'bon') => fumetto(l, 'per locale · % sulle entrate del locale', perLocale(s => eu(s.x[k], 0), s => pc(s.x[k], s.x.ent)))
  const fumAsporto = fumetto('Asporto', 'per locale · % sulle entrate', perLocale(s => eu(s.x.asp, 0), s => pc(s.x.asp, s.x.ent)))
  const fumCoperti = fumetto('Coperti medi / giorno', 'per locale', perLocale(s => fN(s.x.cop / (s.rs.length || 1))))
  const fumCategoria = (c: string, src: Voce[], spese: boolean) => fumetto(c, spese ? 'spese di cassa per locale · tocca per le voci' : 'vendite per locale', v.sedi.map(s => {
    const xs = src.filter(x => x.li === s.l.id && x.categoria === c).sort((p, q) => q.data.localeCompare(p.data)), tv = sum(xs, x => x.importo)
    return {
      l: s.l.nome, dot: s.l.colore, v: eu(tv, spese ? 2 : 0), p: spese ? `${xs.length} ${xs.length === 1 ? 'voce' : 'voci'}` : pc(tv, s.x.ent),
      figli: spese ? xs.map(x => ({ l: x.nome, s: `${fd(x.data)} · pagato in contanti`, v: eu(x.importo) })) : undefined,
    }
  }))
  const fumGiornoSett = (li: string | null, w: number) => {
    const rs = v.rows.filter(r => (li === null || r.li === li) && giornoSett(r.data) === w)
    const g = new Map<string, number>()
    for (const r of rs) g.set(r.data, (g.get(r.data) ?? 0) + r.ent)
    const ts = [...g.keys()].sort(), vs = ts.map(x => g.get(x)!), mx = Math.max(...vs), mn = Math.min(...vs), tt = sum(vs, x => x)
    const nomeG = WDL[w].toLowerCase(), plur = nomeG === 'sabato' ? 'sabati' : nomeG === 'domenica' ? 'domeniche' : nomeG
    const chi = li === null ? (sel.length ? v.sedi.map(s => s.l.nome).join(', ') : 'Tutti i locali') : nomeLoc[li]?.nome ?? ''
    return fumetto(`${chi} · ${nomeG}`, `${ts.length} ${ts.length === 1 ? nomeG : plur} · ${intervallo(a, b)}`, [
      ...ts.map(x => ({ l: fd(x), v: eu(g.get(x)!, 0), tono: (ts.length > 1 && g.get(x) === mx ? 'ok' : ts.length > 1 && g.get(x) === mn ? 'neg' : undefined) as Tono | undefined })),
      { l: 'Media', v: eu(ts.length ? tt / ts.length : 0, 0) }, { l: 'Totale', v: eu(tt, 0) },
    ])
  }

  // ── Acquisti da fatture ────────────────────────────────────────────
  type ChiaveF = 'tot' | 'fo' | 'be' | 'nf' | 'fb'
  const gv = (x: { fo: number; be: number; de: number; an: number }, k: ChiaveF) => k === 'nf' ? x.de + x.an : k === 'fb' ? x.fo + x.be : k === 'tot' ? x.fo + x.be + x.de + x.an : x[k]
  const sommaAc = (xs: Acquisto[]) => xs.reduce((o, x) => ({ fo: o.fo + x.fo, be: o.be + x.be, de: o.de + x.de, an: o.an + x.an }), { fo: 0, be: 0, de: 0, an: 0 })
  const FA = sommaAc(dati.acA), FB = sommaAc(dati.acB)
  const fornitori = (li: string, k: ChiaveF) => {
    const m = new Map<string, { v: number; n: number }>()
    for (const x of dati.acA.filter(q => q.li === li)) { const val = gv(x, k); if (!val) continue; const o = m.get(x.fornitore) ?? { v: 0, n: 0 }; o.v += val; o.n++; m.set(x.fornitore, o) }
    return [...m.entries()].sort((p, q) => q[1].v - p[1].v)
  }
  const fumFattura = (l: string, k: ChiaveF) => fumetto(l, k === 'nf' ? 'detergenza e altro no food · per locale' : 'per locale · % sugli acquisti del locale', [
    ...v.sedi.map(s => { const x = sommaAc(dati.acA.filter(q => q.li === s.l.id)); return { l: s.l.nome, dot: s.l.colore, v: eu(gv(x, k), 0), p: pc(gv(x, k), gv(x, 'tot')), figli: fornitori(s.l.id, k).map(([nm, o]) => ({ l: nm, s: `${o.n} ${o.n === 1 ? 'fattura' : 'fatture'}`, v: eu(o.v, 0) })) } }),
    ...(k === 'nf' ? [{ l: 'di cui detergenza', v: eu(FA.de, 0) }, { l: 'di cui altro no food', v: eu(FA.an, 0) }] : []),
  ])
  const fumIncidenza = (l: string, k: ChiaveF) => fumetto(l, 'per locale · acquisti / entrate', v.sedi.map(s => {
    const x = sommaAc(dati.acA.filter(q => q.li === s.l.id))
    return { l: s.l.nome, dot: s.l.colore, v: pc(gv(x, k), s.x.ent), p: eu(gv(x, k), 0), figli: fornitori(s.l.id, k).map(([nm, o]) => ({ l: nm, s: `${o.n} ${o.n === 1 ? 'fattura' : 'fatture'}`, v: pc(o.v, s.x.ent) })) }
  }))

  const c: Ctx = { v, dati, MET, tel, cmp, B, a, b, sel, setSel, apri, fumetto, fumPagamento, fumAsporto, fumCoperti, fumCategoria, fumGiornoSett, fumFattura, fumIncidenza, FA, FB, gv, etichettaB, nomeLoc }

  const vuoto = stato === 'ok' && v.rows.length === 0
  return (
    <div className="flex flex-col gap-4">
      <span className="-mt-1 text-[13px] text-muted-foreground">{sottotitolo}</span>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <PilloleLocali locali={locali} sel={sel} onSel={setSel} ordine={ordine ?? ordineSalvato} onOrdine={setOrdine} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <BarraPeriodo periodo={periodo} onPeriodo={p => { setPeriodo(p) }} mesi={mesi} oggi={oggi} tel={tel} />
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <MenuConfronto apriRef={apriConfronto} oggi={oggi} modo={cmp} onModo={setCmp} custom={cmpC} onCustom={setCmpC}
              opzioni={{ prev: intervallo(piuGiorni(a, -n), piuGiorni(a, -1)), yoy: intervallo(unAnnoPrima(a), unAnnoPrima(b)) }}>
              {(apriMenu, attivo) => (
                <button type="button" onClick={apriMenu} className={cn('flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border px-3.5 text-sm font-medium active:scale-[0.97]', attivo ? 'border-primary bg-primary text-primary-foreground' : 'border-line-strong bg-card')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" /></svg>
                  {attivo ? (tel ? 'Attivo' : 'Confronto attivo') : 'Confronta'}
                </button>
              )}
            </MenuConfronto>
            <div className="relative" data-pop>
              <button type="button" disabled={!v.rows.length} onClick={() => setMenuEsporta(m => !m)} className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-line-strong bg-card px-3.5 text-sm font-medium active:scale-[0.97] disabled:opacity-45">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></svg>
                Esporta
              </button>
              {menuEsporta && (
                <div className="anim-swapin absolute right-0 top-[calc(100%+6px)] z-[46] flex w-40 flex-col gap-0.5 rounded-[14px] border border-border bg-card p-1.5 shadow-float" onMouseLeave={() => setMenuEsporta(false)}>
                  {(['xlsx', 'pdf'] as const).map(f => (
                    <button key={f} type="button" onClick={() => { setEsporta(f); setMenuEsporta(false) }} className="flex h-11 items-center rounded-[8px] px-3 text-left text-sm font-medium hover:bg-background">{f === 'xlsx' ? 'Excel' : 'PDF'}</button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" disabled={!restaurants.length} onClick={() => setAiOpen(true)} className="flex h-11 items-center justify-center gap-2 rounded-[10px] border border-line-strong bg-card px-3.5 text-sm font-medium active:scale-[0.97]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
              Chiedi
            </button>
          </div>
        </div>
      </div>

      {stato === 'carica' && dati === VUOTO ? <Scheletro />
        : stato === 'errore' ? (
          <div className="flex flex-col items-center gap-3 rounded-[12px] border border-border bg-card px-5 py-10 text-center">
            <span className="text-[15px] font-semibold">Non riesco a caricare le chiusure</span>
            <span className="text-sm text-muted-foreground">Controlla la connessione e riprova.</span>
            <button type="button" onClick={() => carica()} className="h-11 rounded-[10px] bg-primary px-5 text-sm font-medium text-primary-foreground active:scale-[0.97]">Riprova</button>
          </div>
        ) : vuoto ? (
          <div className="rounded-[12px] border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">Nessuna chiusura confermata nel periodo selezionato.</div>
        ) : (
          <div key={`${a}|${b}|${chiaveTarget}|${cmp}`} className={cn('flex flex-col gap-4 transition-opacity', stato === 'carica' && 'opacity-60')}>
            {cmpAttivo ? <VistaConfronto c={c} onCambia={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); apriConfronto.current?.() }} onSpegni={() => setCmp(null)} /> : <VistaNormale c={c} />}
          </div>
        )}

      <FoglioDettaglio pila={schede} esce={pilaEsce} onIndietro={() => setPila(p => p.slice(0, -1))} onChiudi={chiudiPila} />
      <FumettoAncorato f={fum} esce={fumEsce} onChiudi={chiudiFum} />
      <CassaFileViewer
        open={!!esporta} onOpenChange={o => { if (!o) setEsporta(null) }}
        request={esporta ? { url: '/api/cassa/analisi-export', body: { restaurant_ids: target, start: a, end: b, format: esporta } } : null}
        format={esporta} title={`Analisi · ${intervallo(a, b)}`} fileNameBase={`analisi-cassa-${a}_${b}`}
      />
      <AnalisiAiDialog open={aiOpen} onOpenChange={setAiOpen} restaurantIds={target} />
    </div>
  )
}

function Scheletro() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[124px] rounded-[12px]" />)}</div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"><Skeleton className="h-[380px] rounded-[12px]" /><Skeleton className="h-[380px] rounded-[12px]" /></div>
    </div>
  )
}

// ── Viste ───────────────────────────────────────────────────────────

interface Ctx {
  v: {
    rows: Chiusura[]; prev: Chiusura[]; X: Aggregato; P: Aggregato; bk: Bucket[]; cbk: Bucket[]; mensile: boolean
    locSel: { id: string; nome: string; colore: string }[]; presenti: { id: string; nome: string; colore: string }[]
    ser: number[][]; serB: number[]; bySer: (rs: Chiusura[], ks: Bucket[], f: (x: Chiusura[]) => number) => number[]
    sedi: { l: { id: string; nome: string; colore: string }; rs: Chiusura[]; x: Aggregato; y: Aggregato }[]
    categorie: { c: string; col: string }[]; colCat: Record<string, string>
  }
  dati: Dati
  MET: { l: string; f: (rs: Chiusura[]) => number; fmt: (x: number) => string; buono: 'su' | 'giu'; ass?: boolean; col: string }[]
  tel: boolean
  cmp: ModoConfronto
  B: Intervallo; a: string; b: string
  sel: string[]; setSel: (s: string[]) => void
  apri: (n: Nodo) => void
  fumetto: (t: string, s: string, r: RigaFumetto[]) => (e: React.MouseEvent<Element>) => void
  fumPagamento: (l: string, k: 'pos' | 'con' | 'bon') => (e: React.MouseEvent<Element>) => void
  fumAsporto: (e: React.MouseEvent<Element>) => void
  fumCoperti: (e: React.MouseEvent<Element>) => void
  fumCategoria: (c: string, src: Voce[], spese: boolean) => (e: React.MouseEvent<Element>) => void
  fumGiornoSett: (li: string | null, w: number) => (e: React.MouseEvent<Element>) => void
  fumFattura: (l: string, k: 'tot' | 'fo' | 'be' | 'nf' | 'fb') => (e: React.MouseEvent<Element>) => void
  fumIncidenza: (l: string, k: 'tot' | 'fo' | 'be' | 'nf' | 'fb') => (e: React.MouseEvent<Element>) => void
  FA: { fo: number; be: number; de: number; an: number }; FB: { fo: number; be: number; de: number; an: number }
  gv: (x: { fo: number; be: number; de: number; an: number }, k: 'tot' | 'fo' | 'be' | 'nf' | 'fb') => number
  etichettaB: (k: Bucket | undefined) => string
  nomeLoc: Record<string, { id: string; nome: string; colore: string }>
}

function Card({ titolo, sotto, destra, children, ritardo = 0, className, piena }: { titolo: React.ReactNode; sotto?: string; destra?: React.ReactNode; children: React.ReactNode; ritardo?: number; className?: string; piena?: boolean }) {
  return (
    <section className={cn('anim-swapin flex min-w-0 flex-col gap-3 overflow-hidden rounded-[12px] border border-border bg-card py-4 sm:py-[18px]', !piena && 'px-4 sm:px-5', className)} style={{ animationDelay: `${ritardo}ms` }}>
      <div className={cn('flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5', piena && 'px-4 sm:px-5')}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="text-[17px] font-semibold">{titolo}</span>
          {sotto && <span className="text-[13px] text-muted-foreground">{sotto}</span>}
        </div>
        {destra}
      </div>
      {children}
    </section>
  )
}

const ORD = [1, 2, 3, 4, 5, 6, 0]
const tap = 'cursor-pointer transition-transform active:scale-[0.98]'
const COLORI_PAG = { pos: TEAL, con: 'oklch(0.72 0.12 75)', bon: 'oklch(0.6 0.11 250)' }
const COLORI_FAT = { fo: TEAL, be: 'oklch(0.6 0.11 250)', nf: 'oklch(0.72 0.12 75)' }

function etichetteSerie(c: Ctx) { return c.v.bk.map(k => etichettaBucket(k, c.v.mensile)) }

function VistaNormale({ c }: { c: Ctx }) {
  const { v, MET, tel } = c
  const et = etichetteSerie(c)
  const best = useMemo(() => {
    const g = new Map<string, number>()
    for (const r of v.rows) g.set(r.data, (g.get(r.data) ?? 0) + r.ent)
    return [...g.entries()].sort((p, q) => q[1] - p[1])
  }, [v.rows])
  const traina = (d: string) => {
    const rs = v.rows.filter(r => r.data === d).sort((p, q) => q.ent - p.ent)
    return v.presenti.length > 1 ? `traina ${c.nomeLoc[rs[0].li]?.nome ?? ''}` : `${rs[0].cop} coperti`
  }
  const tot = v.X.ent
  const maxEnt = Math.max(...v.sedi.map(s => s.x.ent), 1)
  const fT = c.gv(c.FA, 'tot')

  // Mappa giorni della settimana: media per locale, scala teal min → max.
  const heat = v.locSel.map(l => ({ l, m: ORD.map(w => { const rs = v.rows.filter(r => r.li === l.id && giornoSett(r.data) === w); return rs.length ? sum(rs, r => r.ent) / rs.length : null }) })).filter(h => h.m.some(x => x !== null))
  const tutte = heat.flatMap(h => h.m).filter((x): x is number => x !== null), hmx = Math.max(...tutte), hmn = Math.min(...tutte)

  const alerts = v.sedi.map(s => ({ s, rs: s.rs.filter(r => Math.abs(r.dif) >= SOGLIA_DIFFERENZA) })).filter(x => x.rs.length >= MIN_GIORNI_ALERT)

  const totSp = sum(c.dati.spA, x => x.importo)
  const cats = v.categorie.map(k => ({ ...k, t: sum(c.dati.spA.filter(x => x.categoria === k.c), x => x.importo) })).filter(k => k.t > 0)
  const CIRC = 2 * Math.PI * 66
  const vendite = (() => { const m = new Map<string, number>(); for (const x of c.dati.veA) m.set(x.categoria, (m.get(x.categoria) ?? 0) + x.importo); return [...m.entries()].sort((p, q) => q[1] - p[1]) })()
  const totVe = sum(vendite, x => x[1])

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {MET.map((m, i) => {
          const val = m.f(v.rows), pr = m.f(v.prev)
          return (
            <KpiCard key={m.l} l={m.l} v={m.fmt(val)} ritardo={i * 50}
              tonoValore={i === 2 && val < 0 ? 'neg' : i === 3 ? (Math.abs(val) < 0.005 ? 'ok' : 'neg') : undefined}
              varz={variazione(val, pr, m.buono, m.ass)} vs={tel ? 'vs prima' : 'vs periodo prima'}
              serie={v.bySer(v.rows, v.bk, m.f)} colore={m.col} etichette={et} fmt={m.fmt}
              onApri={() => c.apri({ k: 'kpi', i })} />
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card titolo="Andamento entrate" sotto={v.mensile ? 'per mese · tocca un mese' : 'per giorno · tocca un giorno'} ritardo={180}
          destra={v.presenti.length > 1 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {v.presenti.map(l => <span key={l.id} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: `color-mix(in oklch, ${l.colore} 62%, var(--card))` }} />{l.nome}</span>)}
            </div>
          )}>
          <GraficoEntrate asse={v.bk.map(k => k.asse)} etichette={et} locali={v.presenti} ser={v.ser} serB={null} etichetteB={[]}
            onApri={j => c.apri(v.mensile ? { k: 'month', j } : { k: 'day', d: v.bk[j].a })} />
        </Card>
        <div className="flex flex-col gap-4">
          {best.length > 1 && (
            <div className="anim-swapin grid grid-cols-2 gap-3" style={{ animationDelay: '240ms' }}>
              {[{ d: best[0], h: 'Giorno migliore', ok: true }, { d: best[best.length - 1], h: 'Giorno peggiore', ok: false }].map(x => (
                <button key={x.h} type="button" onClick={() => c.apri({ k: 'day', d: x.d[0] })}
                  className={cn('flex flex-col gap-1 rounded-[12px] px-4 py-3.5 text-left', tap, x.ok ? 'bg-ok-tint' : 'bg-neg-tint')}>
                  <span className={cn('text-[10px] font-semibold uppercase tracking-[.06em]', x.ok ? 'text-ok' : 'text-neg')}>{x.h}</span>
                  <span className="text-[15px] font-semibold">{fdg(x.d[0])}</span>
                  <span className={cn('font-mono text-[18px] font-semibold', x.ok ? 'text-ok' : 'text-neg')}>{eu(x.d[1], 0)}</span>
                  <span className="text-xs text-muted-foreground">{traina(x.d[0])}</span>
                </button>
              ))}
            </div>
          )}
          <Card titolo="Pagamenti" ritardo={300} className="flex-1">
            <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-[7px]">
              {(['pos', 'con', 'bon'] as const).map(k => <div key={k} className="transition-[width] duration-500" style={{ width: `${tot ? (v.X[k] / tot) * 100 : 0}%`, background: COLORI_PAG[k] }} />)}
            </div>
            {([['POS', 'pos'], ['Contanti', 'con'], ['Bonifico', 'bon']] as const).map(([l, k]) => (
              <button key={k} type="button" onClick={c.fumPagamento(l, k)} className={cn('-mx-2 grid min-h-9 grid-cols-[12px_1fr_auto_48px] items-center gap-2.5 rounded-[8px] px-2 text-left hover:bg-background', tap)}>
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: COLORI_PAG[k] }} />
                <span className="text-sm font-medium">{l}</span>
                <span className="font-mono text-sm font-medium">{eu(v.X[k], 0)}</span>
                <span className="text-right font-mono text-xs text-muted-foreground">{pc(v.X[k], tot)}</span>
              </button>
            ))}
            <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-3">
              <button type="button" onClick={c.fumAsporto} className={cn('-m-1.5 flex flex-col rounded-[8px] p-1.5 text-left hover:bg-background', tap)}><span className="text-xs text-muted-foreground">di cui asporto</span><span className="font-mono text-[15px] font-medium">{eu(v.X.asp, 0)}</span></button>
              <button type="button" onClick={c.fumCoperti} className={cn('-m-1.5 flex flex-col rounded-[8px] p-1.5 text-left hover:bg-background', tap)}><span className="text-xs text-muted-foreground">Coperti medi / giorno</span><span className="font-mono text-[15px] font-medium">{fN(v.X.cop / (new Set(v.rows.map(r => r.data)).size || 1))}</span></button>
            </div>
          </Card>
        </div>
      </div>

      <Card titolo="Acquisti da fatture" sotto="fatture fornitori caricate · incidenza sul totale entrate" ritardo={300}>
        {fT <= 0 ? <p className="text-sm text-muted-foreground">Nessuna fattura con articoli caricata nel periodo.</p> : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-3">
              <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-[7px]">
                {(['fo', 'be', 'nf'] as const).map(k => <div key={k} className="transition-[width] duration-500" style={{ width: `${(c.gv(c.FA, k) / fT) * 100}%`, background: COLORI_FAT[k] }} />)}
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {([['Totale fatture', 'tot'], ['Food', 'fo'], ['Beverage', 'be'], ['No food', 'nf']] as const).map(([l, k]) => (
                  <button key={k} type="button" onClick={c.fumFattura(l, k)} className={cn('flex flex-col gap-1 rounded-[10px] bg-background px-3.5 py-3 text-left hover:brightness-[0.985]', tap)}>
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{k !== 'tot' && <span className="h-2 w-2 rounded-[2px]" style={{ background: COLORI_FAT[k] }} />}{l}</span>
                    <span className="whitespace-nowrap font-mono text-[18px] font-semibold tracking-[-.01em]">{eu(c.gv(c.FA, k), 0)}</span>
                    <span className="text-[11px] text-muted-foreground">{k === 'tot' ? `${pc(fT, tot)} delle entrate` : `${pc(c.gv(c.FA, k), fT)} degli acquisti`}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([[tel ? 'Food cost' : 'Food cost', 'fo', COLORI_FAT.fo], [tel ? 'Bev. cost' : 'Beverage cost', 'be', COLORI_FAT.be], [tel ? 'F&B cost' : 'Food & beverage cost', 'fb', 'var(--foreground)']] as const).map(([l, k, col]) => {
                const cv = tot ? (c.gv(c.FA, k) / tot) * 100 : 0, pv = v.P.ent ? (c.gv(c.FB, k) / v.P.ent) * 100 : null
                const dpt = pv === null ? null : cv - pv
                return (
                  <button key={k} type="button" onClick={c.fumIncidenza(l, k)} className={cn('flex flex-col gap-2 rounded-[10px] border border-border px-3.5 py-3 text-left hover:bg-background', tap)}>
                    <span className="text-xs font-medium text-muted-foreground">{l}</span>
                    <span className="font-mono text-[24px] font-semibold tracking-[-.02em]">{pc(c.gv(c.FA, k), tot)}</span>
                    <div className="relative h-1.5 rounded-full bg-secondary"><div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, (cv / 50) * 100)}%`, background: col }} /></div>
                    {dpt !== null && (
                      <span className={cn('flex items-center gap-[3px] self-start rounded-full px-[7px] py-0.5 font-mono text-[11px] font-semibold', dpt >= 0 ? TONO_PILLOLA.neg : TONO_PILLOLA.ok)}>
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
      </Card>

      <Card titolo="Confronto per ristorante" sotto="tocca una riga per il dettaglio" ritardo={360} piena>
        <div className="-mt-1 overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-max border-collapse">
            <thead>
              <tr className="border-t border-border bg-background text-xs text-muted-foreground">
                {['Ristorante', 'Giorni', 'Totale entrate', 'Contanti', 'POS', 'Bonifico', 'Asporto', 'Coperti', 'Media / giorno', 'Totale spese', 'Spese / giorno', 'Media scontrino', 'Margine operativo', 'Differenza'].map((h, i) => (
                  <th key={h} className={cn('whitespace-nowrap px-3 py-2.5 font-medium', i === 0 ? 'sticky left-0 z-[1] bg-background pl-4 text-left sm:pl-5' : 'text-right', i === 13 && 'pr-4 sm:pr-5')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...v.sedi].sort((p, q) => q.x.ent - p.x.ent).map(s => {
                const att = c.sel.length === 1 && c.sel[0] === s.l.id
                const mo = s.x.ent - s.x.sp, pari = Math.abs(s.x.dif) < 0.005
                const td = 'whitespace-nowrap px-3 text-right font-mono text-sm font-medium'
                return (
                  <tr key={s.l.id} onClick={() => c.apri({ k: 'loc', li: s.l.id })} className={cn('h-14 cursor-pointer border-t border-border hover:bg-background', att && 'bg-[oklch(0.96_0.02_180)] dark:bg-[oklch(0.25_0.03_180)]')}>
                    <td className={cn('sticky left-0 z-[1] pl-4 pr-3 sm:pl-5', att ? 'bg-[oklch(0.96_0.02_180)] dark:bg-[oklch(0.25_0.03_180)]' : 'bg-card')}>
                      <span className="flex items-center gap-2.5 whitespace-nowrap text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.l.colore }} />{s.l.nome}</span>
                    </td>
                    <td className={td}>{s.rs.length}</td>
                    <td className={td}>
                      <span className="flex flex-col items-end gap-1">{eu(s.x.ent, 0)}
                        <span className="flex h-1 w-full min-w-[110px] justify-end overflow-hidden rounded-full bg-secondary"><span className="rounded-full" style={{ width: `${(s.x.ent / maxEnt) * 100}%`, background: s.l.colore }} /></span>
                      </span>
                    </td>
                    <td className={td}>{eu(s.x.con, 0)}</td><td className={td}>{eu(s.x.pos, 0)}</td><td className={td}>{eu(s.x.bon, 0)}</td>
                    <td className={td}>{eu(s.x.asp, 0)}</td><td className={td}>{fN(s.x.cop)}</td><td className={td}>{eu(s.x.ent / (s.rs.length || 1), 0)}</td>
                    <td className={td}>{eu(s.x.sp)}</td><td className={td}>{eu(s.x.sp / (s.rs.length || 1))}</td>
                    <td className={td}>{s.x.cop ? eu(mediaScontrino(s.x)) : '—'}</td>
                    <td className={cn(td, mo >= 0 ? 'text-ok' : 'text-neg')}>{eu(mo, 0)}</td>
                    <td className={cn(td, 'pr-4 sm:pr-5', pari ? 'text-ok' : 'text-neg')}>{dV(s.x.dif)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card titolo="Giorni della settimana" sotto="entrate medie per locale" ritardo={420}>
          <div className="grid items-center gap-1" style={{ gridTemplateColumns: `${tel ? '72px' : '120px'} repeat(7, minmax(0, 1fr))` }}>
            <span />
            {ORD.map(w => {
              const ha = v.rows.some(r => giornoSett(r.data) === w)
              return (
                <button key={w} type="button" disabled={!ha} onClick={c.fumGiornoSett(null, w)} className={cn('flex h-8 items-center justify-center rounded-[6px] text-xs font-medium text-foreground/80 hover:bg-secondary disabled:cursor-default', tap)}>{WD[w]}</button>
              )
            })}
            {heat.map(h => (
              <div key={h.l.id} className="contents">
                <span className="truncate text-[13px] font-medium">{h.l.nome}</span>
                {h.m.map((x, q) => {
                  if (x === null) return <div key={q} className="flex h-11 items-center justify-center rounded-[6px] font-mono text-xs text-muted-foreground" style={{ background: 'repeating-linear-gradient(45deg, var(--secondary) 0 6px, var(--background) 6px 12px)' }}>—</div>
                  const tt = hmx === hmn ? 1 : (x - hmn) / (hmx - hmn)
                  return (
                    <button key={q} type="button" onClick={c.fumGiornoSett(h.l.id, ORD[q])}
                      className={cn('flex h-11 items-center justify-center rounded-[6px] font-mono text-[11px] font-medium sm:text-xs', tap)}
                      style={{ background: `oklch(${(0.95 - tt * 0.4).toFixed(3)} ${(0.03 + tt * 0.09).toFixed(3)} 180)`, color: tt > 0.55 ? '#fff' : 'oklch(0.2 0.01 250)' }}>
                      {k1(x)}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </Card>
        <Card ritardo={480} sotto={`oltre ${SOGLIA_DIFFERENZA} € per almeno ${MIN_GIORNI_ALERT} giorni`}
          titolo={<span className="flex items-center gap-2"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={alerts.length ? 'text-neg' : 'text-ok'} aria-hidden><path d="M12 4l9 16H3z" /><path d="M12 10v4" /><path d="M12 17.5v.01" /></svg>Differenze ricorrenti</span>}>
          {alerts.length === 0 ? (
            <div className="flex min-h-[120px] flex-1 items-center justify-center rounded-[8px] bg-ok-tint text-sm font-medium text-ok">Nessun locale oltre soglia nel periodo</div>
          ) : alerts.map(x => {
            const t = sum(x.rs, r => r.dif)
            return (
              <button key={x.s.l.id} type="button" onClick={() => c.apri({ k: 'alert', li: x.s.l.id })} className={cn('flex flex-col gap-2 rounded-[8px] bg-neg-tint px-3.5 py-3 text-left', tap)}>
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[15px] font-semibold text-neg">{x.s.l.nome} · {x.rs.length} giorni</span>
                  <span className="font-mono text-xs font-medium text-neg">media {sgn(t / x.rs.length)} · totale {sgn(t)}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {x.rs.slice(0, 14).map(r => <span key={r.id} className="rounded-full bg-card px-2 py-[3px] font-mono text-[11px] font-medium text-neg">{r.data.slice(8)}/{r.data.slice(5, 7)}</span>)}
                  {x.rs.length > 14 && <span className="rounded-full bg-card px-2 py-[3px] font-mono text-[11px] font-medium text-neg">+{x.rs.length - 14}</span>}
                </span>
              </button>
            )
          })}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card titolo="Spese per categoria" sotto="pagate in contanti dalle chiusure" ritardo={540}>
          {cats.length === 0 ? <p className="text-sm text-muted-foreground">Nessuna spesa di cassa nel periodo.</p> : (
            <div className="grid items-center gap-5 sm:grid-cols-[170px_1fr]">
              <div className="relative h-[170px] w-[170px] justify-self-center">
                <svg width="170" height="170" viewBox="0 0 170 170" className="-rotate-90" aria-hidden>
                  <circle cx="85" cy="85" r="66" fill="none" stroke="var(--secondary)" strokeWidth="22" />
                  {cats.map((k, i) => {
                    const off = sum(cats.slice(0, i), x => (x.t / totSp) * CIRC), len = (k.t / totSp) * CIRC
                    return <circle key={k.c} cx="85" cy="85" r="66" fill="none" stroke={k.col} strokeWidth="22" strokeDasharray={`${Math.max(0, len - 2)} ${CIRC}`} strokeDashoffset={-off} className="cursor-pointer" onClick={c.fumCategoria(k.c, c.dati.spA, true)} />
                  })}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                  <span className="text-xs text-muted-foreground">Totale</span>
                  <span className="font-mono text-[17px] font-semibold">{eu(totSp)}</span>
                </div>
              </div>
              <div className="flex flex-col">
                {cats.map(k => (
                  <button key={k.c} type="button" onClick={c.fumCategoria(k.c, c.dati.spA, true)} className={cn('-mx-2 grid min-h-10 grid-cols-[12px_1fr_auto_40px] items-center gap-2.5 rounded-[8px] px-2 text-left hover:bg-background', tap)}>
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: k.col }} />
                    <span className="truncate text-sm">{k.c}</span>
                    <span className="font-mono text-sm font-medium">{eu(k.t)}</span>
                    <span className="text-right font-mono text-xs text-muted-foreground">{Math.round((k.t / totSp) * 100)}%</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Card titolo="Vendite per categoria" sotto="dal report di chiusura" ritardo={600}>
          {vendite.length === 0 ? <p className="text-sm text-muted-foreground">Nessun report vendite caricato nel periodo.</p> : (
            <div className="flex flex-col">
              {vendite.map(([cat, val], i) => (
                <button key={cat} type="button" onClick={c.fumCategoria(cat, c.dati.veA, false)} className={cn('-mx-2 grid min-h-11 items-center gap-x-3 rounded-[8px] px-2 text-left hover:bg-background', tap, tel ? 'grid-cols-[76px_minmax(0,1fr)_84px_36px]' : 'grid-cols-[96px_1fr_96px_40px]')}>
                  <span className="truncate text-sm">{cat}</span>
                  <span className="h-2 rounded-full bg-secondary"><span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${(val / vendite[0][1]) * 100}%`, background: i ? `oklch(${(0.62 + Math.min(i, 6) * 0.05).toFixed(2)} ${(0.12 - Math.min(i, 6) * 0.012).toFixed(3)} 180)` : TEAL }} /></span>
                  <span className="text-right font-mono text-sm font-medium">{eu(val, 0)}</span>
                  <span className="text-right font-mono text-xs text-muted-foreground">{Math.round((val / totVe) * 100)}%</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

// ── Vista di confronto A contro B ───────────────────────────────────

function Legenda() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className="rounded-full bg-[oklch(0.58_0.12_180)] px-[5px] py-px text-[9px] font-semibold text-white">A</span>Periodo A</span>
      <span className="flex items-center gap-1.5"><PillolaB />Periodo B</span>
    </div>
  )
}

function Delta({ d }: { d: { testo: string; tono: Tono } }) {
  return <span className={cn('whitespace-nowrap rounded-full px-[7px] py-0.5 font-mono text-[11px] font-semibold', TONO_PILLOLA[d.tono])}>{d.testo}</span>
}

function RigaAB({ l, a, b, wa, wb, d, onClick, dot }: { l: string; a: string; b: string; wa: number; wb: number; d: { testo: string; tono: Tono }; onClick?: (e: React.MouseEvent<Element>) => void; dot?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn('-mx-2 grid min-h-12 grid-cols-[minmax(0,110px)_minmax(0,1fr)_auto_64px] items-center gap-3 rounded-[8px] px-2 text-left hover:bg-background', tap)}>
      <span className="flex min-w-0 items-center gap-2 truncate text-sm font-medium">{dot && <span className="h-2 w-2 flex-none rounded-[2px]" style={{ background: dot }} />}{l}</span>
      <BarreAB wa={wa} wb={wb} colore={dot} />
      <span className="flex flex-col items-end font-mono text-[13px]"><span className="font-medium">{a}</span><span className="text-muted-foreground">{b}</span></span>
      <span className="flex justify-end"><Delta d={d} /></span>
    </button>
  )
}

function VistaConfronto({ c, onCambia, onSpegni }: { c: Ctx; onCambia: () => void; onSpegni: () => void }) {
  const { v, MET, tel } = c
  const X = v.X, P = v.P
  const et = etichetteSerie(c)
  const nA = new Set(v.rows.map(r => r.data)).size, nB = new Set(v.prev.map(r => r.data)).size
  const nDurA = giorni(c.a, c.b), nDurB = giorni(c.B.a, c.B.b)
  const pw = (x: number, y: number, m?: number) => { const mm = m || Math.max(Math.abs(x), Math.abs(y)) || 1; return { wa: (Math.abs(x) / mm) * 100, wb: (Math.abs(y) / mm) * 100 } }
  const he = delta(X.ent, P.ent, 'su')
  const giorniOrd = (rs: Chiusura[]) => { const g = new Map<string, number>(); for (const r of rs) g.set(r.data, (g.get(r.data) ?? 0) + r.ent); return [...g.entries()].sort((p, q) => q[1] - p[1]) }
  const dA = giorniOrd(v.rows), dB = giorniOrd(v.prev)
  const labB = (d: string) => fdl(d) + (c.cmp === 'yoy' ? ` ${d.slice(0, 4)}` : '')
  let vinti = 0, conf = 0
  v.bk.forEach((_, j) => { const ta = sum(v.ser[j], x => x); if (v.cbk[j] && (ta || v.serB[j])) { conf++; if (ta > v.serB[j]) vinti++ } })
  const tipoB = { prev: 'periodo precedente', yoy: 'anno prima', custom: 'personalizzato' }[c.cmp ?? 'prev']
  const totA = v.ser.map(x => sum(x, y => y))

  const TG: [string, (x: Aggregato) => number, (x: number) => string, 'su' | 'giu'][] = [
    ['Entrate', x => x.ent, x => eu(x, 0), 'su'], ['Spese', x => x.sp, x => eu(x, 0), 'giu'], ['Margine', x => x.ent - x.sp, x => eu(x, 0), 'su'],
    ['Coperti', x => x.cop, fN, 'su'], ['Media scontrino', x => mediaScontrino(x), x => (x ? eu(x) : '—'), 'su'],
  ]
  const catA = (cat: string) => sum(c.dati.spA.filter(x => x.categoria === cat), x => x.importo), catB = (cat: string) => sum(c.dati.spB.filter(x => x.categoria === cat), x => x.importo)
  const sM = Math.max(...v.categorie.map(k => Math.max(catA(k.c), catB(k.c))), 1)
  const venCat = [...new Set([...c.dati.veA, ...c.dati.veB].map(x => x.categoria))]
  const vA = (cat: string) => sum(c.dati.veA.filter(x => x.categoria === cat), x => x.importo), vB = (cat: string) => sum(c.dati.veB.filter(x => x.categoria === cat), x => x.importo)
  const vM = Math.max(...venCat.map(k => Math.max(vA(k), vB(k))), 1)
  const fM = Math.max(c.gv(c.FA, 'tot'), c.gv(c.FB, 'tot'), 1)

  return (
    <>
      <div className="anim-swapin grid gap-3 rounded-[12px] border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_230px_minmax(0,1fr)] md:items-center">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-[oklch(0.58_0.12_180)] text-[23px] font-semibold text-white">A</span>
          <div className="flex min-w-0 flex-col"><span className="text-xs text-muted-foreground">Periodo A · analizzato</span><span className="text-[15px] font-semibold">{intervallo(c.a, c.b)}</span><span className="text-xs text-muted-foreground">{nA} giorni · {v.rows.length} chiusure</span></div>
        </div>
        <div className="flex flex-col items-center gap-0.5 rounded-[10px] bg-background px-3 py-2.5 text-center">
          <span className="text-xs text-muted-foreground">Entrate di A rispetto a B</span>
          <span className={cn('font-mono text-[22px] font-semibold', TONO_TESTO[he.tono])}>{he.testo}</span>
          <span className="font-mono text-xs text-muted-foreground">{X.ent - P.ent >= 0 ? '+' : '−'}{eu(Math.abs(X.ent - P.ent), 0)}</span>
        </div>
        <div className="flex items-center gap-3 md:justify-end">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/60 text-[23px] font-semibold text-muted-foreground">B</span>
          <div className="flex min-w-0 flex-1 flex-col md:flex-none"><span className="text-xs text-muted-foreground">Periodo B · {tipoB}</span><span className="text-[15px] font-semibold">{intervallo(c.B.a, c.B.b)}</span><span className="text-xs text-muted-foreground">{nB} giorni · {v.prev.length} chiusure</span></div>
          <button type="button" onClick={onCambia} className="h-10 rounded-[10px] border border-line-strong px-3 text-[13px] font-medium active:scale-[0.97]">Cambia</button>
          <button type="button" onClick={onSpegni} aria-label="Togli il confronto" className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground active:scale-[0.96]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
      <span className="-mt-2 text-xs text-muted-foreground">
        {nDurA !== nDurB ? `A e B hanno durate diverse (${nDurA} e ${nDurB} giorni): nei grafici il 1° giorno di A sta accanto al 1° di B, e così via.` : 'Stessa durata: nei grafici ogni giorno di A sta accanto al corrispondente giorno di B.'}
      </span>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {MET.map((m, i) => {
          const va = m.f(v.rows), vb = m.f(v.prev), pwv = pw(va, vb)
          const d = m.ass ? delta(Math.abs(va), Math.abs(vb), 'giu') : delta(va, vb, m.buono)
          return (
            <button key={m.l} type="button" onClick={() => c.apri({ k: 'kpi', i })} className={cn('anim-swapin flex flex-col gap-2 rounded-[12px] border border-border bg-card px-4 py-3.5 text-left', tap)} style={{ animationDelay: `${i * 50}ms` }}>
              <span className="flex items-center justify-between gap-2"><span className="truncate text-[13px] font-medium text-muted-foreground">{m.l}</span><Delta d={d} /></span>
              <span className="flex items-center gap-2"><span className="rounded-full bg-[oklch(0.58_0.12_180)] px-[5px] py-px text-[9px] font-semibold text-white">A</span><span className="font-mono text-[17px] font-semibold">{m.fmt(va)}</span></span>
              <div className="h-1.5 rounded-full bg-secondary"><div className="h-full rounded-full bg-[oklch(0.58_0.12_180)]" style={{ width: `${pwv.wa}%` }} /></div>
              <span className="flex items-center gap-2"><PillolaB /><span className="font-mono text-[14px] text-muted-foreground">{m.fmt(vb)}</span></span>
              <div className="h-1.5 rounded-full bg-secondary"><div className="h-full rounded-full bg-muted-foreground/30" style={{ width: `${pwv.wb}%` }} /></div>
              <span className="font-mono text-[11px] text-muted-foreground">{va - vb >= 0 ? '+' : '−'}{i === 4 ? fN(Math.abs(va - vb)) : eu(Math.abs(va - vb), i >= 3 ? 2 : 0)}<span className="font-sans"> rispetto a B</span></span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card titolo="Entrate A e B" sotto={v.mensile ? 'per mese · A a sinistra, B a destra' : 'per giorno · A a sinistra, B a destra'} destra={<Legenda />}>
          <GraficoEntrate affiancate asse={v.bk.map(k => k.asse)} etichette={et} locali={v.presenti} ser={v.ser} serB={v.serB} etichetteB={v.bk.map((_, j) => c.etichettaB(v.cbk[j]))}
            onApri={j => c.apri(v.mensile ? { k: 'month', j } : { k: 'day', d: v.bk[j].a })} />
        </Card>
        <Card titolo="Entrate cumulate" sotto="chi è avanti, giorno dopo giorno">
          <Cumulata a={totA} b={v.serB.slice(0, v.cbk.length)} fmt={x => eu(x, 0)} etichetta={j => `Dopo ${j + 1} ${v.mensile ? (j ? 'mesi' : 'mese') : (j ? 'giorni' : 'giorno')}`} />
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col rounded-[10px] bg-background px-3 py-2"><span className="text-xs text-muted-foreground">Totale A</span><span className="font-mono text-[15px] font-semibold">{eu(X.ent, 0)}</span></div>
            <div className="flex flex-col rounded-[10px] bg-background px-3 py-2"><span className="text-xs text-muted-foreground">Totale B</span><span className="font-mono text-[15px] font-semibold text-muted-foreground">{eu(P.ent, 0)}</span></div>
          </div>
          <span className="flex items-center justify-between text-sm font-medium">{X.ent - P.ent >= 0 ? `A è avanti di ${eu(X.ent - P.ent, 0)}` : `A è indietro di ${eu(P.ent - X.ent, 0)}`}<Delta d={he} /></span>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card titolo="Sintesi" sotto="i numeri chiave affiancati">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_66px] gap-x-3 text-xs text-muted-foreground"><span /><span>Periodo A</span><span>Periodo B</span><span className="text-right">A vs B</span></div>
          {[
            { l: 'Entrate medie al giorno', a: eu(X.ent / (nA || 1), 0), b: eu(P.ent / (nB || 1), 0), d: delta(X.ent / (nA || 1), P.ent / (nB || 1), 'su') },
            { l: 'Coperti medi al giorno', a: fN(X.cop / (nA || 1)), b: fN(P.cop / (nB || 1)), d: delta(X.cop / (nA || 1), P.cop / (nB || 1), 'su') },
            { l: 'Giorno migliore', a: dA[0] ? eu(dA[0][1], 0) : '—', as: dA[0] ? fdl(dA[0][0]) : '', b: dB[0] ? eu(dB[0][1], 0) : '—', bs: dB[0] ? labB(dB[0][0]) : '', d: delta(dA[0]?.[1] ?? 0, dB[0]?.[1] ?? 0, 'su'), onA: dA[0] ? () => c.apri({ k: 'day', d: dA[0][0] }) : undefined, onB: dB[0] ? () => c.apri({ k: 'day', d: dB[0][0], src: 'B' }) : undefined },
            { l: 'Giorno peggiore', a: dA.at(-1) ? eu(dA.at(-1)![1], 0) : '—', as: dA.at(-1) ? fdl(dA.at(-1)![0]) : '', b: dB.at(-1) ? eu(dB.at(-1)![1], 0) : '—', bs: dB.at(-1) ? labB(dB.at(-1)![0]) : '', d: delta(dA.at(-1)?.[1] ?? 0, dB.at(-1)?.[1] ?? 0, 'su'), onA: dA.at(-1) ? () => c.apri({ k: 'day', d: dA.at(-1)![0] }) : undefined, onB: dB.at(-1) ? () => c.apri({ k: 'day', d: dB.at(-1)![0], src: 'B' }) : undefined },
          ].map(r => (
            <div key={r.l} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_66px] items-center gap-x-3 border-t border-border py-2.5">
              <span className="text-sm">{r.l}</span>
              <button type="button" disabled={!r.onA} onClick={r.onA} className={cn('flex flex-col text-left disabled:cursor-default', r.onA && tap)}><span className="font-mono text-sm font-medium">{r.a}</span>{r.as && <span className="text-[11px] text-muted-foreground">{r.as}</span>}</button>
              <button type="button" disabled={!r.onB} onClick={r.onB} className={cn('flex flex-col text-left disabled:cursor-default', r.onB && tap)}><span className="font-mono text-sm text-muted-foreground">{r.b}</span>{r.bs && <span className="text-[11px] text-muted-foreground">{r.bs}</span>}</button>
              <span className="flex justify-end"><Delta d={r.d} /></span>
            </div>
          ))}
          <div className="flex flex-col gap-1.5 rounded-[10px] bg-background px-3.5 py-3">
            <span className="flex items-baseline gap-2"><span className="font-mono text-[17px] font-semibold">{vinti} su {conf}</span><span className="text-xs text-muted-foreground">{v.mensile ? 'mesi' : 'giorni'} in cui A ha incassato più di B</span></span>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted-foreground/25"><div className="rounded-full bg-[oklch(0.58_0.12_180)]" style={{ width: `${conf ? (vinti / conf) * 100 : 0}%` }} /></div>
          </div>
        </Card>
        <Card titolo="Pagamenti" destra={<Legenda />}>
          {(() => {
            const PY = [['POS', 'pos'], ['Contanti', 'con'], ['Bonifico', 'bon'], ['Asporto', 'asp']] as const
            const pM = Math.max(...PY.map(([, k]) => Math.max(X[k], P[k])), 1)
            return PY.map(([l, k]) => <RigaAB key={k} l={l} a={eu(X[k], 0)} b={eu(P[k], 0)} {...pw(X[k], P[k], pM)} d={delta(X[k], P[k], 'su')} onClick={k === 'asp' ? c.fumAsporto : c.fumPagamento(l, k)} />)
          })()}
        </Card>
      </div>

      <Card titolo="Ristoranti" sotto="A contro B · tocca una riga per il dettaglio" destra={<Legenda />} piena>
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-t border-border bg-background text-xs text-muted-foreground">
                <th className="sticky left-0 z-[1] bg-background pl-4 pr-3 text-left font-medium sm:pl-5" />
                {TG.map(g => <th key={g[0]} colSpan={3} className="border-l border-border px-3 pt-2 text-center font-medium">{g[0]}</th>)}
              </tr>
              <tr className="bg-background text-[10px] text-muted-foreground">
                <th className="sticky left-0 z-[1] bg-background py-1.5 pl-4 pr-3 text-left text-xs font-medium sm:pl-5">Ristorante</th>
                {TG.map(g => ['A', 'B', 'Δ'].map((x, q) => <th key={g[0] + x} className={cn('px-2.5 py-1.5 text-right font-semibold', q === 0 && 'border-l border-border')}>{x}</th>))}
              </tr>
            </thead>
            <tbody>
              {[...v.sedi.map(s => ({ id: s.l.id, n: s.l.nome, col: s.l.colore, xa: s.x, xb: s.y, tot: false })), { id: '_t', n: 'Totale', col: '', xa: X, xb: P, tot: true }].map(r => (
                <tr key={r.id} onClick={r.tot ? undefined : () => c.apri({ k: 'loc', li: r.id })} className={cn('h-12 border-t border-border', r.tot ? 'bg-background font-semibold' : 'cursor-pointer hover:bg-background')}>
                  <td className={cn('sticky left-0 z-[1] whitespace-nowrap pl-4 pr-3 sm:pl-5', r.tot ? 'bg-background' : 'bg-card')}>
                    <span className="flex items-center gap-2 font-semibold">{r.col && <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: r.col }} />}{r.n}</span>
                  </td>
                  {TG.map(([l, f, fm, bu]) => { const va = f(r.xa), vb = f(r.xb), d = delta(va, vb, bu); return [
                    <td key={l + 'a'} className="whitespace-nowrap border-l border-border px-2.5 text-right font-mono font-medium">{fm(va)}</td>,
                    <td key={l + 'b'} className="whitespace-nowrap px-2.5 text-right font-mono text-muted-foreground">{r.xb.ent ? fm(vb) : '—'}</td>,
                    <td key={l + 'd'} className={cn('whitespace-nowrap px-2.5 text-right font-mono text-xs font-semibold', TONO_TESTO[d.tono])}>{d.testo}</td>,
                  ] })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card titolo="Acquisti da fatture" sotto="importi e incidenza sulle entrate di ciascun periodo" destra={<Legenda />}>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col">
            {([['Totale fatture', 'tot'], ['Food', 'fo'], ['Beverage', 'be'], ['No food', 'nf']] as const).map(([l, k]) => (
              <RigaAB key={k} l={l} a={eu(c.gv(c.FA, k), 0)} b={eu(c.gv(c.FB, k), 0)} {...pw(c.gv(c.FA, k), c.gv(c.FB, k), fM)} d={delta(c.gv(c.FA, k), c.gv(c.FB, k), 'giu')} onClick={c.fumFattura(l, k)} dot={k === 'tot' ? undefined : COLORI_FAT[k]} />
            ))}
          </div>
          <div className="flex flex-col">
            {(() => {
              const FP = ([['Food cost', 'fo'], ['Beverage cost', 'be'], ['F&B cost', 'fb']] as const).map(([l, k]) => ({ l, k, pa: X.ent ? (c.gv(c.FA, k) / X.ent) * 100 : 0, pb: P.ent ? (c.gv(c.FB, k) / P.ent) * 100 : 0 }))
              const ppM = Math.max(...FP.map(x => Math.max(x.pa, x.pb)), 1)
              return FP.map(x => {
                const dd = x.pa - x.pb, piatto = Math.abs(dd) < 0.05
                return <RigaAB key={x.k} l={x.l} a={`${x.pa.toFixed(1).replace('.', ',')}%`} b={`${x.pb.toFixed(1).replace('.', ',')}%`} {...pw(x.pa, x.pb, ppM)} d={{ testo: `${dd >= 0 ? '+' : '−'}${Math.abs(dd).toFixed(1).replace('.', ',')} pt`, tono: piatto ? 'neutro' : dd < 0 ? 'ok' : 'neg' }} onClick={c.fumIncidenza(x.l, x.k)} />
              })
            })()}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card titolo="Giorni della settimana" sotto="media entrate di A rispetto a B">
          <div className="grid items-center gap-1" style={{ gridTemplateColumns: `${tel ? '72px' : '120px'} repeat(7, minmax(0, 1fr))` }}>
            <span />{ORD.map(w => <span key={w} className="py-1.5 text-center text-xs font-medium text-muted-foreground">{WD[w]}</span>)}
            {v.locSel.map(l => (
              <div key={l.id} className="contents">
                <span className="truncate text-[13px] font-medium">{l.nome}</span>
                {ORD.map(w => {
                  const ra = v.rows.filter(r => r.li === l.id && giornoSett(r.data) === w), rb = v.prev.filter(r => r.li === l.id && giornoSett(r.data) === w)
                  if (!ra.length || !rb.length) return <div key={w} className="flex h-11 items-center justify-center rounded-[6px] font-mono text-xs text-muted-foreground" style={{ background: 'repeating-linear-gradient(45deg, var(--secondary) 0 6px, var(--background) 6px 12px)' }}>—</div>
                  const ma = sum(ra, r => r.ent) / ra.length, mb = sum(rb, r => r.ent) / rb.length, pv = ((ma - mb) / mb) * 100, tt = Math.min(1, Math.abs(pv) / 25), pos = pv >= 0
                  return (
                    <button key={w} type="button"
                      onClick={c.fumetto(`${l.nome} · ${WDL[w].toLowerCase()}`, 'media entrate, A contro B', [
                        { l: `Periodo A · ${ra.length} giorni`, v: eu(ma, 0), dot: TEAL }, { l: `Periodo B · ${rb.length} giorni`, v: eu(mb, 0), dot: 'oklch(0.76 0.012 250)' },
                        { l: 'Differenza', v: `${ma >= mb ? '+' : '−'}${eu(Math.abs(ma - mb), 0)}`, tono: ma >= mb ? 'ok' : 'neg', p: `${pos ? '+' : '−'}${Math.abs(pv).toFixed(1).replace('.', ',')}%` },
                      ])}
                      className={cn('flex h-11 flex-col items-center justify-center rounded-[6px] font-mono', tap)}
                      style={{ background: `oklch(${(0.96 - tt * 0.34).toFixed(3)} ${(0.02 + tt * 0.09).toFixed(3)} ${pos ? 150 : 25})`, color: tt > 0.6 ? '#fff' : 'oklch(0.2 0.01 250)' }}>
                      <span className="text-[11px] font-semibold sm:text-xs">{pos ? '+' : '−'}{Math.abs(pv).toFixed(0)}%</span>
                      <span className="text-[9px] opacity-75">{k1(ma)}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[oklch(0.75_0.09_25)]" />A sotto B<span className="h-2.5 w-2.5 rounded-[3px] bg-[oklch(0.75_0.09_150)]" />A sopra B<span>· in piccolo la media di A</span>
          </span>
        </Card>
        <Card titolo="Spese per categoria" sotto="pagate in contanti dalle chiusure" destra={<Legenda />}>
          {v.categorie.length === 0 ? <p className="text-sm text-muted-foreground">Nessuna spesa di cassa nei due periodi.</p>
            : v.categorie.map(k => <RigaAB key={k.c} l={k.c} dot={k.col} a={eu(catA(k.c), 0)} b={eu(catB(k.c), 0)} {...pw(catA(k.c), catB(k.c), sM)} d={delta(catA(k.c), catB(k.c), 'giu')} onClick={c.fumCategoria(k.c, c.dati.spA, true)} />)}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card titolo="Vendite per categoria" sotto="dal report di chiusura" destra={<Legenda />}>
          {venCat.length === 0 ? <p className="text-sm text-muted-foreground">Nessun report vendite nei due periodi.</p>
            : venCat.sort((p, q) => vA(q) - vA(p)).map(k => <RigaAB key={k} l={k} a={eu(vA(k), 0)} b={eu(vB(k), 0)} {...pw(vA(k), vB(k), vM)} d={delta(vA(k), vB(k), 'su')} onClick={c.fumCategoria(k, c.dati.veA, false)} />)}
        </Card>
        <Card titolo="Differenze di cassa" sotto={`totale per locale · giorni oltre ${SOGLIA_DIFFERENZA} €`}>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_62px] gap-x-3 text-xs text-muted-foreground"><span /><span>Periodo A</span><span>Periodo B</span><span className="text-right">A vs B</span></div>
          {v.sedi.map(s => {
            const ga = s.rs.filter(r => Math.abs(r.dif) >= SOGLIA_DIFFERENZA).length, gb = v.prev.filter(r => r.li === s.l.id && Math.abs(r.dif) >= SOGLIA_DIFFERENZA).length
            const d = delta(Math.abs(s.x.dif), Math.abs(s.y.dif), 'giu')
            return (
              <button key={s.l.id} type="button" onClick={() => c.apri(ga >= MIN_GIORNI_ALERT ? { k: 'alert', li: s.l.id } : { k: 'loc', li: s.l.id })}
                className={cn('-mx-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_62px] items-center gap-x-3 rounded-[8px] border-t border-border px-2 py-2.5 text-left hover:bg-background', tap)}>
                <span className="flex min-w-0 items-center gap-2 truncate text-sm font-medium"><span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: s.l.colore }} />{s.l.nome}</span>
                <span className="flex flex-col"><span className={cn('font-mono text-sm font-medium', Math.abs(s.x.dif) < 0.005 ? 'text-ok' : 'text-neg')}>{dV(s.x.dif)}</span><span className="text-[11px] text-muted-foreground">{ga} {ga === 1 ? 'giorno' : 'giorni'} oltre soglia</span></span>
                <span className="flex flex-col"><span className={cn('font-mono text-sm', Math.abs(s.y.dif) < 0.005 ? 'text-ok' : 'text-neg')}>{dV(s.y.dif)}</span><span className="text-[11px] text-muted-foreground">{gb} {gb === 1 ? 'giorno' : 'giorni'} oltre soglia</span></span>
                <span className="flex justify-end"><Delta d={d} /></span>
              </button>
            )
          })}
        </Card>
      </div>
    </>
  )
}
