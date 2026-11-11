'use client'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { coloreLocale, coloreTenue } from '@/components/manager/RestaurantFilter'
import { cassaChartColor } from '@/components/cassa/chartPalette'
import { CassaFileViewer } from '@/components/cassa/CassaFileViewer'
import { AnalisiAiDialog } from '@/components/cassa/AnalisiAiDialog'
import { aggrega, buckets, inBucket, etichettaBucket, mediaScontrino, giorni, piuGiorni, unAnnoPrima, giornoSett, eu, dV, fN, pc, fd, fdg, fdl, intervallo, capit, MESI, WDL, SOGLIA_DIFFERENZA, type Chiusura, type Voce, type Acquisto, type Aggregato, type Tono, type Bucket } from '@/lib/analisi'
import { caricaChiusure, caricaVoci, caricaAcquisti, caricaFornitori } from '@/components/cassa/analisi/dati'
import { FoglioDettaglio, FumettoAncorato, USCITA_MS, type Scheda, type Riga, type Sotto, type Fumetto, type RigaFumetto } from '@/components/cassa/analisi/Sovrapposizioni'
import type { Ctx, Nodo, Dati } from '@/components/cassa/analisi/tipi'
import { VistaConfronto } from '@/components/cassa/analisi/VistaConfronto'
import { BarraPeriodo, MenuConfronto, PulsanteEsporta, type Periodo, type ModoConfronto, type Intervallo } from '@/components/cassa/analisi/Filtri'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { ScheletroForma } from '@/components/shared/ScheletroForma'
import { useScheletro } from '@/components/shared/useScheletro'
import { VistaNormale } from '@/components/cassa/analisi/VistaNormale'
import { impostaSottotitolo, impostaAssistente } from '@/components/shell/intestazioneDinamica'

// Analisi cassa del manager (design Manager Analisi). Tutto si tocca:
// locali, periodo, KPI, giorni del grafico, righe delle tabelle, celle
// della mappa settimanale, categorie e acquisti. I dettagli lunghi si
// aprono nel foglio laterale (a pila, con indietro), quelli brevi in un
// fumetto accanto all'elemento toccato.

const TZ = 'Europe/Rome'
const TEAL = 'oklch(0.58 0.12 180)'

interface Props { restaurants: { id: string; name: string }[]; nome?: string }

const VUOTO: Dati = { A: [], B: [], spA: [], spB: [], veA: [], veB: [], acA: [], acB: [], foA: [], foB: [] }

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

/** Chiave dei dati da caricare per una combinazione di filtri. */
function chiaveDati(p: Periodo, cmp: ModoConfronto, cmpC: Intervallo | null, sel: string[], restaurants: { id: string }[], oggi: string): string {
  const { a, b } = intervalloPeriodo(p, oggi)
  const n = giorni(a, b)
  const B = cmp === 'yoy' ? { a: unAnnoPrima(a), b: unAnnoPrima(b) } : cmp === 'custom' && cmpC ? cmpC : { a: piuGiorni(a, -n), b: piuGiorni(a, -1) }
  return [a, b, B.a, B.b, (sel.length ? sel : restaurants.map(r => r.id)).join(',')].join('|')
}

// Telefono o tablet: alcune etichette si accorciano come nel design.
function useTelefono() {
  return useSyncExternalStore(
    cb => { const mq = window.matchMedia('(max-width: 639px)'); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb) },
    () => window.matchMedia('(max-width: 639px)').matches,
    () => false
  )
}
export function AnalisiClient({ restaurants, nome }: Props) {
  const tel = useTelefono()
  const [sel, setSelStato] = useState<string[]>([])
  const [periodo, setPeriodoStato] = useState<Periodo>({ k: 'mese' })
  const [cmp, setCmpStato] = useState<ModoConfronto>(null)
  const [cmpC, setCmpC] = useState<Intervallo | null>(null)

  // Scheletro del design: a ogni cambio di locali, periodo o confronto il
  // contenuto diventa la sua sagoma con l'onda, poi si dissolve.
  const { stato: sk, avvia: avviaScheletro, pronto: scheletroPronto } = useScheletro()
  const [dati, setDati] = useState<Dati>(VUOTO)
  const [stato, setStato] = useState<'carica' | 'ok' | 'errore' | 'riprova'>('carica')
  const [pila, setPila] = useState<Nodo[]>([])
  const [pilaEsce, setPilaEsce] = useState(false)
  const [fum, setFum] = useState<Fumetto | null>(null)
  const [fumEsce, setFumEsce] = useState(false)
  const apriConfronto = useRef<(() => void) | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [esporta, setEsporta] = useState<'pdf' | 'xlsx' | null>(null)

  const [oggi] = useState(oggiRoma)
  const { a, b } = intervalloPeriodo(periodo, oggi)
  const n = giorni(a, b)
  const B: Intervallo = cmp === 'yoy' ? { a: unAnnoPrima(a), b: unAnnoPrima(b) }
    : cmp === 'custom' && cmpC ? cmpC
    : { a: piuGiorni(a, -n), b: piuGiorni(a, -1) }

  const locali = useMemo(() => restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i), tenue: coloreTenue(coloreLocale(i)) })), [restaurants])
  const nomeLoc = useMemo(() => Object.fromEntries(locali.map(l => [l.id, l])), [locali])
  const target = useMemo(() => (sel.length ? sel : locali.map(l => l.id)), [sel, locali])
  const chiaveTarget = target.join(',')
  // Se il cambio non tocca i dati da caricare (es. confronto col periodo
  // precedente, già caricato per le variazioni) non parte nessuna richiesta:
  // lo scheletro va avvisato subito che i dati sono pronti.
  const chiaveCaricata = useRef('')
  const cambia = (prossima: string) => { avviaScheletro(); if (prossima === chiaveCaricata.current) scheletroPronto() }
  const setSel = (x: string[]) => { cambia(chiaveDati(periodo, cmp, cmpC, x, restaurants, oggi)); setSelStato(x) }
  const setPeriodo = (x: Periodo) => { cambia(chiaveDati(x, cmp, cmpC, sel, restaurants, oggi)); setPeriodoStato(x) }
  const setCmp = (x: ModoConfronto) => { cambia(chiaveDati(periodo, x, cmpC, sel, restaurants, oggi)); setCmpStato(x) }

  const mesi = useMemo(() => {
    const [y, m] = oggi.split('-').map(Number)
    return [1, 2, 3].map(q => { const d = new Date(Date.UTC(y, m - 1 - q, 1)); return { k: d.toISOString().slice(0, 7), l: capit(MESI[d.getUTCMonth()]) } })
  }, [oggi])

  // ── Caricamento ────────────────────────────────────────────────────
  const req = useRef(0)
  const carica = useCallback(async () => {
    const mio = ++req.current
    const chiave = [a, b, B.a, B.b, chiaveTarget].join('|')
    const sb = createClient()
    const ids = chiaveTarget ? chiaveTarget.split(',') : []
    try {
    const [A, Bc, acA, acB, foA, foB] = await Promise.all([
      caricaChiusure(sb, ids, a, b), caricaChiusure(sb, ids, B.a, B.b),
      caricaAcquisti(sb, ids, a, b), caricaAcquisti(sb, ids, B.a, B.b),
      caricaFornitori(sb, ids, a, b), caricaFornitori(sb, ids, B.a, B.b),
    ])
    const [spA, spB, veA, veB] = await Promise.all([
      caricaVoci(sb, A.righe, 'spese'), caricaVoci(sb, Bc.righe, 'spese'),
      caricaVoci(sb, A.righe, 'vendite'), caricaVoci(sb, Bc.righe, 'vendite'),
    ])
    if (req.current !== mio) return
    if (A.errore) setStato('errore')
    else {
      setDati({ A: A.righe, B: Bc.righe, spA: spA.voci, spB: spB.voci, veA: veA.voci, veB: veB.voci, acA, acB, foA, foB })
      setStato('ok')
      chiaveCaricata.current = chiave
    }
    } catch {
      if (req.current !== mio) return
      setStato('errore')
    }
    scheletroPronto()
  }, [a, b, B.a, B.b, chiaveTarget, scheletroPronto])

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
      sotto = voci.map(x => ({ l: x.nome, s: x.categoria, v: eu(x.importo), dot: v.colCat[x.categoria] }))
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
    if (!spese) return { l: s.l.nome, dot: s.l.colore, v: eu(tv, 0) }
    if (!xs.length) return { l: s.l.nome, dot: s.l.colore, v: '€ 0,00' }
    return {
      l: s.l.nome, dot: s.l.colore, v: eu(tv), p: `${xs.length} ${xs.length === 1 ? 'voce' : 'voci'}`,
      pannello: {
        titolo: `${s.l.nome} · ${c}`, sotto: `${xs.length} ${xs.length === 1 ? 'voce' : 'voci'} · ${eu(tv)}`,
        figli: xs.map(x => ({ l: x.nome, s: fd(x.data), v: eu(x.importo) })),
      },
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

  // Intestazione del guscio: sottotitolo col periodo filtrato e scintilla
  // che apre l'assistente sui dati filtrati, come nel design.
  useEffect(() => { impostaSottotitolo(sottotitolo) }, [sottotitolo])
  useEffect(() => {
    impostaAssistente(() => setAiOpen(true))
    return () => { impostaAssistente(null); impostaSottotitolo(null) }
  }, [])

  const vuoto = stato === 'ok' && v.rows.length === 0
  const riprova = () => { setStato('riprova'); setTimeout(() => carica(), 0) }
  return (
    <div className="flex flex-col">
      {/* Sul telefono la testa è una colonna (locali, periodo, Confronta ed
          Esporta). Qui niente ritiro allo scorrimento: la pagina scorre
          per intero e la testa esce già dallo schermo da sola. */}
      <div className={cn('relative z-[45] flex pb-3.5', tel ? 'flex-col items-stretch gap-2' : 'flex-nowrap items-center gap-3')}>
        <PilloleLocali multipla tuttiComeVuoto locali={locali} selezionati={sel} onCambia={setSel}
          className={tel ? '' : 'mx-0 flex-[0_1_auto] px-0'} />
        {!tel && <span className="flex-1" />}
        <BarraPeriodo periodo={periodo} onPeriodo={setPeriodo} mesi={mesi} oggi={oggi} tel={tel} />
        <div className={tel ? 'relative flex gap-2' : 'contents'}>
        <MenuConfronto apriRef={apriConfronto} oggi={oggi} tel={tel} modo={cmp} onModo={setCmp} custom={cmpC} onCustom={setCmpC}
          opzioni={{ prev: intervallo(piuGiorni(a, -n), piuGiorni(a, -1)), yoy: intervallo(unAnnoPrima(a), unAnnoPrima(b)), customDefault: { a: piuGiorni(a, -n), b: piuGiorni(a, -1) } }} />
        <PulsanteEsporta tel={tel} disabilitato={!v.rows.length} onScegli={setEsporta} />
        </div>
      </div>

      <div data-sk-root="" data-sk-on={sk === 'on' ? '1' : undefined} className="relative min-h-[420px] select-none [-webkit-touch-callout:none] [-webkit-user-select:none]">
        {stato === 'errore' ? (
          <div className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center text-pretty">
            <span className="text-[15px] font-semibold text-[oklch(0.45_0.1_25)] dark:text-neg">Caricamento non riuscito</span>
            <span className="text-[13px] text-muted-foreground">Caricamento delle chiusure non riuscito. Riprova.</span>
            <button type="button" onClick={riprova} className="mt-3 flex h-11 items-center gap-2 rounded-[12px] border border-[oklch(0.82_0.01_250)] bg-card px-[18px] text-sm font-semibold transition-transform duration-150 active:scale-[0.97] dark:border-line-strong">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></svg>
              Riprova
            </button>
          </div>
        ) : stato === 'riprova' ? (
          <div className="flex flex-col gap-3 p-[18px]">
            {[70, 92, 55].map(w => <div key={w} className="h-3.5 rounded-[6px] bg-[linear-gradient(90deg,var(--sk-a)_25%,var(--sk-b)_50%,var(--sk-a)_75%)] bg-[length:200%_100%] [animation:sk-sh_1.4s_linear_infinite]" style={{ width: `${w}%` }} />)}
          </div>
        ) : stato === 'carica' ? null : vuoto ? (
          <div className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center text-pretty">
            <span className="text-[15px] font-semibold">Nessuna chiusura confermata nel periodo</span>
            <span className="text-[13px] text-muted-foreground">La chiusura di oggi arriva stasera. Prova Settimana o Mese.</span>
          </div>
        ) : (
          <div key={`${periodo.k}|${a}|${b}|${chiaveTarget}|${cmp}`} className="flex flex-col gap-4">
            {cmpAttivo
              ? <VistaConfronto c={c} onCambia={() => apriConfronto.current?.()} onSpegni={() => setCmp(null)} />
              : <VistaNormale c={c} />}
          </div>
        )}
        {sk !== 'no' && <ScheletroForma esce={sk === 'out'} />}
      </div>

      <FoglioDettaglio pila={schede} esce={pilaEsce} onIndietro={() => setPila(p => p.slice(0, -1))} onChiudi={chiudiPila} />
      <FumettoAncorato f={fum} esce={fumEsce} onChiudi={chiudiFum} />
      <CassaFileViewer
        open={!!esporta} onOpenChange={o => { if (!o) setEsporta(null) }}
        request={esporta ? { url: '/api/cassa/analisi-export', body: { restaurant_ids: target, start: a, end: b, format: esporta } } : null}
        format={esporta} title={`Analisi · ${intervallo(a, b)}`} fileNameBase={`analisi-cassa-${a}_${b}`}
      />
      <AnalisiAiDialog open={aiOpen} onOpenChange={setAiOpen} restaurantIds={target} nome={nome} />
    </div>
  )
}
