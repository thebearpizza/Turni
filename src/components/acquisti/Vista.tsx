'use client'
import { SelettoreMese } from '@/components/shared/SelettoreMese'
import { CampoRicerca } from '@/components/shared/CampoRicerca'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { Tastierino, type TastoTastierino } from '@/components/ui/tastierino'
import { ScheletroForma } from '@/components/shared/ScheletroForma'
import { Badge, IcoGiu, IcoMatita, IcoX, TESTO, USCITA_MS, useMontato, type Tono } from './comuni'

// Struttura comune delle quattro sezioni di MTAcquisti: barra in alto
// (locali, mese, schede o filtri, indicatori, pulsante), elenco in una
// card con intestazioni ordinabili e, accanto (tablet) o in un foglio dal
// basso (telefono), il dettaglio della riga scelta.

export interface Colonna { l: string; destra?: boolean }
export interface RigaVista {
  id: string
  a: string
  as: string
  /** Colore del quadratino accanto al sottotitolo. */
  lc: string
  b: string
  c: string
  cTono?: Tono | 'ink'
  t: string
  tTono: Tono
  /** Chiavi di ordinamento delle quattro colonne. */
  ord: [string | number, string | number, string | number, string | number]
}
export interface Kpi { l: string; v: string; tono?: Tono }

interface Props {
  tel: boolean
  skeleton: 'on' | 'out' | 'no'
  locali?: ReactNode
  mese?: { etichetta: string; prec: () => void; succ: () => void; precOk: boolean; succOk: boolean }
  schede?: { k: string; l: string; n: number }[]
  scheda?: string
  onScheda?: (k: string) => void
  /** Campo di ricerca (riga 3): il filtro lo applica la pagina. */
  ricerca?: { valore: string; onCambia: (v: string) => void; segnaposto: string }
  filtri?: { k: string; l: string; on: boolean }[]
  /** Solo telefono: il pulsante "Filtri" (FiltriFoglio) che sostituisce le pillole `filtri`. */
  filtriTel?: ReactNode
  onFiltro?: (k: string) => void
  kpis: Kpi[]
  azione?: ReactNode
  colonne: [Colonna, Colonna, Colonna, Colonna]
  righe: RigaVista[]
  caricamento: boolean
  errore?: { testo: string; riprova: () => void } | null
  vuoto: { t: string; s: string }
  sel: string | null
  onSel: (id: string) => void
  /**
   * Tablet: primo tocco dentro il dettaglio. Se la riga è quella scelta
   * da sola all'apertura, la pagina la fissa come selezione vera, così un
   * aggiornamento della lista non cambia riga sotto le dita.
   */
  onFissa?: () => void
  /** Chiude il dettaglio (dopo lo swapout sul telefono). */
  onChiudi: () => void
  dettaglio: ReactNode | null
  /** Cambia a ogni riga scelta: riavvia l'ingresso del pannello. */
  chiaveDettaglio: string
}

const COLONNE_TABLET = 'minmax(0,1.3fr) 112px 92px 120px'

export function Vista(p: Props) {
  const { tel } = p
  const [ord, setOrd] = useState<{ i: number; dir: 1 | -1 } | null>(null)
  const [esce, setEsce] = useState(false)
  const tm = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (tm.current) clearTimeout(tm.current) }, [])
  const montato = useMontato()

  const righe = ord ? [...p.righe].sort((x, y) => {
    const a = x.ord[ord.i], b = y.ord[ord.i]
    const r = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'it')
    return ord.dir * r
  }) : p.righe

  const { onChiudi } = p
  const chiudi = useCallback(() => {
    if (!tel) { onChiudi(); return }
    setEsce(true)
    if (tm.current) clearTimeout(tm.current)
    tm.current = setTimeout(() => { setEsce(false); onChiudi() }, USCITA_MS)
  }, [tel, onChiudi])

  const pannello = p.dettaglio
    ? <PannelloCornice key={p.chiaveDettaglio} tel={tel} esce={esce} onChiudi={chiudi} onFissa={tel ? undefined : p.onFissa}>{p.dettaglio}</PannelloCornice>
    : null

  // Pezzi della testata: sul telefono vanno ciascuno su una riga propria,
  // figlia diretta della colonna (così `data-ritira` può chiuderli quando
  // la lista scorre); sul tablet restano in un'unica riga che va a capo.
  const mese = p.mese && (
    <SelettoreMese etichetta={p.mese.etichetta} onPrec={p.mese.prec} onSucc={p.mese.succ} precOk={p.mese.precOk} succOk={p.mese.succOk} className={tel ? 'flex-[1_1_0]' : 'w-[220px] flex-none'} />
  )
  const ricerca = p.ricerca && (
    <CampoRicerca valore={p.ricerca.valore} onCambia={p.ricerca.onCambia} segnaposto={p.ricerca.segnaposto} className={tel ? 'flex-[1_1_0]' : 'w-[240px] flex-none'} />
  )
  const azione = p.azione && <div data-sk-keep="" className={cn('flex-none', !tel && 'ml-2')}>{p.azione}</div>
  const schede = p.schede && (
    <div data-ritira={tel ? '' : undefined} className="flex min-w-0 flex-none gap-0.5 overflow-x-auto rounded-[9px] bg-[oklch(0.93_0.01_250)] p-[3px] [scrollbar-width:none] dark:bg-secondary">
      {p.schede.map(s => {
        const on = s.k === p.scheda
        return (
          <button key={s.k} type="button" onClick={() => p.onScheda?.(s.k)}
            className={cn('flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] text-[13px] font-medium transition-colors duration-200', tel ? 'flex-[1_1_0] px-2' : 'px-3',
              on ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-muted-foreground')}>
            {s.l}<span className="font-mono text-[11px] font-medium opacity-70">{s.n}</span>
          </button>
        )
      })}
    </div>
  )
  // Sul telefono, se la pagina passa `filtriTel` (il foglio dei filtri),
  // le pillole in riga non si mostrano: stanno nel foglio.
  const filtri = p.filtri && !(tel && p.filtriTel) && (
    <div data-sk-keep="" data-ritira={tel ? '' : undefined} className="flex min-w-0 flex-none gap-1.5 overflow-x-auto overscroll-contain [scrollbar-width:none]">
      {p.filtri.map(f => (
        <button key={f.k} type="button" onClick={() => p.onFiltro?.(f.k)}
          className={cn('flex h-10 items-center justify-center whitespace-nowrap rounded-[8px] border px-3 text-[13px] font-medium transition-colors duration-200 active:scale-[0.97]', tel && 'flex-[1_1_0]',
            f.on ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-card dark:border-line-strong')}>
          {f.l}
        </button>
      ))}
    </div>
  )

  return (
    <div data-sk-root="" data-sk-on={p.skeleton === 'on' ? '1' : undefined} className={cn('relative box-border flex h-full flex-col gap-3', tel ? 'px-4' : 'px-8')}>
      {tel ? (
        <>
          {/* Ordine uguale in tutta l'app: locali, mese + azione, ricerca e
              filtri, numeri di riepilogo. Schede, pillole e numeri si
              ritirano scorrendo la lista (data-ritira). */}
          {p.locali && <div data-sk-keep="" className="min-w-0 flex-none">{p.locali}</div>}
          {p.mese && <div className="flex flex-none items-center gap-2.5">{mese}{azione}</div>}
          {(p.ricerca || p.filtriTel || (!p.mese && p.azione)) && (
            // Senza il mese l'azione sta qui: una riga solo per il pulsante
            // toglierebbe spazio alla lista.
            <div className="flex flex-none items-center gap-2">{ricerca}{p.filtriTel}{!p.mese && azione}</div>
          )}
          {schede}
          {filtri}
          {p.kpis.length > 0 && (
            // Colonne uguali e etichetta che può andare a capo: i numeri
            // restano dentro lo schermo anche con etichette lunghe
            // ("Spesa netta novembre").
            <div data-ritira="" className="grid flex-none gap-x-3" style={{ gridTemplateColumns: `repeat(${p.kpis.length}, minmax(0, 1fr))` }}>
              {p.kpis.map(k => (
                <div key={k.l} className="flex min-w-0 flex-col justify-end px-0.5">
                  <span className="text-pretty text-xs font-medium leading-[1.25] text-muted-foreground">{k.l}</span>
                  <span className={cn('whitespace-nowrap font-mono text-[17px] font-semibold', k.tono && k.tono !== 'neu' ? TESTO[k.tono] : 'text-foreground')}>{k.v}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-none flex-wrap items-center gap-2.5">
          {p.locali && <div data-sk-keep="" className="min-w-0 flex-[0_1_auto]">{p.locali}</div>}
          {mese}
          {ricerca}
          {schede}
          {filtri}
          <span className="flex-1" />
          {p.kpis.map(k => (
            <div key={k.l} className="flex min-w-0 flex-none flex-col items-end px-2.5">
              <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">{k.l}</span>
              <span className={cn('whitespace-nowrap font-mono text-[17px] font-semibold', k.tono && k.tono !== 'neu' ? TESTO[k.tono] : 'text-foreground')}>{k.v}</span>
            </div>
          ))}
          {azione}
        </div>
      )}

      <div className={cn('grid min-h-0 flex-1 gap-4', tel ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]')}>
        <div className="anim-swapin flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-border bg-card">
          {!tel && (
            <div className="grid flex-none gap-2.5 border-b border-border bg-[oklch(0.97_0.01_250)] px-4 py-1 text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground dark:bg-secondary" style={{ gridTemplateColumns: COLONNE_TABLET }}>
              {p.colonne.map((c, i) => {
                const on = ord?.i === i
                return (
                  <button key={c.l} type="button"
                    onClick={() => setOrd(o => (!o || o.i !== i ? { i, dir: 1 } : o.dir === 1 ? { i, dir: -1 } : null))}
                    className={cn('flex min-h-10 select-none items-center gap-1 uppercase tracking-[.05em] active:scale-[0.97]', c.destra ? 'justify-end' : 'justify-start', on && 'text-foreground')}>
                    {c.l}
                    <IcoGiu s={10} className="transition-[transform,opacity] duration-300" style={{ opacity: on ? 1 : 0, transform: `rotate(${on && ord?.dir === -1 ? 180 : 0}deg)` }} />
                  </button>
                )
              })}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {p.errore ? (
              <div className="anim-swapin flex flex-col items-center gap-3 px-[18px] py-12 text-center">
                <span className="text-[15px] font-semibold">Non è stato possibile caricare i dati</span>
                <span className="text-[13px] text-muted-foreground">{p.errore.testo}</span>
                <button type="button" onClick={p.errore.riprova} className="h-10 rounded-[8px] bg-primary px-4 text-sm font-semibold text-primary-foreground active:scale-[0.97]">Riprova</button>
              </div>
            ) : !p.caricamento && righe.length === 0 ? (
              <div key={p.vuoto.t} className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center text-pretty">
                <span className="text-[15px] font-semibold">{p.vuoto.t}</span>
                <span className="text-[13px] text-muted-foreground">{p.vuoto.s}</span>
              </div>
            ) : righe.map(r => {
              const on = p.sel === r.id
              return (
                <button key={r.id} type="button" onClick={() => p.onSel(r.id)}
                  className={cn('grid min-h-14 w-full items-center border-b border-[oklch(0.94_0.01_250)] text-left transition-colors duration-200 active:scale-[0.995] dark:border-border',
                    tel ? 'grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2.5 pl-4 pr-3.5' : 'gap-2.5 px-4',
                    on ? 'bg-primary text-primary-foreground' : 'text-foreground')}
                  style={tel ? undefined : { gridTemplateColumns: COLONNE_TABLET }}>
                  <span className={cn('flex min-w-0 flex-col gap-px', tel && 'col-start-1 row-start-1')}>
                    <span className="truncate text-sm font-medium">{r.a}</span>
                    <span className={cn('flex min-w-0 items-center gap-1.5 text-xs', on ? 'text-[oklch(0.85_0.01_250)] dark:text-primary-foreground/70' : 'text-muted-foreground')}>
                      <span className="h-[7px] w-[7px] flex-none rounded-[2px]" style={{ background: r.lc }} />
                      <span className="truncate">{r.as}</span>
                    </span>
                  </span>
                  <span className={cn('whitespace-nowrap text-right font-mono text-sm font-medium', tel && 'col-start-2 row-start-1')}>{r.b}</span>
                  <span className={cn('whitespace-nowrap text-right font-mono font-medium', tel ? 'col-start-2 row-start-2 text-[12.5px]' : 'text-sm',
                    on ? '' : r.cTono === 'ink' ? 'text-foreground' : TESTO[r.cTono ?? 'neu'])}>{r.c}</span>
                  <span className={cn(tel ? 'col-start-1 row-start-2 justify-self-start' : 'justify-self-end')}><Badge tono={r.tTono}>{r.t}</Badge></span>
                </button>
              )
            })}
          </div>
        </div>

        {!tel && (pannello ?? (
          <div className="anim-swapin flex min-h-0 items-center justify-center rounded-[12px] border border-border bg-card text-sm font-medium text-muted-foreground">
            Seleziona una riga per vedere il dettaglio.
          </div>
        ))}
      </div>
      {tel && pannello && montato && createPortal(
        <div className="fixed inset-0 z-[70]">
          <div onClick={chiudi} className="absolute inset-0 transition-[background-color] duration-300" style={{ background: esce ? 'rgba(15,20,30,0)' : 'rgba(15,20,30,.22)' }} />
          <div className="absolute inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+64px)] flex">{pannello}</div>
        </div>,
        document.body,
      )}
      {p.skeleton !== 'no' && <ScheletroForma esce={p.skeleton === 'out'} />}
    </div>
  )
}

// ── Pannello di dettaglio ────────────────────────────────────────────

function PannelloCornice({ tel, esce, onChiudi, onFissa, children }: { tel: boolean; esce: boolean; onChiudi: () => void; onFissa?: () => void; children: ReactNode }) {
  return (
    <div
      data-kpcard="1"
      onPointerDownCapture={onFissa}
      className={cn('relative flex min-h-0 w-full flex-col border border-border bg-card', tel ? 'rounded-t-[20px] shadow-[0_20px_60px_rgba(20,30,50,.18)]' : 'rounded-[12px]', esce ? 'anim-swapout' : 'anim-swapin')}
    >
      <ChiudiContesto.Provider value={tel ? onChiudi : null}>{children}</ChiudiContesto.Provider>
    </div>
  )
}

const ChiudiContesto = createContext<(() => void) | null>(null)

export interface RigaDettaglio {
  l: string
  v: string
  /** Valore precedente, barrato. */
  o?: string
  tono?: Tono | 'ink'
  forte?: boolean
  on?: () => void
  matita?: boolean
  attiva?: boolean
  /** Pillola accanto all'etichetta (es. "+68%" su un prezzo da verificare). */
  pill?: { t: string; tono: Tono; titolo?: string }
  /** Gruppo di righe che si apre al tocco (freccia al posto della matita). */
  apribile?: { aperto: boolean }
}
export interface SezioneDettaglio { h: string; righe: RigaDettaglio[] }
export interface AzioneDettaglio { l: string; tipo: 'primario' | 'secondario' | 'pericolo' | 'pericoloPieno'; on: () => void; disabled?: boolean }

export interface TastierinoDettaglio { esce: boolean; onKey: (k: TastoTastierino) => void; onDone: () => void; senzaVirgola?: boolean }

export function Pannello({ tel, titolo, sotto, badge, messaggio, stats, spark, blocco, sezioni, azioni, colonneAzioni, tastierino }: {
  tel: boolean
  titolo: string
  sotto: string
  badge?: { t: string; tono: Tono }
  messaggio?: { testo: string; tono: Tono } | null
  stats?: { l: string; v: string; tono?: Tono }[]
  spark?: { h: string; valori: number[]; etichette: string[] } | null
  blocco?: ReactNode
  sezioni: SezioneDettaglio[]
  azioni?: AzioneDettaglio[]
  colonneAzioni?: string
  tastierino?: TastierinoDettaglio | null
}) {
  const chiudi = useContext(ChiudiContesto)
  const scorre = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const kpAperto = !!tastierino

  // Tablet: il tastierino si apre sopra il campo attivo, centrato su di
  // esso (come placeKp del prototipo); telefono: agganciato in basso, e il
  // campo scorre sopra di esso.
  useLayoutEffect(() => {
    if (!kpAperto) return
    const raf = requestAnimationFrame(() => {
      const card = scorre.current?.closest('[data-kpcard]') as HTMLElement | null
      const campo = card?.querySelector('[data-kpfield="on"]') as HTMLElement | null
      if (!card || !campo) return
      const cr = card.getBoundingClientRect(), fr = campo.getBoundingClientRect()
      if (tel) {
        const lim = cr.bottom - 380 - 16, d = fr.bottom - lim
        if (d > 0) scorre.current?.scrollBy({ top: d, behavior: 'smooth' })
        return
      }
      const cw = card.offsetWidth
      const x = Math.round(Math.min(Math.max(fr.left + fr.width / 2 - cr.left, 164), Math.max(164, cw - 164))), y = Math.round(fr.top - cr.top - 10)
      setPos(p => (p && p.x === x && p.y === y ? p : { x, y }))
    })
    return () => cancelAnimationFrame(raf)
  }, [kpAperto, tel, blocco])

  return (
    <>
      <div className="flex flex-none items-center gap-3 border-b border-border py-3.5" style={{ paddingInline: tel ? 14 : 18 }}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-lg font-semibold">{titolo}</span>
          <span className="text-[13px] text-muted-foreground text-pretty">{sotto}</span>
        </div>
        {badge && <Badge tono={badge.tono} className="flex-none">{badge.t}</Badge>}
        {chiudi && (
          <button type="button" onClick={chiudi} aria-label="Chiudi" className="-my-2 -ml-1 -mr-2.5 flex h-11 w-11 flex-none items-center justify-center rounded-full text-muted-foreground active:scale-[0.96]"><IcoX /></button>
        )}
      </div>
      <div
        ref={scorre}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pt-3.5"
        style={{ paddingInline: tel ? 14 : 18, paddingBottom: kpAperto && tel ? 380 : 14 }}
      >
        {messaggio && <div className={cn('rounded-[10px] px-3.5 py-3 text-sm font-medium leading-[1.45]', messaggio.tono === 'neg' ? 'bg-neg-tint text-neg' : messaggio.tono === 'ok' ? 'bg-ok-tint text-ok' : 'bg-warn-tint text-warn')}>{messaggio.testo}</div>}
        {stats && stats.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {stats.map(s => (
              <div key={s.l} className="flex min-w-0 flex-col gap-[3px] rounded-[10px] bg-background px-3.5 py-3">
                <span className="text-xs font-medium text-muted-foreground">{s.l}</span>
                <span className={cn('truncate font-mono text-lg font-semibold', s.tono && s.tono !== 'neu' ? TESTO[s.tono] : '')}>{s.v}</span>
              </div>
            ))}
          </div>
        )}
        {spark && <Spark {...spark} />}
        {blocco}
        {sezioni.map(se => (
          <div key={se.h} className="flex flex-col">
            <span className="pb-1.5 text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">{se.h}</span>
            {se.righe.map((x, i) => {
              const Tag = x.on ? 'button' : 'div'
              return (
                <Tag key={i} {...(x.on ? { type: 'button' as const, onClick: x.on } : {})}
                  className={cn('-mx-2 grid min-h-10 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-[6px] border-t border-[oklch(0.94_0.01_250)] px-2 text-left dark:border-border',
                    x.on ? 'cursor-pointer' : 'cursor-default', x.attiva && 'bg-[oklch(0.95_0.03_180)] dark:bg-[oklch(0.26_0.03_180)]')}>
                  <span className={cn('py-2 text-sm leading-[1.35] text-[oklch(0.3_0.01_250)] dark:text-foreground/85', x.forte ? 'font-semibold' : 'font-normal')}>
                    {x.l}
                    {x.pill && <Badge tono={x.pill.tono} className="ml-1.5 inline-block px-[7px] py-px align-[1px] font-mono normal-case tracking-normal" ><span title={x.pill.titolo}>{x.pill.t}</span></Badge>}
                  </span>
                  {x.o ? <span className="font-mono text-[13px] font-medium text-[oklch(0.55_0.01_250)] line-through">{x.o}</span> : <span />}
                  <span className={cn('whitespace-nowrap font-mono text-sm', x.forte ? 'font-semibold' : 'font-normal', x.tono && x.tono !== 'ink' ? TESTO[x.tono] : 'text-foreground')}>{x.v}</span>
                  {x.apribile ? <IcoGiu className="text-muted-foreground transition-transform duration-300" style={{ transform: `rotate(${x.apribile.aperto ? 180 : 0}deg)` }} /> : x.matita ? <IcoMatita /> : <span />}
                </Tag>
              )
            })}
          </div>
        ))}
      </div>
      {azioni && azioni.length > 0 && (
        <div className="grid flex-none gap-2.5 border-t border-border pb-4 pt-3" style={{ gridTemplateColumns: colonneAzioni ?? '1fr', paddingInline: tel ? 14 : 18 }}>
          {azioni.map(a => (
            <button key={a.l} type="button" onClick={a.on} disabled={a.disabled}
              className={cn('flex h-[52px] items-center justify-center gap-2 rounded-[8px] border text-[15px] font-semibold transition-[background-color,transform] duration-200 active:scale-[0.98] disabled:opacity-50',
                a.tipo === 'primario' && 'border-primary bg-primary text-primary-foreground',
                a.tipo === 'secondario' && 'border-line-strong bg-transparent text-foreground',
                a.tipo === 'pericolo' && 'border-line-strong bg-transparent text-neg',
                a.tipo === 'pericoloPieno' && 'border-neg bg-neg text-white dark:text-background')}>
              {a.l}
            </button>
          ))}
        </div>
      )}
      {tastierino && (tel || pos) && (
        <div data-kp="1"
          className="absolute z-40 drop-shadow-[0_12px_32px_rgba(20,30,50,.18)]"
          style={tel ? { left: 0, right: 0, bottom: 0 } : { left: pos!.x, top: pos!.y, transform: 'translate(-50%,-100%)' }}>
          <div className={tastierino.esce ? 'anim-swapout' : 'anim-swapin'}>
            {tel ? (
              <div className="flex justify-center border-t border-[oklch(0.88_0.01_250)] bg-[oklch(0.95_0.01_250/0.92)] pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2.5 dark:border-border dark:bg-background/95">
                <Tastierino onKey={tastierino.onKey} onDone={tastierino.onDone} senzaVirgola={tastierino.senzaVirgola} />
              </div>
            ) : (
              <Tastierino onKey={tastierino.onKey} onDone={tastierino.onDone} senzaVirgola={tastierino.senzaVirgola} />
            )}
          </div>
        </div>
      )}
    </>
  )
}

/** Andamento prezzo: area e linea teal su 300×90 (come il prototipo). */
function Spark({ h, valori, etichette }: { h: string; valori: number[]; etichette: string[] }) {
  const mx = Math.max(...valori) * 1.02, mn = Math.min(...valori) * 0.98, n = valori.length
  const pts = valori.map((v, q) => [n > 1 ? (q / (n - 1)) * 300 : 150, 86 - (mx === mn ? 0.5 : (v - mn) / (mx - mn)) * 80])
  const ln = 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L')
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">{h}</span>
      <div className="relative box-border h-[110px] rounded-[10px] bg-background px-3 py-2.5">
        <svg width="100%" height="90" viewBox="0 0 300 90" preserveAspectRatio="none" className="block" aria-hidden>
          <path d={ln + ' L300,90 L0,90 Z'} fill="oklch(0.58 0.12 180 / .12)" />
          <path d={ln} fill="none" stroke="oklch(0.58 0.12 180)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="flex justify-between font-mono text-[11px] font-medium text-[oklch(0.55_0.01_250)]">
        {etichette.map((e, i) => <span key={i}>{e}</span>)}
      </div>
    </div>
  )
}

/** Riquadro teal del tastierino (righe, giacenza): titolo e campi da 60 px. */
export function BloccoCampi({ titolo, campi, colonne = '1fr 1fr', children }: {
  titolo?: string
  campi: { k: string; l: string; v: string; u: string; on: boolean; tocca: () => void }[]
  colonne?: string
  children?: ReactNode
}) {
  return (
    <div data-kp="1" className="flex flex-col gap-3.5 rounded-[10px] border border-[oklch(0.88_0.03_180)] bg-[oklch(0.97_0.012_180)] p-4 dark:border-[oklch(0.35_0.04_180)] dark:bg-[oklch(0.22_0.02_180)]">
      {titolo && <span className="text-[15px] font-semibold">{titolo}</span>}
      <div className="grid gap-3" style={{ gridTemplateColumns: colonne }}>
        {campi.map(c => (
          <div key={c.k} className="flex min-w-0 flex-col gap-2">
            <span className="text-[13px] font-medium text-muted-foreground">{c.l}</span>
            <button type="button" data-kpfield={c.on ? 'on' : 'off'} onClick={c.tocca}
              className={cn('box-border flex h-[60px] items-center justify-center gap-2 rounded-[6px] bg-card font-mono text-2xl font-medium transition-[border-color] duration-200 active:scale-[0.99]',
                c.on ? 'border-[1.5px] border-[oklch(0.58_0.12_180)]' : 'border border-line-strong')}>
              {c.v}<span className="font-sans text-sm font-medium text-muted-foreground">{c.u}</span>
            </button>
          </div>
        ))}
      </div>
      {children}
    </div>
  )
}

/** Griglia di scelte (Categoria, Aliquota IVA) del riquadro teal. */
export function Scelte({ titolo, opzioni, colonne, mono }: { titolo: string; opzioni: { l: string; on: boolean; tocca: () => void }[]; colonne: number; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium text-muted-foreground">{titolo}</span>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colonne},1fr)` }}>
        {opzioni.map(o => (
          <button key={o.l} type="button" onClick={o.tocca}
            className={cn('flex h-12 items-center justify-center rounded-[6px] border text-[15px] font-medium transition-colors duration-200 active:scale-[0.97]', mono && 'font-mono',
              o.on ? 'border-primary bg-primary text-primary-foreground' : 'border-line-strong bg-card')}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  )
}
