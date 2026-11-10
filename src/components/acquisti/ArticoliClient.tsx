'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { friendlySaveError } from '@/lib/supabase/friendlyError'
import { toast } from '@/hooks/use-toast'
import { useTelefono } from '@/hooks/useTelefono'
import { useScheletro } from '@/components/shared/useScheletro'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { cn } from '@/lib/utils'
import type { ArticoloTipologia } from '@/types'
import { Vista, Pannello, type RigaVista } from './Vista'
import { IcoPiu, PiedeModale, MESI_BREVI, Modale, ORDINE_TIPOLOGIE, TIPOLOGIE, TZ, dataBreve, eu, localiDa, useUscita, type Tono } from './comuni'

// Articoli (MTAcquisti, sezione "articoli"): catalogo con ultimo prezzo e
// variazione a 30 giorni, filtri per tipologia; il dettaglio ha
// l'andamento del prezzo sulle ultime 10 fatture.

interface Props { restaurants: { id: string; name: string }[]; fornitori: { id: string; nome: string }[]; canEdit: boolean; single: boolean }
interface Acquisto { data: string; prezzo: number; restaurant_id: string; fattura_id: string; numero: string }
interface Articolo { id: string; nome: string; tipologia: ArticoloTipologia; unita: string | null; fornitore_id: string; fornitore: string; traccia: boolean; acquisti: Acquisto[] }

export function ArticoliClient({ restaurants, fornitori, canEdit, single }: Props) {
  const tel = useTelefono()
  const router = useRouter()
  const locali = useMemo(() => localiDa(restaurants), [restaurants])
  const [loc, setLoc] = useState<string | null>(null)
  const [tips, setTips] = useState<ArticoloTipologia[]>([])
  const [articoli, setArticoli] = useState<Articolo[]>([])
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const { stato: sk, avvia, pronto } = useScheletro()
  const meno30 = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 30); return formatInTimeZone(d, TZ, 'yyyy-MM-dd') }, [])

  const req = useRef(0)
  const carica = useCallback(async () => {
    const mio = ++req.current
    const sb = createClient()
    const { data: cat, error } = await sb.from('catalogo_articoli')
      .select('id, nome_articolo, tipologia, unita_misura, fattore_conversione, fornitore_id, traccia_in_inventario, fornitore:fornitori(nome)').order('nome_articolo')
    if (mio !== req.current) return
    if (error) { setErrore(friendlySaveError(error)); setCaricamento(false); pronto(); return }
    const rows = (cat ?? []) as unknown as { id: string; nome_articolo: string; tipologia: ArticoloTipologia; unita_misura: string | null; fattore_conversione: number; fornitore_id: string; traccia_in_inventario: boolean; fornitore: { nome: string } | null }[]
    const acq = new Map<string, Acquisto[]>()
    // A blocchi: un catalogo grande supererebbe la lunghezza dell'URL.
    for (let i = 0; i < rows.length; i += 150) {
      const { data } = await sb.from('fatture_articoli')
        .select('catalogo_articolo_id, prezzo_unitario, fattura:fatture!inner(id, data, restaurant_id, numero_documento)')
        .in('catalogo_articolo_id', rows.slice(i, i + 150).map(r => r.id))
      for (const s of (data ?? []) as unknown as { catalogo_articolo_id: string; prezzo_unitario: number; fattura: { id: string; data: string; restaurant_id: string; numero_documento: string } | null }[]) {
        if (!s.fattura) continue
        const a = acq.get(s.catalogo_articolo_id) ?? []
        a.push({ data: s.fattura.data, prezzo: Number(s.prezzo_unitario), restaurant_id: s.fattura.restaurant_id, fattura_id: s.fattura.id, numero: s.fattura.numero_documento })
        acq.set(s.catalogo_articolo_id, a)
      }
    }
    if (mio !== req.current) return
    setArticoli(rows.map(r => {
      const k = r.fattore_conversione || 1
      return {
        id: r.id, nome: r.nome_articolo, tipologia: r.tipologia, unita: r.unita_misura, fornitore_id: r.fornitore_id, fornitore: r.fornitore?.nome ?? '—', traccia: r.traccia_in_inventario,
        // Prezzo normalizzato col fattore di conversione dell'articolo.
        acquisti: (acq.get(r.id) ?? []).map(a => ({ ...a, prezzo: a.prezzo / k })).sort((p, q) => p.data.localeCompare(q.data)),
      }
    }))
    setErrore(null); setCaricamento(false); pronto()
  }, [pronto])
  useEffect(() => { carica() }, [carica])
  useEffect(() => {
    const sb = createClient()
    let t: ReturnType<typeof setTimeout> | null = null
    const ch = sb.channel('acquisti_articoli').on('postgres_changes', { event: '*', schema: 'public', table: 'catalogo_articoli' }, () => { if (t) clearTimeout(t); t = setTimeout(carica, 400) }).subscribe()
    return () => { if (t) clearTimeout(t); sb.removeChannel(ch) }
  }, [carica])

  const acquistiDi = (a: Articolo) => (loc ? a.acquisti.filter(x => x.restaurant_id === loc) : a.acquisti)
  const variazione = (a: Articolo) => {
    const s = acquistiDi(a)
    if (s.length < 2) return null
    const ultimo = s[s.length - 1], prima = [...s].reverse().find(x => x.data <= meno30) ?? null
    if (!prima || prima === ultimo || !prima.prezzo) return null
    return (ultimo.prezzo - prima.prezzo) / prima.prezzo * 100
  }
  const lista = articoli.filter(a => !tips.length || tips.includes(a.tipologia))
  const righe: RigaVista[] = lista.map(a => {
    const s = acquistiDi(a), v = variazione(a), ultimo = s[s.length - 1]
    const tono: Tono = v == null ? 'neu' : v > 2 ? 'neg' : v < -2 ? 'ok' : 'neu'
    return {
      id: a.id, a: a.nome, as: `${a.fornitore} · ${a.unita || 'pz'}`, lc: TIPOLOGIE[a.tipologia].c,
      b: ultimo ? eu(ultimo.prezzo) : '—', c: v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')}%`, cTono: tono,
      t: TIPOLOGIE[a.tipologia].l, tTono: 'neu', ord: [a.nome.toLowerCase(), ultimo?.prezzo ?? -1, v ?? -999, TIPOLOGIE[a.tipologia].l],
    }
  })
  const rincari = lista.filter(a => (variazione(a) ?? 0) > 2).length

  const traccia = async (a: Articolo) => {
    setArticoli(x => x.map(y => (y.id === a.id ? { ...y, traccia: !a.traccia } : y)))
    const { error } = await createClient().from('catalogo_articoli').update({ traccia_in_inventario: !a.traccia }).eq('id', a.id)
    if (error) { setArticoli(x => x.map(y => (y.id === a.id ? { ...y, traccia: a.traccia } : y))); toast({ title: `Modifica non riuscita: ${friendlySaveError(error)}`, variant: 'destructive' }); return }
    toast({ title: !a.traccia ? `${a.nome} ora è in Inventario` : `${a.nome} tolto da Inventario` })
  }

  const unita = useUscita<{ a: Articolo; v: string }>()
  const unisci = useUscita<{ a: Articolo; cerca: string; verso: string | null }>()
  const nuovo = useUscita<{ nome: string; fornitore: string; tipologia: ArticoloTipologia; unita: string; traccia: boolean }>()
  const [lavoro, setLavoro] = useState(false)

  async function salvaUnita() {
    const d = unita.dati
    if (!d) return
    setLavoro(true)
    const { error } = await createClient().from('catalogo_articoli').update({ unita_misura: d.v.trim() || null }).eq('id', d.a.id)
    setLavoro(false)
    if (error) { toast({ title: `Salvataggio non riuscito: ${friendlySaveError(error)}`, variant: 'destructive' }); return }
    unita.chiudi(); toast({ title: 'Unità di misura aggiornata' }); carica()
  }
  async function confermaUnione() {
    const d = unisci.dati
    if (!d?.verso) return
    setLavoro(true)
    const { error } = await createClient().rpc('unisci_articoli', { p_assorbito_id: d.a.id, p_mantenuto_id: d.verso })
    setLavoro(false)
    if (error) { toast({ title: `Unione non riuscita: ${friendlySaveError(error)}`, variant: 'destructive' }); return }
    unisci.chiudi(); setSel(null); toast({ title: `${d.a.nome} unito` }); carica()
  }
  async function creaArticolo() {
    const d = nuovo.dati
    if (!d) return
    if (!d.nome.trim() || !d.fornitore) { toast({ title: 'Nome e fornitore sono obbligatori', variant: 'destructive' }); return }
    setLavoro(true)
    const sb = createClient()
    // owner_id dal fornitore scelto: il catalogo è del gestore, non del locale.
    const { data: fo } = await sb.from('fornitori').select('owner_id').eq('id', d.fornitore).single()
    const { error } = await sb.from('catalogo_articoli').insert({ owner_id: fo?.owner_id, fornitore_id: d.fornitore, nome_articolo: d.nome.trim(), tipologia: d.tipologia, unita_misura: d.unita.trim() || null, traccia_in_inventario: d.traccia })
    setLavoro(false)
    if (error) { toast({ title: error.code === '23505' ? 'Esiste già un articolo con questo nome per questo fornitore' : `Creazione non riuscita: ${friendlySaveError(error)}`, variant: 'destructive' }); return }
    nuovo.chiudi(); toast({ title: `${d.nome.trim()} aggiunto al catalogo` }); carica()
  }

  const a = lista.find(x => x.id === sel)
  let dettaglio: React.ReactNode = null
  if (a) {
    const s = acquistiDi(a), u = a.unita || 'pz', ultimo = s[s.length - 1]
    const ult10 = s.slice(-10), prezzi = s.map(x => x.prezzo)
    const etichette = ult10.length > 1 ? Array.from({ length: 6 }, (_, k) => ult10[Math.round(k * (ult10.length - 1) / 5)].data.slice(5, 7)).map((m, k, arr) => (k > 0 && arr[k - 1] === m ? '' : MESI_BREVI[Number(m) - 1])) : []
    dettaglio = (
      <Pannello tel={tel} titolo={a.nome} sotto={`${a.fornitore} · unità ${u}`} badge={{ t: TIPOLOGIE[a.tipologia].l, tono: 'neu' }}
        stats={[{ l: 'Ultimo prezzo', v: ultimo ? `${eu(ultimo.prezzo)} / ${u}` : '—' }, { l: 'Minimo · massimo', v: prezzi.length ? `${eu(Math.min(...prezzi))} · ${eu(Math.max(...prezzi))}` : '—' }]}
        spark={ult10.length > 1 ? { h: `Andamento prezzo · ultime ${ult10.length} fatture`, valori: ult10.map(x => x.prezzo), etichette } : null}
        sezioni={[
          { h: 'Inventario', righe: [{ l: 'Traccia in inventario', v: a.traccia ? 'Sì' : 'No', on: canEdit ? () => traccia(a) : undefined, matita: canEdit }] },
          { h: 'Catalogo', righe: [
            { l: 'Unità di misura', v: u, on: canEdit ? () => unita.apri({ a, v: a.unita ?? '' }) : undefined, matita: canEdit },
            ...(ultimo ? [{ l: `Ultimo acquisto · n. ${ultimo.numero} · ${dataBreve(ultimo.data)}`, v: eu(ultimo.prezzo), on: () => router.push(`/acquisti/fatture?f=${ultimo.fattura_id}`), matita: false }] : []),
          ] },
        ]}
        azioni={canEdit ? [{ l: 'Unisci con un altro articolo', tipo: 'secondario', on: () => unisci.apri({ a, cerca: '', verso: null }) }] : undefined}
      />
    )
  }

  const CAMPO = 'box-border h-11 w-full rounded-[6px] border border-line-strong bg-card px-3 text-[15px] font-medium outline-none focus:border-[1.5px] focus:border-[oklch(0.58_0.12_180)]'
  const px = tel ? 'px-4' : 'px-[22px]'

  return (
    <>
      <Vista tel={tel} skeleton={sk}
        locali={single ? undefined : <PilloleLocali locali={locali} selezionati={loc ? [loc] : []} onCambia={v => { avvia(); setLoc(v[0] ?? null); setSel(null); setTimeout(pronto, 0) }} etichettaTutti="Tutti" className="sm:mx-0 sm:px-0" />}
        filtri={ORDINE_TIPOLOGIE.map(k => ({ k, l: TIPOLOGIE[k].l, on: tips.includes(k) }))}
        onFiltro={k => { setSel(null); setTips(p => { const r = p.includes(k as ArticoloTipologia) ? p.filter(x => x !== k) : [...p, k as ArticoloTipologia]; return r.length === ORDINE_TIPOLOGIE.length ? [] : r }) }}
        kpis={[{ l: 'Articoli', v: String(lista.length) }, { l: 'Rincari oltre 2%', v: String(rincari), tono: 'neg' }]}
        azione={canEdit ? (
          <button type="button" onClick={() => nuovo.apri({ nome: '', fornitore: fornitori[0]?.id ?? '', tipologia: 'food', unita: '', traccia: true })} className="flex h-10 items-center gap-2 rounded-[8px] bg-primary px-4 text-sm font-semibold text-primary-foreground active:scale-[0.97]"><IcoPiu />{tel ? 'Nuovo' : 'Nuovo articolo'}</button>
        ) : undefined}
        colonne={[{ l: 'Articolo' }, { l: 'Ultimo prezzo', destra: true }, { l: '30 gg', destra: true }, { l: 'Tipologia', destra: true }]}
        righe={righe} caricamento={caricamento}
        errore={errore ? { testo: errore, riprova: () => { avvia(); carica() } } : null}
        vuoto={{ t: 'Nessun articolo', s: tips.length ? 'Nessun articolo di queste tipologie a catalogo.' : 'Gli articoli letti dalle fatture compaiono qui.' }}
        sel={sel} onSel={setSel} onChiudi={() => setSel(null)} dettaglio={dettaglio} chiaveDettaglio={sel ?? ''}
      />
      {unita.dati && (
        <Modale tel={tel} esce={unita.esce} onChiudi={() => unita.chiudi()} titolo="Unità di misura" sotto={unita.dati.a.nome} piede={<PiedeModale tel={tel} onOk={salvaUnita} etichetta="Salva" disabilitato={lavoro} onAnnulla={() => unita.chiudi()} />}>
          <div className={cn('flex flex-col gap-1.5 py-4', px)}><input value={unita.dati.v} placeholder="kg, l, pz…" onChange={e => unita.setDati(d => (d ? { ...d, v: e.target.value } : d))} className={CAMPO} /></div>
        </Modale>
      )}
      {unisci.dati && (
        <Modale tel={tel} esce={unisci.esce} onChiudi={() => unisci.chiudi()} titolo="Unisci articolo" sotto={`Storico prezzi e giacenze di ${unisci.dati.a.nome} passano a quello scelto`}
          piede={<PiedeModale tel={tel} onOk={confermaUnione} etichetta="Unisci ed elimina il doppione" pericolo disabilitato={lavoro || !unisci.dati.verso} onAnnulla={() => unisci.chiudi()} />}>
          <div className={cn('flex flex-col gap-2 py-3', px)}>
            <input value={unisci.dati.cerca} placeholder="Cerca per nome o fornitore" onChange={e => unisci.setDati(d => (d ? { ...d, cerca: e.target.value } : d))} className={CAMPO} />
            <div className="flex max-h-[44dvh] flex-col gap-0.5 overflow-y-auto overscroll-contain">
              {articoli.filter(x => x.id !== unisci.dati!.a.id && (!unisci.dati!.cerca.trim() || `${x.nome} ${x.fornitore}`.toLowerCase().includes(unisci.dati!.cerca.trim().toLowerCase()))).slice(0, 80).map(x => (
                <button key={x.id} type="button" onClick={() => unisci.setDati(d => (d ? { ...d, verso: x.id } : d))}
                  className={cn('flex min-h-12 items-center justify-between gap-3 rounded-[10px] px-3 text-left text-sm font-medium active:scale-[0.98]', unisci.dati!.verso === x.id ? 'bg-primary text-primary-foreground' : 'hover:bg-background')}>
                  <span className="truncate">{x.nome}</span><span className="flex-none text-xs opacity-70">{x.fornitore}</span>
                </button>
              ))}
            </div>
          </div>
        </Modale>
      )}
      {nuovo.dati && (
        <Modale tel={tel} esce={nuovo.esce} onChiudi={() => nuovo.chiudi()} titolo="Nuovo articolo" sotto="Per una scorta mai vista in fattura" piede={<PiedeModale tel={tel} onOk={creaArticolo} etichetta="Crea articolo" disabilitato={lavoro} onAnnulla={() => nuovo.chiudi()} />}>
          <div className={cn('flex flex-col gap-3.5 py-4', px)}>
            <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Nome</span><input value={nuovo.dati.nome} onChange={e => nuovo.setDati(d => (d ? { ...d, nome: e.target.value } : d))} className={CAMPO} /></label>
            <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Fornitore</span>
              <select value={nuovo.dati.fornitore} onChange={e => nuovo.setDati(d => (d ? { ...d, fornitore: e.target.value } : d))} className={CAMPO}>{fornitori.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>
            </label>
            <div className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Tipologia</span>
              <div className="grid grid-cols-2 gap-1.5">{ORDINE_TIPOLOGIE.map(t => (
                <button key={t} type="button" onClick={() => nuovo.setDati(d => (d ? { ...d, tipologia: t } : d))} className={cn('h-11 rounded-[8px] border text-sm font-medium active:scale-[0.97]', nuovo.dati!.tipologia === t ? 'border-primary bg-primary text-primary-foreground' : 'border-line-strong bg-card')}>{TIPOLOGIE[t].l}</button>
              ))}</div>
            </div>
            <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Unità di misura</span><input value={nuovo.dati.unita} placeholder="kg, l, pz…" onChange={e => nuovo.setDati(d => (d ? { ...d, unita: e.target.value } : d))} className={CAMPO} /></label>
            <button type="button" onClick={() => nuovo.setDati(d => (d ? { ...d, traccia: !d.traccia } : d))} className="flex h-12 items-center justify-between rounded-[8px] border border-line-strong px-3.5 text-[15px] font-medium active:scale-[0.98]">
              Traccia in inventario<span className={cn('font-mono text-sm', nuovo.dati.traccia ? 'text-ok' : 'text-muted-foreground')}>{nuovo.dati.traccia ? 'Sì' : 'No'}</span>
            </button>
          </div>
        </Modale>
      )}
    </>
  )
}
