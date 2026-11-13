'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { caricaChiusure, caricaVoci } from '@/components/cassa/analisi/dati'
import { CampoCassa, Foglio, IconaPiu, MenuScelta, NavMese, Pillola, eur, eur0, useApriChiudi, useTelefono } from '@/components/cassa/comuni'
import {
  CATEGORIE_COSTO, IVA_RICAVI, RIFERIMENTI, contoEconomico, nomeCategoria, quota, valeNelMese,
  type CategoriaCosto, type CostoGestione, type FatturaMese, type SpesaContanti,
} from '@/lib/utile'

// Cassa → Utile: conto economico del mese per i locali scelti. Incassi,
// spese in contanti e fatture arrivano da sole; il manager aggiunge le
// spese di gestione che l'app non conosce (personale, affitto, utenze...).

const TZ = 'Europe/Rome'
const CARD = 'anim-swapin flex min-w-0 flex-col rounded-[12px] border border-border bg-card'
const MUTO = 'text-muted-foreground'
const MIN_MESE = '2025-01'

interface Props { restaurants: { id: string; name: string }[] }

const pcTesto = (v: number, base: number) => (base > 0 ? `${((v / base) * 100).toFixed(1).replace('.', ',')}%` : '—')
const mesePrima = (m: string) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm - 2, 1)).toISOString().slice(0, 10) }

async function caricaFatture(sb: ReturnType<typeof createClient>, locali: string[], a: string, b: string): Promise<{ righe: FatturaMese[]; errore: boolean }> {
  if (!locali.length) return { righe: [], errore: false }
  const { data, error } = await sb
    .from('fatture')
    .select('restaurant_id, totale_netto, ha_articoli, categoria:categorie_fatture_dirette(nome), fatture_articoli(prezzo_riga, catalogo_articolo:catalogo_articoli(tipologia))')
    .in('restaurant_id', locali).gte('data', a).lte('data', b)
  type R = { restaurant_id: string; totale_netto: number | null; ha_articoli: boolean; categoria: { nome: string } | null; fatture_articoli: { prezzo_riga: number; catalogo_articolo: { tipologia: string } | null }[] | null }
  return {
    errore: !!error,
    righe: ((data ?? []) as unknown as R[]).map(f => {
      const o: FatturaMese = { li: f.restaurant_id, netto: Number(f.totale_netto) || 0, diretta: f.ha_articoli ? null : (f.categoria?.nome ?? 'Altre fatture'), food: 0, beverage: 0, materiali: 0 }
      for (const r of f.fatture_articoli ?? []) {
        const v = Number(r.prezzo_riga) || 0, tp = r.catalogo_articolo?.tipologia
        if (tp === 'food') o.food += v
        else if (tp === 'beverage') o.beverage += v
        else o.materiali += v
      }
      return o
    }),
  }
}

export function UtileClient({ restaurants }: Props) {
  const tel = useTelefono()
  const oggi = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const meseOggi = oggi.slice(0, 7)
  const [mese, setMese] = useState(meseOggi)
  const [sel, setSel] = useState<string[]>([])
  const locali = useMemo(() => restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) })), [restaurants])
  const ids = useMemo(() => (sel.length ? sel : restaurants.map(r => r.id)), [sel, restaurants])
  const nomeDi = useMemo(() => new Map(restaurants.map(r => [r.id, r.name])), [restaurants])

  const [stato, setStato] = useState<'carica' | 'ok' | 'errore'>('carica')
  const [incassi, setIncassi] = useState(0)
  const [contanti, setContanti] = useState<SpesaContanti[]>([])
  const [giorniChiusi, setGiorniChiusi] = useState(0)
  const [fatture, setFatture] = useState<FatturaMese[]>([])
  const [costi, setCosti] = useState<CostoGestione[]>([])
  const richiesta = useRef(0)

  const m01 = `${mese}-01`
  const carica = useCallback(async () => {
    const n = ++richiesta.current
    setStato(s => (s === 'ok' ? 'ok' : 'carica'))
    const sb = createClient()
    const [yy, mm] = mese.split('-').map(Number)
    const fine = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10)
    const [ch, fa, co] = await Promise.all([
      caricaChiusure(sb, ids, m01, fine),
      caricaFatture(sb, ids, m01, fine),
      sb.from('costi_gestione').select('id, restaurant_ids, categoria, descrizione, importo, ricorrente, mese_da, mese_a')
        .overlaps('restaurant_ids', ids).lte('mese_da', m01).or(`mese_a.is.null,mese_a.gte.${m01}`),
    ])
    if (n !== richiesta.current) return
    // Spese in contanti con la loro categoria di cassa: finiscono nella
    // voce corrispondente del conto (personale, merci, utenze...).
    const sp = ch.errore ? { voci: [], errore: true } : await caricaVoci(sb, ch.righe, 'spese')
    if (n !== richiesta.current) return
    if (ch.errore || fa.errore || co.error || sp.errore) { setStato('errore'); return }
    setIncassi(ch.righe.reduce((t, r) => t + r.ent, 0))
    setContanti(sp.voci.map(v => ({ categoria: v.categoria, importo: v.importo })))
    setGiorniChiusi(new Set(ch.righe.map(r => r.data)).size)
    setFatture(fa.righe)
    setCosti(((co.data ?? []) as CostoGestione[]).map(c => ({ ...c, importo: Number(c.importo) || 0 })).filter(c => valeNelMese(c, m01)))
    setStato('ok')
  }, [ids, mese, m01])
  useEffect(() => { carica() }, [carica])

  const insieme = useMemo(() => new Set(ids), [ids])
  const ce = useMemo(() => contoEconomico({ incassi, contanti, fatture, costi, locali: insieme }), [incassi, contanti, fatture, costi, insieme])
  const inCorso = mese === meseOggi
  const senzaPersonale = stato === 'ok' && ce.personaleMano === 0

  // ── Foglio della spesa ────────────────────────────────────────────────
  const foglio = useApriChiudi()
  const [voce, setVoce] = useState<CostoGestione | null>(null)
  const [fCat, setFCat] = useState<CategoriaCosto | null>(null)
  const [fDesc, setFDesc] = useState('')
  const [fImp, setFImp] = useState<number | null>(null)
  const [fLoc, setFLoc] = useState<string[]>([])
  const [fRic, setFRic] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [tentato, setTentato] = useState(false)

  const apriNuova = (cat?: CategoriaCosto) => {
    setVoce(null); setFCat(cat ?? null); setFDesc(''); setFImp(null); setFLoc(sel.length === 1 ? sel : []); setFRic(cat === 'affitto'); setTentato(false)
    foglio.apri()
  }
  const apriVoce = (c: CostoGestione) => {
    setVoce(c); setFCat(c.categoria); setFDesc(c.descrizione ?? ''); setFImp(c.importo)
    setFLoc(c.restaurant_ids.length === restaurants.length ? [] : c.restaurant_ids); setFRic(c.ricorrente); setTentato(false)
    foglio.apri()
  }
  // Una voce ricorrente iniziata prima di questo mese: le modifiche valgono
  // da questo mese in poi, i mesi passati restano com'erano.
  const daQuestoMese = !!voce && voce.ricorrente && voce.mese_da < m01

  async function salva() {
    setTentato(true)
    if (!fCat || fImp === null || fImp <= 0) return
    setSalvo(true)
    const sb = createClient()
    const campi = {
      restaurant_ids: fLoc.length ? fLoc : restaurants.map(r => r.id), categoria: fCat,
      descrizione: fDesc.trim() || null, importo: Math.round(fImp * 100) / 100, ricorrente: fRic,
    }
    let errore: string | null = null
    if (!voce) {
      const { error } = await sb.from('costi_gestione').insert({ ...campi, mese_da: m01, mese_a: null })
      errore = error?.message ?? null
    } else if (!daQuestoMese) {
      const { error } = await sb.from('costi_gestione').update({ ...campi, mese_a: fRic ? voce.mese_a : null }).eq('id', voce.id)
      errore = error?.message ?? null
    } else {
      const { error: e1 } = await sb.from('costi_gestione').update({ mese_a: mesePrima(mese) }).eq('id', voce.id)
      const { error: e2 } = e1 ? { error: e1 } : await sb.from('costi_gestione').insert({ ...campi, mese_da: m01, mese_a: fRic ? voce.mese_a : null })
      errore = e2?.message ?? null
    }
    setSalvo(false)
    if (errore) { toast({ title: 'Salvataggio non riuscito. Riprova.', variant: 'destructive' }); return }
    foglio.chiudi()
    toast({ title: voce ? 'Spesa aggiornata' : 'Spesa aggiunta' })
    carica()
  }

  async function elimina() {
    if (!voce) return
    setSalvo(true)
    const sb = createClient()
    const { error } = daQuestoMese
      ? await sb.from('costi_gestione').update({ mese_a: mesePrima(mese) }).eq('id', voce.id)
      : await sb.from('costi_gestione').delete().eq('id', voce.id)
    setSalvo(false)
    if (error) { toast({ title: 'Operazione non riuscita. Riprova.', variant: 'destructive' }); return }
    foglio.chiudi()
    toast({ title: daQuestoMese ? 'Spesa interrotta da questo mese' : 'Spesa eliminata' })
    carica()
  }

  // ── Righe del conto economico ─────────────────────────────────────────
  type Riga = { l: string; s?: string; v: number; tipo?: 'totale' | 'utile' | 'sotto'; rif?: { da: number; a: number }; on?: () => void }
  const sezioni: { t: string; righe: Riga[] }[] = [
    {
      t: 'Ricavi', righe: [
        { l: 'Incassi', s: `IVA inclusa · ${giorniChiusi} ${giorniChiusi === 1 ? 'chiusura' : 'giorni'}`, v: ce.incassi, tipo: 'sotto' },
        { l: 'Ricavi netti', s: `scorporata l'IVA del ${IVA_RICAVI * 100}%`, v: ce.ricavi, tipo: 'totale' },
      ],
    },
    {
      t: 'Costo del venduto', righe: [
        { l: 'Food', s: 'fatture, netto', v: ce.food },
        { l: 'Beverage', s: 'fatture, netto', v: ce.beverage },
        ...(ce.merciContanti > 0 ? [{ l: 'Merce pagata in contanti', s: 'spese di cassa: Fornitori', v: ce.merciContanti }] : []),
        { l: 'Costo merci', v: ce.merci, tipo: 'totale', rif: RIFERIMENTI.food },
      ],
    },
    {
      t: 'Personale', righe: [
        { l: 'Buste paga e contributi', s: ce.personaleMano ? 'inseriti a mano' : 'non inseriti · tocca per aggiungere', v: ce.personaleMano, on: ce.personaleMano ? undefined : () => apriNuova('personale') },
        { l: 'Personale in contanti', s: 'spese di cassa: Personale, Extra personale', v: ce.personaleContanti },
        { l: 'Personale', v: ce.personale, tipo: 'totale', rif: RIFERIMENTI.personale },
        { l: 'Prime cost', s: 'merci + personale', v: ce.primeCost, tipo: 'totale', rif: RIFERIMENTI.primeCost },
      ],
    },
    {
      t: 'Costi operativi', righe: [
        { l: 'Detergenza e materiali', s: 'fatture, netto', v: ce.materiali },
        ...ce.operativi.map(o => ({ l: o.l, s: o.fonti.join(' + '), v: o.v })),
      ],
    },
  ]
  const rifTono = (v: number, r: { da: number; a: number }) => {
    if (ce.ricavi <= 0) return null
    const p = (v / ce.ricavi) * 100
    return p > r.a ? 'neg' as const : p < r.da ? 'ok' as const : 'neu' as const
  }

  const kpi = [
    { l: 'Ricavi netti', v: eur0(ce.ricavi), s: `${eur0(ce.incassi)} IVA inclusa` },
    { l: 'Costi', v: eur0(ce.costi), s: pcTesto(ce.costi, ce.ricavi) + ' dei ricavi' },
    { l: 'Utile operativo', v: (ce.utile < 0 ? '−' : '') + eur0(ce.utile), s: `margine ${pcTesto(ce.utile, ce.ricavi)}`, tono: ce.utile < 0 ? 'neg' : 'ok' },
    { l: 'Prime cost', v: pcTesto(ce.primeCost, ce.ricavi), s: `riferimento ${RIFERIMENTI.primeCost.da}–${RIFERIMENTI.primeCost.a}%` },
  ]

  const vociOrdinate = [...costi].sort((a, b) => CATEGORIE_COSTO.findIndex(c => c.k === a.categoria) - CATEGORIE_COSTO.findIndex(c => c.k === b.categoria))

  return (
    <div className="flex flex-col">
      <div className={cn('relative z-[45] flex pb-3.5', tel ? 'flex-col items-stretch gap-2' : 'flex-nowrap items-center gap-3')}>
        <PilloleLocali multipla tuttiComeVuoto locali={locali} selezionati={sel} onCambia={setSel} className={tel ? '' : 'mx-0 flex-[0_1_auto] px-0'} />
        {!tel && <span className="flex-1" />}
        <NavMese mese={mese} min={MIN_MESE} max={meseOggi} onCambia={setMese} />
        <button type="button" onClick={() => apriNuova()}
          className="flex h-11 flex-none items-center justify-center gap-2 rounded-[10px] bg-foreground px-4 text-sm font-semibold text-background active:scale-[0.97]">
          <IconaPiu /> Nuova spesa
        </button>
      </div>

      {stato === 'errore' ? (
        <div className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center">
          <span className="text-[15px] font-semibold text-neg">Caricamento non riuscito</span>
          <button type="button" onClick={carica} className="mt-3 h-11 rounded-[12px] border border-line-strong bg-card px-[18px] text-sm font-semibold active:scale-[0.97]">Riprova</button>
        </div>
      ) : stato === 'carica' ? (
        <div className="flex flex-col gap-3 py-4">
          {[70, 92, 55, 80].map(w => <div key={w} className="h-4 rounded-[6px] bg-[linear-gradient(90deg,var(--sk-a)_25%,var(--sk-b)_50%,var(--sk-a)_75%)] bg-[length:200%_100%] [animation:sk-sh_1.4s_linear_infinite]" style={{ width: `${w}%` }} />)}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {(inCorso || senzaPersonale) && (
            <div className="anim-swapin rounded-[12px] bg-warn-tint px-4 py-3 text-[13px] leading-5 text-warn">
              {inCorso && 'Mese in corso: gli incassi sono parziali, mentre le spese mensili contano per intero. '}
              {senzaPersonale && 'Buste paga e contributi non sono ancora inseriti: il personale conta solo la parte pagata in contanti e l\'utile risulta più alto del reale.'}
            </div>
          )}

          <div className={cn('grid gap-3', tel ? 'grid-cols-2' : 'grid-cols-4')}>
            {kpi.map((k, i) => (
              <div key={k.l} className={cn(CARD, 'gap-1 px-4 py-3.5')} style={{ animationDelay: `${i * 50}ms` }}>
                <span className={cn('text-[10px] font-semibold uppercase tracking-[.06em]', MUTO)}>{k.l}</span>
                <span className={cn('font-mono text-[22px] font-semibold tabular-nums', k.tono === 'neg' && 'text-neg', k.tono === 'ok' && 'text-ok')}>{k.v}</span>
                <span className={cn('text-xs', MUTO)}>{k.s}</span>
              </div>
            ))}
          </div>

          <div className={cn('grid gap-4', !tel && 'lg:grid-cols-[minmax(0,1fr)_400px]')}>
            {/* Conto economico */}
            <div className={cn(CARD, 'overflow-hidden')} style={{ animationDelay: '180ms' }}>
              <div className="flex items-baseline gap-3 border-b border-border px-5 py-3.5">
                <span className="text-[17px] font-semibold">Conto economico</span>
                <span className={cn('text-[13px]', MUTO)}>% sui ricavi netti</span>
              </div>
              {sezioni.map(sz => (
                <div key={sz.t} className="border-b border-border last:border-b-0">
                  <div className={cn('px-5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[.06em]', MUTO)}>{sz.t}</div>
                  {sz.righe.map(r => {
                    const tono = r.rif ? rifTono(r.v, r.rif) : null
                    const Tag = r.on ? 'button' : 'div'
                    return (
                      <Tag key={r.l} type={r.on ? 'button' : undefined} onClick={r.on}
                        className={cn('flex w-full items-center gap-3 px-5 py-2.5 text-left', r.on && 'active:bg-secondary/60')}>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className={cn('text-[15px]', r.tipo === 'totale' ? 'font-semibold' : 'font-medium', r.tipo === 'sotto' && MUTO)}>{r.l}</span>
                          {(r.s || r.rif) && <span className={cn('text-xs', r.on ? 'text-warn' : MUTO)}>{r.s}{r.rif && `${r.s ? ' · ' : ''}rif. ${r.rif.da}–${r.rif.a}%`}</span>}
                        </span>
                        {r.tipo !== 'sotto' && sz.t !== 'Ricavi' && (
                          tono ? <Pillola tono={tono}>{pcTesto(r.v, ce.ricavi)}</Pillola> : <span className={cn('font-mono text-xs tabular-nums', MUTO)}>{pcTesto(r.v, ce.ricavi)}</span>
                        )}
                        <span className={cn('w-[108px] flex-none text-right font-mono text-[15px] tabular-nums', r.tipo === 'totale' && 'font-semibold', r.tipo === 'sotto' && MUTO)}>{eur0(r.v)}</span>
                      </Tag>
                    )
                  })}
                </div>
              ))}
              <div className="flex items-center gap-3 bg-[oklch(0.96_0.01_250)] px-5 py-4 dark:bg-secondary/50">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[17px] font-semibold">Utile operativo</span>
                  <span className={cn('text-xs', MUTO)}>prima di tasse, ammortamenti e interessi</span>
                </span>
                <span className={cn('font-mono text-xs tabular-nums', MUTO)}>{pcTesto(ce.utile, ce.ricavi)}</span>
                <span className={cn('w-[120px] flex-none text-right font-mono text-[19px] font-semibold tabular-nums', ce.utile < 0 ? 'text-neg' : 'text-ok')}>{ce.utile < 0 ? '−' : ''}{eur0(ce.utile)}</span>
              </div>
            </div>

            {/* Spese inserite a mano */}
            <div className={cn(CARD, 'self-start overflow-hidden')} style={{ animationDelay: '240ms' }}>
              <div className="flex items-baseline gap-3 border-b border-border px-5 py-3.5">
                <span className="text-[17px] font-semibold">Spese di gestione</span>
                <span className={cn('text-[13px]', MUTO)}>inserite a mano · netto IVA</span>
              </div>
              {vociOrdinate.length === 0 ? (
                <div className="flex flex-col items-center gap-1 px-5 py-8 text-center">
                  <span className="text-[15px] font-semibold">Nessuna spesa per questo mese</span>
                  <span className={cn('text-[13px]', MUTO)}>Aggiungi personale, affitto, utenze, marketing e le altre spese che non passano da fatture o cassa.</span>
                  <button type="button" onClick={() => apriNuova('personale')} className="mt-3 h-11 rounded-[12px] border border-line-strong bg-card px-[18px] text-sm font-semibold active:scale-[0.97]">Aggiungi il personale</button>
                </div>
              ) : vociOrdinate.map(c => {
                const q = quota(c, insieme)
                const condivisa = c.restaurant_ids.length > 1
                return (
                  <button key={c.id} type="button" onClick={() => apriVoce(c)} className="flex w-full items-center gap-3 border-b border-border px-5 py-3 text-left last:border-b-0 active:bg-secondary/60">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-medium">{c.descrizione || nomeCategoria(c.categoria)}</span>
                        {c.ricorrente && <Pillola tono="neu">Ogni mese</Pillola>}
                      </span>
                      <span className={cn('truncate text-xs', MUTO)}>
                        {nomeCategoria(c.categoria)}
                        {condivisa ? ` · divisa fra ${c.restaurant_ids.length} locali` : restaurants.length > 1 ? ` · ${nomeDi.get(c.restaurant_ids[0]) ?? ''}` : ''}
                      </span>
                    </span>
                    <span className="flex flex-none flex-col items-end">
                      <span className="font-mono text-[15px] tabular-nums">{eur(q)}</span>
                      {Math.abs(q - c.importo) > 0.004 && <span className={cn('font-mono text-[11px] tabular-nums', MUTO)}>di {eur(c.importo)}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <p className={cn('px-1 text-xs leading-5', MUTO)}>
            Ricavi netti = incassi delle chiusure confermate senza IVA. Le fatture contano per la data del documento, al netto dell&apos;IVA; le spese in contanti per intero, nella voce della loro categoria.
            Le fasce di riferimento sono indicative per un ristorante con servizio al tavolo.
          </p>
        </div>
      )}

      <Foglio aperto={foglio.aperto} esce={foglio.esce} onChiudi={foglio.chiudi}
        titolo={voce ? 'Modifica spesa' : 'Nuova spesa'}
        sotto={daQuestoMese ? 'Le modifiche valgono da questo mese in poi' : `${mese === meseOggi ? 'Questo mese' : 'Mese di riferimento'}: ${new Date(`${m01}T12:00:00Z`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}`}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Categoria</span>
            <MenuScelta valore={fCat} opzioni={CATEGORIE_COSTO.map(c => ({ k: c.k, l: c.l }))} onScegli={setFCat} vuoto="Scegli la categoria" />
            {tentato && !fCat && <span className="text-xs text-neg">Scegli una categoria</span>}
            {fCat && <span className={cn('text-xs', MUTO)}>{CATEGORIE_COSTO.find(c => c.k === fCat)?.esempio}</span>}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Descrizione <span className={cn('font-normal', MUTO)}>(facoltativa)</span></span>
            <input value={fDesc} onChange={e => setFDesc(e.target.value)} maxLength={80} placeholder="Es. buste paga ottobre"
              className="h-12 rounded-[12px] border border-line-strong bg-card px-4 text-[15px] outline-none placeholder:text-muted-foreground focus:border-[oklch(0.58_0.12_180)]" />
          </label>
          <CampoCassa etichetta="Importo" nota="NETTO IVA" valore={fImp} onCambia={setFImp} taglia="l" errore={tentato && !(fImp && fImp > 0)} />
          {restaurants.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Locali</span>
              <PilloleLocali multipla tuttiComeVuoto nascondiSeUno={false} etichettaTutti="Tutti i locali" locali={locali} selezionati={fLoc} onCambia={setFLoc} className="mx-0 px-0" />
              <span className={cn('text-xs', MUTO)}>{(fLoc.length || restaurants.length) > 1 ? 'L\'importo si divide in parti uguali fra i locali scelti' : 'Solo per questo locale'}</span>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Si ripete</span>
            <div className="grid grid-cols-2 gap-1.5">
              {[{ k: false, l: 'Solo questo mese' }, { k: true, l: 'Ogni mese' }].map(o => (
                <button key={o.l} type="button" onClick={() => setFRic(o.k)} aria-pressed={fRic === o.k}
                  className={cn('h-12 rounded-[10px] border text-sm font-medium active:scale-[0.98]', fRic === o.k ? 'border-foreground bg-foreground text-background' : 'border-line-strong bg-card')}>
                  {o.l}
                </button>
              ))}
            </div>
            {fRic && <span className={cn('text-xs', MUTO)}>Vale da questo mese finché non la interrompi (es. affitto, leasing, abbonamenti).</span>}
          </div>
          <div className={cn('grid gap-2.5 pt-1', voce ? 'grid-cols-[1fr_2fr]' : 'grid-cols-1')}>
            {voce && (
              <button type="button" disabled={salvo} onClick={elimina} className="h-12 rounded-[12px] border border-line-strong text-[15px] font-semibold text-neg active:scale-[0.98] disabled:opacity-60">
                {daQuestoMese ? 'Interrompi' : 'Elimina'}
              </button>
            )}
            <button type="button" disabled={salvo} onClick={salva} className="h-12 rounded-[12px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60">
              {salvo ? 'Salvataggio…' : voce ? 'Salva modifiche' : 'Aggiungi spesa'}
            </button>
          </div>
        </div>
      </Foglio>
    </div>
  )
}
