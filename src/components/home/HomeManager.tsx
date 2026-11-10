'use client'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useTelefono } from '@/hooks/useTelefono'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import { impostaAssistente } from '@/components/shell/intestazioneDinamica'
import { eu0, eu2, pc, percento, type DatiHome, type LocaleHome } from '@/lib/homeManager'
import { DaFare } from './DaFare'
import { Foglio, IconaChiudi, useFoglio } from './Foglio'
import { AssistenteChat } from './AssistenteChat'

const OK = 'bg-ok-tint text-ok', NEG = 'bg-neg-tint text-neg'
const STATO = {
  inviata: ['Inviata', 'bg-ok-tint text-ok'],
  revisione: ['In revisione', 'bg-warn-tint text-warn'],
  mancante: ['Mancante', 'bg-neg-tint text-neg'],
} as const
const SWAPIN = 'swapin 680ms cubic-bezier(0.22,1,0.36,1) both'

// Ordine dei locali scelto con le pillole (stessa chiave di PilloleLocali):
// la Home li elenca nello stesso ordine delle altre schermate.
const CHIAVE_ORDINE = 'inturno.locOrderL'
function useOrdineLocali(): string[] {
  const raw = useSyncExternalStore(
    l => { const h = (e: StorageEvent) => { if (e.key === CHIAVE_ORDINE) l() }; window.addEventListener('storage', h); return () => window.removeEventListener('storage', h) },
    () => { try { return localStorage.getItem(CHIAVE_ORDINE) ?? '[]' } catch { return '[]' } },
    () => '[]',
  )
  return useMemo(() => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] } }, [raw])
}

/** Andamento a 7 giorni (MTHome): linea con area tenue, i giorni senza chiusura saltati. */
function Sparkline({ valori, colore }: { valori: (number | null)[]; colore: string }) {
  const vv = valori.filter((x): x is number => x !== null)
  if (vv.length < 2) return <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="block h-7 w-full" aria-hidden />
  const mx = Math.max(...vv) * 1.04, mn = Math.min(...vv) * 0.9
  const pts = valori.map((y, q) => (y === null ? null : [(q / 6) * 100, 26 - ((y - mn) / (mx - mn || 1)) * 22] as const)).filter((p): p is readonly [number, number] => !!p)
  const ln = 'M' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')
  const area = `${ln} L${pts[pts.length - 1][0].toFixed(1)},28 L0,28 Z`
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="block h-7 w-full overflow-visible [grid-area:3/1/4/3] sm:[grid-area:auto]" aria-hidden>
      <path d={area} fill={`color-mix(in oklch, ${colore} 14%, transparent)`} />
      <path d={ln} fill="none" stroke={colore} strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

interface Kpi { l: string; v: string; d?: string; ds?: string; pos?: boolean; righe?: { l: string; c: string; v: string; manca: boolean }[]; href: string; cls?: string }

function SchedaKpi({ k, i }: { k: Kpi; i: number }) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => router.push(k.href)}
      className={cn('flex min-w-0 flex-col gap-1.5 rounded-[12px] border border-border bg-card px-3.5 py-3 text-left transition-colors hover:bg-[oklch(0.985_0.006_250)] active:scale-[0.98] dark:hover:bg-secondary sm:px-4 sm:py-3.5', k.cls)}
      style={{ animation: SWAPIN, animationDelay: `${i * 60}ms` }}
    >
      <span className="flex w-full items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-muted-foreground sm:text-xs">{k.l}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="oklch(0.6 0.01 250)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
      </span>
      <span className="whitespace-nowrap font-mono text-lg font-semibold tracking-[-.01em] sm:text-2xl">{k.v}</span>
      {k.d !== undefined && (
        <span className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {k.d && <span className={cn('rounded-full px-[7px] py-0.5 font-mono text-[11px] font-semibold', k.pos ? OK : NEG)}>{k.d}</span>}
          <span className="text-xs text-muted-foreground">{k.ds}</span>
        </span>
      )}
      {k.righe && (
        <span className="mt-auto grid w-full grid-cols-1 gap-x-3.5 gap-y-[3px] sm:grid-cols-2">
          {k.righe.map(r => (
            <span key={r.l} className="flex items-center gap-1.5 text-xs text-[oklch(0.35_0.01_250)] dark:text-muted-foreground">
              <span className="h-[7px] w-[7px] flex-none rounded-[2px]" style={{ background: r.c }} />
              <span className="min-w-0 flex-1 truncate">{r.l}</span>
              <span className={cn('font-mono text-xs font-medium', r.manca ? 'text-neg' : 'text-foreground')}>{r.v}</span>
            </span>
          ))}
        </span>
      )}
    </button>
  )
}

// Riga del foglio della chiusura: etichetta e importo, in grassetto i totali.
function Riga({ l, v, forte, neg }: { l: string; v: string; forte?: boolean; neg?: boolean }) {
  return (
    <div className="flex min-h-[22px] items-center gap-2 border-t border-[oklch(0.94_0.01_250)] py-2 dark:border-border">
      <span className={cn('flex-1 text-sm', forte ? 'font-semibold' : 'font-normal')}>{l}</span>
      <span className={cn('font-mono text-sm', forte ? 'font-semibold' : 'font-normal', neg && 'text-neg')}>{v}</span>
    </div>
  )
}

function FoglioChiusura({ l, colore, d, uscita, onChiudi }: { l: LocaleHome; colore: string; d: DatiHome; uscita: boolean; onChiudi: () => void }) {
  const router = useRouter()
  const [speseAperte, setSpeseAperte] = useState(false)
  const [st, cls] = STATO[l.stato]
  const c = l.chiusura
  const media = c && c.coperti ? (c.totale - c.asporto) / c.coperti : null
  const sgn = (v: number) => (v === 0 ? eu2(0) : `${v > 0 ? '+' : '−'}${eu2(Math.abs(v))}`)
  const vai = () => { onChiudi(); router.push(l.stato === 'revisione' ? '/cassa/approvazioni' : '/cassa/lista-chiusure') }
  return (
    <Foglio uscita={uscita} onChiudi={onChiudi} etichetta={`Chiusura di ${l.nome}`}
      className="mt-auto max-h-[88%] w-full rounded-t-[20px] pb-6 sm:m-auto sm:mt-[200px] sm:max-h-none sm:w-[560px] sm:rounded-[14px] sm:pb-0">
      <div className="flex items-center gap-3 border-b border-border px-5 py-[18px]">
        <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: colore }} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[19px] font-semibold">{l.nome}</span>
          <span className="text-[13px] text-muted-foreground">Chiusura di {d.ieriLungo}</span>
        </div>
        <span className={cn('flex-none rounded-full px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[.05em]', cls)}>{st}</span>
        <button type="button" onClick={onChiudi} aria-label="Chiudi" className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-muted-foreground active:scale-[0.96]"><IconaChiudi /></button>
      </div>
      {!c ? (
        <div className="flex flex-col gap-1.5 px-5 pb-2 pt-7">
          <span className="text-base font-semibold">Chiusura non ancora inviata</span>
          <span className="text-sm leading-normal text-muted-foreground text-pretty">Il cassiere non ha ancora chiuso la serata di {d.ieriLungo}.</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 px-5 pb-1 pt-4">
            {[{ l: 'Totale entrate', v: eu2(c.totale), neg: false }, { l: 'Differenza', v: sgn(c.differenza), neg: c.differenza < 0 }].map(s => (
              <div key={s.l} className="flex flex-col gap-1 rounded-[10px] border border-border px-3.5 py-3">
                <span className="text-xs font-medium text-muted-foreground">{s.l}</span>
                <span className={cn('font-mono text-xl font-semibold', s.neg && 'text-neg')}>{s.v}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col px-5 pt-3.5">
            <span className="pb-1.5 text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Entrate</span>
            <Riga l="Contanti" v={eu2(c.contanti)} />
            <Riga l="POS" v={eu2(c.pos)} />
            <Riga l="Bonifico" v={eu2(c.bonifico)} />
            <Riga l="Totale entrate" v={eu2(c.totale)} forte />
            <Riga l="di cui asporto" v={eu2(c.asporto)} />
            <Riga l="Coperti" v={String(c.coperti)} />
            <Riga l="Media scontrino" v={media === null ? '—' : eu2(media)} />
          </div>
          <div className="flex flex-col px-5 pt-3.5">
            <span className="pb-1.5 text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Cassa</span>
            <Riga l="Fondo cassa iniziale" v={eu2(c.fondoIniziale)} />
            <div className="flex flex-col border-t border-[oklch(0.94_0.01_250)] dark:border-border">
              <button type="button" onClick={() => setSpeseAperte(a => !a)} disabled={!c.voci.length}
                className="flex min-h-[22px] items-center gap-2 py-2 text-left enabled:active:scale-[0.99]">
                <span className="flex-1 text-sm">Spese</span>
                {c.voci.length > 0 && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                    className="flex-none text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ transform: `rotate(${speseAperte ? 180 : 0}deg)` }}><path d="M6 9l6 6 6-6" /></svg>
                )}
                <span className="font-mono text-sm">{eu2(c.spese)}</span>
              </button>
              {speseAperte && (
                <div className="anim-swapin mb-2.5 flex flex-col rounded-[8px] bg-background px-3 py-1">
                  {c.voci.map((v, i) => (
                    <div key={i} className="flex items-baseline gap-2.5 py-[7px]">
                      <div className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="text-[13px] font-medium">{v.nome}</span>
                        {v.categoria && <span className="text-xs text-muted-foreground">{v.categoria}</span>}
                      </div>
                      <span className="font-mono text-[13px] font-medium">{eu2(v.importo)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Riga l="Fondo cassa finale" v={eu2(c.fondoFinale)} />
            <Riga l="Banca teorica" v={eu2(c.bancaTeorica)} />
            <Riga l="Contanti per banca" v={eu2(c.contantiBanca)} forte />
          </div>
        </>
      )}
      <div className="grid grid-cols-[1fr_2fr] gap-2.5 px-5 pb-5 pt-[18px]">
        <button type="button" onClick={onChiudi} className="h-[52px] rounded-[6px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">Chiudi</button>
        <button type="button" onClick={vai} className="h-[52px] rounded-[6px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98]">
          {l.stato === 'revisione' ? 'Apri in approvazioni' : 'Apri in Cassa'}
        </button>
      </div>
    </Foglio>
  )
}

// Home del manager e del direttore (MTHome; Manager / Direttore Smartphone
// e Tablet v2). Tablet: riepilogo AI, quattro indicatori, Locali e "Da
// fare" affiancati con lo scroll dentro le card. Telefono: tutto in
// colonna, "Da fare" a fisarmonica e la chiusura di un locale in un foglio
// dal basso. Con un solo locale (direttore) al posto di indicatori e
// Locali c'è la card dei coperti e sotto il foglio presenze del mese.
export function HomeManager({ d, singolo = false, nome, sopra, report }: {
  d: DatiHome
  singolo?: boolean
  /** Nome di chi guarda, per il saluto dell'assistente. */
  nome: string
  /** Blocco sopra la Home (la timbratura del direttore). */
  sopra?: React.ReactNode
  /** Foglio presenze del mese, compatto (solo Home a un locale). */
  report?: React.ReactNode
}) {
  const router = useRouter()
  const tel = useTelefono()
  const ordine = useOrdineLocali()
  const foglio = useFoglio<string>()
  const ai = useFoglio<true>()

  // La scintilla dell'intestazione apre l'assistente qui, senza cambiare pagina.
  const apriAi = ai.apri
  useEffect(() => {
    impostaAssistente(() => apriAi(true))
    return () => impostaAssistente(null)
  }, [apriAi])

  const rango = (n: string) => { const i = ordine.indexOf(n); return i < 0 ? 999 : i }
  const locali = [...d.locali].sort((a, b) => rango(a.nome) - rango(b.nome) || a.indice - b.indice)
  const colore = (l: LocaleHome) => coloreLocale(l.indice)
  const inviate = locali.filter(l => l.ieri !== null).length

  const kpi: Kpi[] = singolo ? [] : [
    {
      l: `Ultima serata · ${d.ieriBreve}`, v: eu0(d.totaleIeri), d: d.deltaIeri === null ? '' : pc(d.deltaIeri), pos: (d.deltaIeri ?? 0) >= 0,
      ds: `vs ${d.primaBreve}${inviate < locali.length ? ` · ${inviate} su ${locali.length} locali` : ''}`,
      righe: locali.map(l => ({ l: l.nome, c: colore(l), v: l.ieri === null ? 'manca' : eu0(l.ieri), manca: l.ieri === null })), href: '/cassa/analisi',
    },
    (() => { const p = percento(d.totaleMese, d.totaleMesePrima); return {
      l: `${d.meseNome} fino a ieri`, v: eu0(d.totaleMese), d: p === null ? '' : pc(p), pos: (p ?? 0) >= 0, ds: `vs ${d.meseConfronto}`,
      righe: locali.map(l => ({ l: l.nome, c: colore(l), v: eu0(l.mese), manca: false })), href: '/cassa/analisi',
    } })(),
    (() => { const p = percento(d.mediaIeri, d.mediaPrima); return {
      l: `Media scontrino · ${d.ieriCorto}`, v: d.mediaIeri === null ? '—' : eu2(d.mediaIeri), d: p === null ? '' : pc(p), pos: (p ?? 0) >= 0, ds: `vs ${d.primaBreve}`, href: '/cassa/analisi', cls: 'max-sm:hidden',
    } })(),
    {
      l: `Contanti per banca · ${d.ieriCorto}`, v: eu2(d.contantiIeri), href: '/cassa/progressivo-buste', cls: 'max-sm:col-span-2',
      righe: locali.map(l => ({ l: l.nome, c: colore(l), v: l.contantiBanca === null ? 'manca' : eu2(l.contantiBanca), manca: l.contantiBanca === null })),
    },
  ]

  const apriLocale = (l: LocaleHome) => {
    if (!tel) return router.push(l.stato === 'revisione' ? '/cassa/approvazioni' : '/cassa/lista-chiusure')
    foglio.apri(l.id)
  }
  const inFoglio = locali.find(l => l.id === foglio.valore) ?? null

  // Card dei coperti (un locale): coperti e media di ieri con lo scarto
  // sulla settimana prima, e i coperti dei prossimi giorni di una settimana fa.
  const sgn = (v: number) => (v >= 0 ? '+' : '−')
  const combo = singolo ? [
    { l: `Coperti · ${d.ieriCorto}`, v: d.copertiIeri === null ? '—' : String(d.copertiIeri), dv: d.copertiIeri !== null && d.copertiPrima !== null ? d.copertiIeri - d.copertiPrima : null, f: (x: number) => sgn(x) + Math.abs(x) },
    { l: `Media scontrino · ${d.ieriCorto}`, v: d.mediaIeri === null ? '—' : eu2(d.mediaIeri), dv: d.mediaIeri !== null && d.mediaPrima !== null ? d.mediaIeri - d.mediaPrima : null, f: (x: number) => sgn(x) + eu2(Math.abs(x)) },
  ] : []

  return (
    <div className="flex flex-col gap-3 px-4 pb-2 sm:h-full sm:min-h-[640px] sm:gap-4 sm:px-8 sm:pb-1">
      {sopra}

      <div className="hidden flex-none flex-col gap-1.5 rounded-[12px] border border-[oklch(0.89_0.03_180)] bg-[oklch(0.97_0.018_180)] px-[18px] py-3.5 dark:border-[oklch(0.35_0.05_180)] dark:bg-[oklch(0.22_0.03_180)] sm:flex" style={{ animation: SWAPIN }}>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[oklch(0.58_0.12_180)] px-[7px] py-0.5 text-[10px] font-semibold tracking-[.05em] text-white">AI</span>
          <span className="text-[10px] font-semibold uppercase tracking-[.06em] text-[oklch(0.38_0.07_180)] dark:text-[oklch(0.8_0.08_180)]">Riepilogo · {d.ieriLungo}</span>
        </div>
        <span className="text-[15px] leading-normal text-pretty">{d.riepilogo}</span>
      </div>

      {singolo && (
        <div className="flex flex-none flex-col gap-2.5 rounded-[12px] border border-border bg-card px-3.5 py-3" style={{ animation: SWAPIN }}>
          <div className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] gap-3.5">
            {combo.map((m, i) => (
              <div key={m.l} className="flex min-w-0 flex-col gap-1" style={{ gridColumn: i === 0 ? '1' : '3' }}>
                <span className="truncate text-xs font-medium text-muted-foreground">{m.l}</span>
                <span className="whitespace-nowrap font-mono text-[22px] font-semibold tracking-[-.01em]">{m.v}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {m.dv !== null && <span className={cn('rounded-full px-[7px] py-0.5 font-mono text-[11px] font-semibold', m.dv >= 0 ? OK : NEG)}>{m.f(m.dv)}</span>}
                  <span className="text-xs text-muted-foreground">vs {d.primaBreve}</span>
                </div>
              </div>
            ))}
            <span className="col-start-2 row-start-1 bg-[oklch(0.92_0.01_250)] dark:bg-border" />
          </div>
          <div className="grid grid-cols-3 items-baseline gap-x-2.5 gap-y-1.5 border-t border-[oklch(0.93_0.01_250)] pt-[9px] dark:border-border">
            <span className="col-span-3 text-xs font-medium text-muted-foreground">Coperti della settimana scorsa</span>
            {d.settimanaScorsa.map(g => (
              <div key={g.etichetta} className="flex items-baseline justify-between gap-[5px] whitespace-nowrap rounded-[7px] bg-[oklch(0.97_0.01_250)] px-2 py-1.5 dark:bg-secondary">
                <span className="text-xs text-[oklch(0.35_0.01_250)] dark:text-muted-foreground">{g.etichetta}</span>
                <span className="font-mono text-[13px] font-semibold">{g.coperti ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!singolo && (
        <div className="grid flex-none grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
          {kpi.map((k, i) => <SchedaKpi key={k.l} k={k} i={i} />)}
        </div>
      )}

      <div className={cn('grid min-h-0 grid-cols-1 gap-3 sm:gap-4', singolo ? 'sm:flex-none' : 'sm:flex-[1_1_0] sm:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]')}>
        {!singolo && (
          <div className="flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-border bg-card" style={{ animation: SWAPIN, animationDelay: '200ms' }}>
            <div className="flex flex-none items-center gap-2.5 border-b border-border px-3.5 py-3.5 sm:px-[18px]">
              <span className="text-[17px] font-semibold">Locali</span>
              <span className="text-[13px] font-medium text-muted-foreground">{d.ieriMedio}</span>
            </div>
            <div className="hidden flex-none grid-cols-[minmax(0,1fr)_136px_96px_116px_100px] gap-3 whitespace-nowrap border-b border-border bg-[oklch(0.97_0.01_250)] px-[18px] py-[9px] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground dark:bg-secondary sm:grid">
              <span>Locale</span><span className="text-right">Incasso</span><span className="text-center">7 giorni</span><span className="text-right">Contanti</span><span className="text-right">Chiusura</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {locali.map(l => {
                const p = percento(l.ieri, l.ieriPrima)
                const [st, cls] = STATO[l.stato]
                return (
                  <div
                    key={l.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => apriLocale(l)}
                    onKeyDown={e => { if (e.key === 'Enter') apriLocale(l) }}
                    className="grid min-h-16 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-[oklch(0.94_0.01_250)] px-3.5 py-3 transition-colors hover:bg-[oklch(0.98_0.006_250)] active:scale-[0.995] dark:border-border dark:hover:bg-secondary sm:grid-cols-[minmax(0,1fr)_136px_96px_116px_100px] sm:gap-3 sm:px-[18px] sm:py-0"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-[15px] font-medium [grid-area:1/1/2/2] sm:[grid-area:auto]">
                      <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: colore(l) }} />
                      <span className="truncate">{l.nome}</span>
                    </span>
                    <span className="flex flex-col items-start gap-px [grid-area:2/1/3/2] sm:items-end sm:[grid-area:auto]">
                      <span className={cn('font-mono text-[15px] font-semibold', l.ieri === null && 'text-muted-foreground')}>{l.ieri === null ? '—' : eu0(l.ieri)}</span>
                      <span className={cn('whitespace-nowrap font-mono text-[11.5px] font-medium', l.ieri === null || (p !== null && p < 0) ? 'text-neg' : p !== null ? 'text-ok' : 'text-muted-foreground')}>
                        {l.ieri === null ? 'chiusura non inviata' : p === null ? '' : `${pc(p)} vs ${d.primaCorto}`}
                      </span>
                    </span>
                    <Sparkline valori={l.andamento} colore={colore(l)} />
                    <span className="flex flex-col items-end gap-px [grid-area:2/2/3/3] sm:[grid-area:auto]">
                      <span className="text-[11px] font-medium text-muted-foreground sm:hidden">Contanti banca</span>
                      <span className={cn('font-mono text-sm font-medium', l.contantiBanca === null && 'text-muted-foreground')}>{l.contantiBanca === null ? '—' : eu2(l.contantiBanca)}</span>
                    </span>
                    <span className={cn('justify-self-end whitespace-nowrap rounded-full px-[9px] py-[3px] text-[10px] font-semibold uppercase tracking-[.05em] [grid-area:1/2/2/3] sm:[grid-area:auto]', cls)}>{st}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <DaFare voci={d.daFare} className={singolo ? 'sm:max-h-[340px]' : undefined} style={{ animation: SWAPIN, animationDelay: '260ms' }} />
      </div>

      {report && (
        <div className="h-[560px] flex-none overflow-hidden sm:h-auto sm:min-h-0 sm:flex-[1.15_1_0]" style={{ animation: 'swapin 680ms cubic-bezier(0.22,1,0.36,1) backwards', animationDelay: '360ms' }}>
          {report}
        </div>
      )}

      {inFoglio && <FoglioChiusura l={inFoglio} colore={colore(inFoglio)} d={d} uscita={foglio.uscita} onChiudi={foglio.chiudi} />}
      {ai.valore && <AssistenteChat nome={nome} uscita={ai.uscita} onChiudi={ai.chiudi} sottotitolo={singolo ? 'turni, presenze e acquisti del tuo locale' : undefined} />}
    </div>
  )
}
