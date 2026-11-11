'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { friendlySaveError } from '@/lib/supabase/friendlyError'
import { toast } from '@/hooks/use-toast'
import { useTelefono } from '@/hooks/useTelefono'
import { useScheletro } from '@/components/shared/useScheletro'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { corrisponde } from '@/components/shared/CampoRicerca'
import { cn } from '@/lib/utils'
import type { ArticoloTipologia } from '@/types'
import { Vista, Pannello, type RigaVista } from './Vista'
import { Bottone, MESI_LUNGHI, Modale, TIPOLOGIE, TZ, dataBreve, etichettaMese, eu, fineMese, localiDa, spostaMese, useUscita } from './comuni'

// Fornitori (MTAcquisti, sezione "fornitori"): chi ha fatturato nel mese
// scelto con la barra mese (come Fatture; di default il mese corrente),
// ordinati per spesa netta, con tipologia prevalente; il dettaglio mostra
// spesa per locale, catalogo e ultime fatture del mese. Gli andamenti su
// più mesi stanno in Analisi.

interface Props { restaurants: { id: string; name: string }[]; canEdit: boolean; single: boolean }
interface FatturaF { id: string; restaurant_id: string; fornitore_id: string; numero: string; data: string; netto: number; lordo: number; categoria: string | null }
interface FornitoreF { id: string; nome: string; piva: string | null }
interface ArticoloCat { id: string; nome_articolo: string; tipologia: ArticoloTipologia; unita_misura: string | null; prezzo_corrente: number | null }

export function FornitoriClient({ restaurants, canEdit, single }: Props) {
  const tel = useTelefono()
  const locali = useMemo(() => localiDa(restaurants), [restaurants])
  const [loc, setLoc] = useState<string | null>(null)
  const [fatture, setFatture] = useState<FatturaF[]>([])
  const [anag, setAnag] = useState<Map<string, FornitoreF>>(new Map())
  const [tipi, setTipi] = useState<Map<string, ArticoloTipologia>>(new Map())
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [cerca, setCerca] = useState('')
  const [catalogo, setCatalogo] = useState<{ id: string; righe: ArticoloCat[] } | null>(null)
  const { stato: sk, avvia, pronto } = useScheletro()

  const meseOggi = formatInTimeZone(new Date(), TZ, 'yyyy-MM')
  const [mese, setMese] = useState(meseOggi)
  const MESE = MESI_LUNGHI[Number(mese.slice(5)) - 1]
  const cambiaMese = (n: number) => { const m = spostaMese(mese, n); if (m > meseOggi) return; avvia(); setMese(m); setSel(null) }
  const req = useRef(0)
  const carica = useCallback(async () => {
    const mio = ++req.current
    const sb = createClient()
    const ids = restaurants.map(r => r.id)
    const [f, c, a] = await Promise.all([
      sb.from('fatture').select('id, restaurant_id, fornitore_id, numero_documento, data, totale_netto, totale_lordo, categoria_diretta:categorie_fatture_dirette(nome)').in('restaurant_id', ids).gte('data', `${mese}-01`).lte('data', fineMese(mese)).order('data', { ascending: false }),
      sb.from('catalogo_articoli').select('fornitore_id, tipologia'),
      sb.from('fornitori').select('id, nome, partita_iva'),
    ])
    if (mio !== req.current) return
    if (f.error) { setErrore(friendlySaveError(f.error)); setCaricamento(false); pronto(); return }
    setErrore(null)
    setFatture(((f.data ?? []) as unknown as { id: string; restaurant_id: string; fornitore_id: string; numero_documento: string; data: string; totale_netto: number; totale_lordo: number; categoria_diretta: { nome: string } | null }[])
      .map(x => ({ id: x.id, restaurant_id: x.restaurant_id, fornitore_id: x.fornitore_id, numero: x.numero_documento, data: x.data, netto: Number(x.totale_netto), lordo: Number(x.totale_lordo), categoria: x.categoria_diretta?.nome ?? null })))
    // Tipologia prevalente fra gli articoli a catalogo del fornitore.
    const conti = new Map<string, Map<ArticoloTipologia, number>>()
    for (const r of (c.data ?? []) as { fornitore_id: string; tipologia: ArticoloTipologia }[]) {
      const m = conti.get(r.fornitore_id) ?? new Map(); m.set(r.tipologia, (m.get(r.tipologia) ?? 0) + 1); conti.set(r.fornitore_id, m)
    }
    setTipi(new Map([...conti].map(([k, m]) => [k, [...m].sort((p, q) => q[1] - p[1])[0][0]])))
    setAnag(new Map(((a.data ?? []) as { id: string; nome: string; partita_iva: string | null }[]).map(x => [x.id, { id: x.id, nome: x.nome, piva: x.partita_iva }])))
    setCaricamento(false); pronto()
  }, [restaurants, mese, pronto])
  useEffect(() => { carica() }, [carica])

  const F = loc ? fatture.filter(f => f.restaurant_id === loc) : fatture
  const agg = [...F.reduce((m, f) => { const a = m.get(f.fornitore_id) ?? []; a.push(f); return m.set(f.fornitore_id, a) }, new Map<string, FatturaF[]>())]
    .map(([id, fs]) => ({ id, fs, net: fs.reduce((t, f) => t + f.netto, 0), fo: anag.get(id) }))
    .sort((p, q) => q.net - p.net)
  const tot = agg.reduce((t, x) => t + x.net, 0)
  const tipoDi = (id: string, fs: FatturaF[]) => {
    const t = tipi.get(id)
    if (t) return { l: TIPOLOGIE[t].l, c: TIPOLOGIE[t].c }
    return { l: fs.find(f => f.categoria)?.categoria ?? 'Altro no food', c: TIPOLOGIE.altro_no_food.c }
  }

  // La ricerca restringe solo l'elenco: i numeri di riepilogo e la quota
  // sugli acquisti restano quelli di tutto il mese.
  const righe: RigaVista[] = agg.filter(x => corrisponde(cerca, x.fo?.nome)).map(x => {
    const t = tipoDi(x.id, x.fs)
    return { id: x.id, a: x.fo?.nome ?? '—', as: x.fo?.piva ? `P.IVA ${x.fo.piva}` : 'P.IVA non censita', lc: t.c, b: eu(x.net, 0), c: String(x.fs.length), cTono: 'neu', t: t.l, tTono: 'neu', ord: [(x.fo?.nome ?? '').toLowerCase(), x.net, x.fs.length, t.l] }
  })

  // Tablet: all'apertura il dettaglio mostra la prima riga invece del
  // riquadro vuoto (stato derivato; sul telefono aprirebbe un foglio).
  const selEff = sel ?? (tel ? null : righe[0]?.id ?? null)

  // Catalogo del fornitore scelto, con prezzo corrente (RPC esistente).
  useEffect(() => {
    if (!selEff) return
    let annullato = false
    createClient().rpc('fornitore_catalogo_con_prezzo', { p_fornitore_id: selEff }).then(({ data }) => {
      if (!annullato) setCatalogo({ id: selEff, righe: (data ?? []) as ArticoloCat[] })
    })
    return () => { annullato = true }
  }, [selEff])

  const mod = useUscita<{ id: string; nome: string; piva: string }>()
  const uni = useUscita<{ id: string; nome: string; verso: string | null }>()
  const [lavoro, setLavoro] = useState(false)

  async function salvaAnagrafica() {
    const d = mod.dati
    if (!d || !d.nome.trim()) { toast({ title: 'La ragione sociale non può essere vuota', variant: 'destructive' }); return }
    setLavoro(true)
    const { error } = await createClient().from('fornitori').update({ nome: d.nome.trim(), partita_iva: d.piva.trim() || null }).eq('id', d.id)
    setLavoro(false)
    if (error) { toast({ title: `Salvataggio non riuscito: ${friendlySaveError(error)}`, variant: 'destructive' }); return }
    mod.chiudi(); toast({ title: 'Fornitore aggiornato' }); carica()
  }
  async function unisci() {
    const d = uni.dati
    if (!d?.verso) return
    setLavoro(true)
    const { error } = await createClient().rpc('unisci_fornitori', { p_fornitore_da_assorbire: d.id, p_fornitore_da_mantenere: d.verso })
    setLavoro(false)
    if (error) { toast({ title: `Unione non riuscita: ${friendlySaveError(error)}`, variant: 'destructive' }); return }
    uni.chiudi(); setSel(null)
    toast({ title: `${d.nome} unito in ${anag.get(d.verso)?.nome ?? ''}` }); carica()
  }

  const x = agg.find(y => y.id === selEff)
  let dettaglio: React.ReactNode = null
  if (x) {
    const t = tipoDi(x.id, x.fs)
    const perLoc = locali.map(l => ({ l, v: x.fs.filter(f => f.restaurant_id === l.id).reduce((s, f) => s + f.netto, 0) })).filter(o => o.v > 0)
    const cat = catalogo?.id === x.id ? catalogo.righe : null
    dettaglio = (
      <Pannello tel={tel}
        titolo={x.fo?.nome ?? '—'}
        sotto={`${x.fo?.piva ? `P.IVA ${x.fo.piva}` : 'P.IVA non censita'} · ${t.l} · ${etichettaMese(mese)}`}
        badge={{ t: t.l, tono: 'neu' }}
        stats={[{ l: `Spesa netta ${MESE.toLowerCase()}`, v: eu(x.net) }, { l: 'Quota sugli acquisti', v: (tot ? (x.net / tot) * 100 : 0).toFixed(1).replace('.', ',') + '%' }]}
        sezioni={[
          ...(!single && perLoc.length ? [{ h: 'Per locale', righe: perLoc.map(o => ({ l: o.l.nome, v: eu(o.v) })) }] : []),
          { h: 'Articoli a catalogo', righe: cat === null ? [{ l: 'Caricamento…', v: '' }] : cat.length ? cat.map(a => ({ l: a.nome_articolo, v: a.prezzo_corrente != null ? `${eu(a.prezzo_corrente)} / ${a.unita_misura || 'pz'}` : '—' })) : [{ l: 'Nessun articolo a catalogo', v: '' }] },
          { h: 'Ultime fatture del mese', righe: x.fs.slice(0, 6).map(f => ({ l: `n. ${f.numero} · ${dataBreve(f.data)}${single ? '' : ` · ${locali.find(l => l.id === f.restaurant_id)?.nome ?? ''}`}`, v: eu(f.lordo) })) },
        ]}
        azioni={canEdit ? [
          { l: 'Unisci', tipo: 'secondario', on: () => uni.apri({ id: x.id, nome: x.fo?.nome ?? '', verso: null }) },
          { l: 'Modifica dati', tipo: 'secondario', on: () => mod.apri({ id: x.id, nome: x.fo?.nome ?? '', piva: x.fo?.piva ?? '' }) },
        ] : undefined}
        colonneAzioni="1fr 1fr"
      />
    )
  }

  const CAMPO = 'box-border h-11 w-full rounded-[6px] border border-line-strong bg-card px-3 text-[15px] font-medium outline-none focus:border-[1.5px] focus:border-[oklch(0.58_0.12_180)]'
  const px = tel ? 'px-4' : 'px-[22px]'

  return (
    <>
      <Vista tel={tel} skeleton={sk}
        locali={single ? undefined : <PilloleLocali locali={locali} selezionati={loc ? [loc] : []} onCambia={v => { avvia(); setLoc(v[0] ?? null); setSel(null); setTimeout(pronto, 0) }} className="sm:mx-0 sm:px-0" />}
        ricerca={{ valore: cerca, onCambia: v => { setCerca(v); setSel(null) }, segnaposto: 'Cerca fornitore' }}
        mese={{ etichetta: etichettaMese(mese), prec: () => cambiaMese(-1), succ: () => cambiaMese(1), precOk: true, succOk: mese < meseOggi }}
        kpis={[{ l: 'Fornitori attivi', v: String(agg.length) }, { l: `Spesa netta ${MESE.toLowerCase()}`, v: eu(tot, 0) }]}
        colonne={[{ l: 'Fornitore' }, { l: 'Spesa netta', destra: true }, { l: 'Fatture', destra: true }, { l: 'Tipologia', destra: true }]}
        righe={righe} caricamento={caricamento}
        errore={errore ? { testo: errore, riprova: () => { avvia(); carica() } } : null}
        vuoto={cerca.trim() && agg.length ? { t: `Nessun risultato per «${cerca.trim()}»`, s: `Nessun fornitore con fatture in ${MESE.toLowerCase()} ha questo nome.` } : { t: 'Nessun fornitore attivo', s: `I fornitori con fatture in ${MESE.toLowerCase()} compaiono qui.` }}
        sel={selEff} onSel={setSel} onFissa={() => { if (sel === null && selEff) setSel(selEff) }} onChiudi={() => setSel(null)} dettaglio={dettaglio} chiaveDettaglio={selEff ?? ''}
      />
      {mod.dati && (
        <Modale tel={tel} esce={mod.esce} onChiudi={() => mod.chiudi()} titolo="Dati del fornitore" sotto={mod.dati.nome}
          piede={<div className={cn('grid grid-cols-[1fr_1.6fr] gap-2.5 border-t border-border py-3', px)}><Bottone onClick={() => mod.chiudi()}>Annulla</Bottone><Bottone tipo="primario" disabled={lavoro} onClick={salvaAnagrafica}>Salva</Bottone></div>}>
          <div className={cn('flex flex-col gap-3.5 py-4', px)}>
            <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Ragione sociale</span><input value={mod.dati.nome} onChange={e => mod.setDati(d => (d ? { ...d, nome: e.target.value } : d))} className={CAMPO} /></label>
            <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Partita IVA</span><input value={mod.dati.piva} onChange={e => mod.setDati(d => (d ? { ...d, piva: e.target.value } : d))} className={cn(CAMPO, 'font-mono')} /></label>
          </div>
        </Modale>
      )}
      {uni.dati && (
        <Modale tel={tel} esce={uni.esce} onChiudi={() => uni.chiudi()} titolo="Unisci fornitore" sotto={`Fatture e catalogo di ${uni.dati.nome} passano a quello scelto`}
          piede={<div className={cn('grid grid-cols-[1fr_1.6fr] gap-2.5 border-t border-border py-3', px)}><Bottone onClick={() => uni.chiudi()}>Annulla</Bottone><Bottone tipo="pericoloPieno" disabled={lavoro || !uni.dati.verso} onClick={unisci}>Unisci ed elimina il doppione</Bottone></div>}>
          <div className="flex max-h-[50dvh] flex-col gap-0.5 overflow-y-auto p-2">
            {[...anag.values()].filter(f => f.id !== uni.dati!.id).sort((p, q) => p.nome.localeCompare(q.nome, 'it')).map(f => (
              <button key={f.id} type="button" onClick={() => uni.setDati(d => (d ? { ...d, verso: f.id } : d))}
                className={cn('flex min-h-12 items-center justify-between gap-3 rounded-[10px] px-3.5 text-left text-[15px] font-medium active:scale-[0.98]', uni.dati!.verso === f.id ? 'bg-primary text-primary-foreground' : 'hover:bg-background')}>
                <span className="truncate">{f.nome}</span><span className="flex-none font-mono text-xs opacity-70">{f.piva ?? ''}</span>
              </button>
            ))}
          </div>
        </Modale>
      )}
    </>
  )
}
