'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { friendlySaveError } from '@/lib/supabase/friendlyError'
import { toast } from '@/hooks/use-toast'
import { useTelefono } from '@/hooks/useTelefono'
import { useScheletro } from '@/components/shared/useScheletro'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import type { TastoTastierino } from '@/components/ui/tastierino'
import type { ArticoloTipologia, InventarioCausale } from '@/types'
import { Vista, Pannello, BloccoCampi, type RigaVista } from './Vista'
import { TIPOLOGIE, dataBreve, digita, eu, localiDa, nf, numeroDa, useToccoFuori, type Tono } from './comuni'

// Inventario (MTAcquisti, sezione "inventario"): giacenze del locale con
// scorta minima e stato; il conteggio si inserisce dal tastierino del
// dettaglio e diventa un movimento di rettifica (i movimenti sono un
// registro: non si modificano, si aggiungono).

const CAUSALI: Record<InventarioCausale, string> = {
  carico_manuale: 'Carico manuale', scarico_manuale: 'Scarico manuale', rettifica: 'Rettifica inventario', fattura: 'Carico da fattura', chiusura_cassa: 'Scarico da chiusure',
}

interface Props { restaurants: { id: string; name: string }[]; single: boolean }
// Righe del catalogo con lo stesso nome esatto (trim) sono un prodotto solo
// in Inventario; i movimenti nuovi vanno sul primo membro.
interface Gruppo { nome: string; tipologia: ArticoloTipologia; unita: string | null; fornitori: string[]; ids: string[]; primo: string; giacenza: number; prezzo: number | null; scorta: number | null; consumo30: number }

// Tabella della migrazione proposta: finché manca, niente scorta minima.
let conScorte = true

export function InventarioClient({ restaurants, single }: Props) {
  const tel = useTelefono()
  const locali = useMemo(() => localiDa(restaurants), [restaurants])
  const [loc, setLoc] = useState(restaurants[0]?.id ?? '')
  const [gruppi, setGruppi] = useState<Gruppo[]>([])
  const [scorteOk, setScorteOk] = useState(conScorte)
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [movimenti, setMovimenti] = useState<{ nome: string; righe: { q: number; c: InventarioCausale; d: string }[] } | null>(null)
  const [kp, setKp] = useState<{ campo: 'g' | 's'; v: string; esce: boolean } | null>(null)
  const { stato: sk, avvia, pronto } = useScheletro()

  const req = useRef(0)
  const carica = useCallback(async () => {
    if (!loc) { setCaricamento(false); pronto(); return }
    const mio = ++req.current
    const sb = createClient()
    const { data: cat, error } = await sb.from('catalogo_articoli').select('id, nome_articolo, tipologia, unita_misura, fattore_conversione, fornitore:fornitori(nome)').eq('traccia_in_inventario', true).order('nome_articolo')
    if (mio !== req.current) return
    if (error) { setErrore(friendlySaveError(error)); setCaricamento(false); pronto(); return }
    const arts = (cat ?? []) as unknown as { id: string; nome_articolo: string; tipologia: ArticoloTipologia; unita_misura: string | null; fattore_conversione: number; fornitore: { nome: string } | null }[]
    const ids = arts.map(a => a.id)
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString()
    const [gi, pr, mv, sc] = ids.length ? await Promise.all([
      sb.from('inventario_giacenze').select('catalogo_articolo_id, giacenza').eq('restaurant_id', loc).in('catalogo_articolo_id', ids),
      sb.from('fatture_articoli').select('catalogo_articolo_id, prezzo_unitario, fattura:fatture!inner(data)').in('catalogo_articolo_id', ids),
      sb.from('inventario_movimenti').select('catalogo_articolo_id, quantita').eq('restaurant_id', loc).in('catalogo_articolo_id', ids).lt('quantita', 0).neq('causale', 'rettifica').gte('created_at', d30),
      conScorte ? sb.from('inventario_scorte').select('catalogo_articolo_id, scorta_minima').eq('restaurant_id', loc).in('catalogo_articolo_id', ids) : Promise.resolve({ data: [], error: null }),
    ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [], error: null }]
    if (mio !== req.current) return
    if (sc.error) { conScorte = false; setScorteOk(false) }
    const gMap = new Map(((gi.data ?? []) as { catalogo_articolo_id: string; giacenza: number }[]).map(x => [x.catalogo_articolo_id, Number(x.giacenza)]))
    const ultimo = new Map<string, { d: string; p: number }>()
    for (const x of (pr.data ?? []) as unknown as { catalogo_articolo_id: string; prezzo_unitario: number; fattura: { data: string } | null }[]) {
      const u = ultimo.get(x.catalogo_articolo_id)
      if (x.fattura && (!u || x.fattura.data >= u.d)) ultimo.set(x.catalogo_articolo_id, { d: x.fattura.data, p: Number(x.prezzo_unitario) })
    }
    const consumo = new Map<string, number>()
    for (const x of (mv.data ?? []) as { catalogo_articolo_id: string; quantita: number }[]) consumo.set(x.catalogo_articolo_id, (consumo.get(x.catalogo_articolo_id) ?? 0) - Number(x.quantita))
    const scorte = new Map(((sc.error ? [] : sc.data ?? []) as { catalogo_articolo_id: string; scorta_minima: number }[]).map(x => [x.catalogo_articolo_id, Number(x.scorta_minima)]))

    const per = new Map<string, typeof arts>()
    arts.forEach(a => { const k = a.nome_articolo.trim(); per.set(k, [...(per.get(k) ?? []), a]) })
    setGruppi([...per].map(([nome, m]) => {
      const prezzi = m.map(x => ({ u: ultimo.get(x.id), k: x.fattore_conversione || 1 })).filter(x => x.u).sort((p, q) => q.u!.d.localeCompare(p.u!.d))
      const sco = m.map(x => scorte.get(x.id)).find(v => v != null)
      return {
        nome, tipologia: m[0].tipologia, unita: m.find(x => x.unita_misura)?.unita_misura ?? null,
        fornitori: [...new Set(m.map(x => x.fornitore?.nome ?? '—'))], ids: m.map(x => x.id), primo: m[0].id,
        giacenza: m.reduce((t, x) => t + (gMap.get(x.id) ?? 0), 0),
        prezzo: prezzi[0] ? prezzi[0].u!.p / prezzi[0].k : null,
        scorta: sco ?? null,
        consumo30: m.reduce((t, x) => t + (consumo.get(x.id) ?? 0), 0),
      }
    }))
    setErrore(null); setCaricamento(false); pronto()
  }, [loc, pronto])
  useEffect(() => { carica() }, [carica])
  useEffect(() => {
    if (!loc) return
    const sb = createClient()
    let t: ReturnType<typeof setTimeout> | null = null
    const ch = sb.channel(`acquisti_inventario_${loc}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventario_movimenti', filter: `restaurant_id=eq.${loc}` }, () => { if (t) clearTimeout(t); t = setTimeout(carica, 400) })
      .subscribe()
    return () => { if (t) clearTimeout(t); sb.removeChannel(ch) }
  }, [loc, carica])

  const stato = (g: Gruppo): { t: string; tono: Tono } => g.giacenza <= 0 ? { t: 'Esaurito', tono: 'neg' } : g.scorta != null && g.giacenza < g.scorta ? { t: 'Sotto scorta', tono: 'warn' } : { t: 'Ok', tono: 'ok' }
  const righe: RigaVista[] = gruppi.map(g => {
    const s = stato(g)
    return { id: g.nome, a: g.nome, as: g.fornitori.join(' · '), lc: TIPOLOGIE[g.tipologia].c, b: `${nf(g.giacenza)} ${g.unita || 'pz'}`, c: g.scorta != null ? nf(g.scorta) : '—', cTono: 'neu', t: s.t, tTono: s.tono, ord: [g.nome.toLowerCase(), g.giacenza, g.scorta ?? -1, s.tono === 'neg' ? 0 : s.tono === 'warn' ? 1 : 2] }
  })

  // Tablet: all'apertura il dettaglio mostra la prima riga invece del
  // riquadro vuoto (stato derivato; sul telefono aprirebbe un foglio).
  const selEff = sel ?? (tel ? null : righe[0]?.id ?? null)
  const g = gruppi.find(x => x.nome === selEff) ?? null
  // Ultimi movimenti del prodotto scelto.
  useEffect(() => {
    if (!g || !loc) return
    let annullato = false
    createClient().from('inventario_movimenti').select('quantita, causale, created_at').eq('restaurant_id', loc).in('catalogo_articolo_id', g.ids).order('created_at', { ascending: false }).limit(8)
      .then(({ data }) => { if (!annullato) setMovimenti({ nome: g.nome, righe: ((data ?? []) as { quantita: number; causale: InventarioCausale; created_at: string }[]).map(m => ({ q: Number(m.quantita), c: m.causale, d: m.created_at.slice(0, 10) })) }) })
    return () => { annullato = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ricarica per prodotto e locale, non a ogni nuovo array
  }, [g?.nome, g?.giacenza, loc])

  const chiudiKp = useCallback(() => {
    setKp(k => (k && !k.esce ? { ...k, esce: true } : k))
    setTimeout(() => setKp(k => (k?.esce ? null : k)), 320)
  }, [])
  useToccoFuori(!!kp && !kp.esce, '[data-kp]', chiudiKp)

  async function conferma() {
    const k = kp
    chiudiKp()
    if (!k || !g || k.v === '') return
    const v = numeroDa(k.v)
    if (v === null || v < 0) return
    const sb = createClient()
    if (k.campo === 'g') {
      const delta = Math.round((v - g.giacenza) * 1000) / 1000
      if (!delta) return
      setGruppi(x => x.map(y => (y.nome === g.nome ? { ...y, giacenza: v } : y)))
      const { data: { user } } = await sb.auth.getUser()
      const { error } = await sb.from('inventario_movimenti').insert({ restaurant_id: loc, catalogo_articolo_id: g.primo, quantita: delta, causale: 'rettifica', created_by: user?.id ?? null })
      if (error) { setGruppi(x => x.map(y => (y.nome === g.nome ? { ...y, giacenza: g.giacenza } : y))); toast({ title: `Giacenza non aggiornata: ${friendlySaveError(error)}`, variant: 'destructive' }); return }
      toast({ title: `Giacenza di ${g.nome} aggiornata a ${nf(v)} ${g.unita || 'pz'}` })
    } else {
      setGruppi(x => x.map(y => (y.nome === g.nome ? { ...y, scorta: v } : y)))
      const { error } = await sb.from('inventario_scorte').upsert({ restaurant_id: loc, catalogo_articolo_id: g.primo, scorta_minima: v }, { onConflict: 'restaurant_id,catalogo_articolo_id' })
      if (error) { setGruppi(x => x.map(y => (y.nome === g.nome ? { ...y, scorta: g.scorta } : y))); toast({ title: `Scorta minima non salvata: ${friendlySaveError(error)}`, variant: 'destructive' }); return }
      toast({ title: `Scorta minima di ${g.nome}: ${nf(v)} ${g.unita || 'pz'}` })
    }
  }

  let dettaglio: React.ReactNode = null
  if (g) {
    const s = stato(g), u = g.unita || 'pz'
    const mov = movimenti?.nome === g.nome ? movimenti.righe : null
    const campo = (k: 'g' | 's', l: string, val: number | null) => ({ k, l, u, v: kp && !kp.esce && kp.campo === k && kp.v !== '' ? kp.v : val == null ? '—' : nf(val), on: !!kp && !kp.esce && kp.campo === k, tocca: () => setKp({ campo: k, v: '', esce: false }) })
    dettaglio = (
      <Pannello tel={tel} titolo={g.nome} sotto={`${locali.find(l => l.id === loc)?.nome ?? ''} · ${g.fornitori.join(' · ')}`} badge={s}
        stats={[{ l: 'Valore', v: g.prezzo != null ? eu(Math.max(0, g.giacenza) * g.prezzo) : '—' }, { l: 'Consumo medio / giorno', v: `${nf(Math.round(g.consumo30 / 30 * 10) / 10)} ${u}` }]}
        blocco={<BloccoCampi colonne={scorteOk ? '1fr 1fr' : '1fr'} campi={[campo('g', 'Giacenza contata', g.giacenza), ...(scorteOk ? [campo('s', 'Scorta minima', g.scorta)] : [])]} />}
        sezioni={[{ h: 'Ultimi movimenti', righe: mov === null ? [{ l: 'Caricamento…', v: '' }] : mov.length ? mov.map(m => ({ l: `${CAUSALI[m.c] ?? m.c} · ${dataBreve(m.d)}`, v: `${m.q > 0 ? '+' : '−'}${nf(Math.abs(m.q))} ${u}`, tono: m.c === 'rettifica' ? 'ink' as const : m.q > 0 ? 'ok' as const : 'neg' as const })) : [{ l: 'Nessun movimento registrato', v: '' }] }]}
        tastierino={kp ? { esce: kp.esce, onKey: (t: TastoTastierino) => setKp(p => (p ? { ...p, v: digita(p.v, t, 3) } : p)), onDone: conferma } : null}
      />
    )
  }

  return (
    <Vista tel={tel} skeleton={sk}
      // Inventario è sempre di un locale: "Tutti" non cambia la scelta.
      locali={single ? undefined : <PilloleLocali locali={locali} selezionati={[loc]} onCambia={v => { if (!v[0] || v[0] === loc) return; avvia(); setLoc(v[0]); setSel(null); setKp(null) }} className="sm:mx-0 sm:px-0" />}
      kpis={[
        { l: 'Valore magazzino', v: eu(gruppi.reduce((t, x) => t + Math.max(0, x.giacenza) * (x.prezzo ?? 0), 0), 0) },
        { l: 'Sotto scorta', v: String(gruppi.filter(x => x.scorta != null && x.giacenza < x.scorta).length), tono: 'warn' },
      ]}
      colonne={[{ l: 'Articolo' }, { l: 'Giacenza', destra: true }, { l: 'Scorta min.', destra: true }, { l: 'Stato', destra: true }]}
      righe={righe} caricamento={caricamento}
      errore={errore ? { testo: errore, riprova: () => { avvia(); carica() } } : null}
      vuoto={{ t: 'Nessun articolo in inventario', s: 'In Articoli attiva "Traccia in inventario" sui prodotti da contare.' }}
      sel={selEff} onSel={id => { setKp(null); setSel(id) }}
      // Il conteggio si scrive sulla riga mostrata: al primo tocco la riga scelta da sola diventa la selezione vera.
      onFissa={() => { if (sel === null && selEff) setSel(selEff) }}
      onChiudi={() => { setKp(null); setSel(null) }} dettaglio={dettaglio} chiaveDettaglio={selEff ?? ''}
    />
  )
}
