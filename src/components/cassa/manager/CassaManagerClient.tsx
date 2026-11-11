'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'
import { chiediConferma } from '@/components/shared/Conferma'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { ScheletroForma } from '@/components/shared/ScheletroForma'
import { useScheletro } from '@/components/shared/useScheletro'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import { impostaSottotitolo } from '@/components/shell/intestazioneDinamica'
import { CassaFileViewer } from '@/components/cassa/CassaFileViewer'
import { colonnaMancante } from '@/components/cassa/FormSpesa'
import { sollecitaChiusura } from '@/app/actions/cassa'
import { leggiModifica, type ModificaLetta } from '@/app/api/cassa/modificaPayload'
import { friendlySaveError } from '@/lib/supabase/friendlyError'
import {
  Pillola, IconaX, Contenitore, NavMese, ChevronEspandi, TONO, useTelefono, USCITA,
  eur, eur0, dataBreve, dataLunga, meseNome, giornoSettimana, piuGiorni, type Tono,
} from '@/components/cassa/comuni'
import { cn } from '@/lib/utils'
import { createPortal } from 'react-dom'
import type { CassaChiusura, CassaSpesa } from '@/types'

// Cassa del manager (MTCassa, tablet e telefono): Chiusure, Approvazioni
// (modifiche in revisione) e Buste. Pillole dei locali, mese (solo
// Chiusure) e indicatori in alto; elenco a sinistra e dettaglio a destra
// su tablet, foglio dal basso sul telefono.

const TZ = 'Europe/Rome'
export type SezioneCassa = 'chiusure' | 'approvazioni' | 'buste'
// `nascosto`: locale chiuso/stagionale aperto in archivio (l'elenco arriva
// già filtrato dal server: o solo attivi, o il solo locale in archivio).
export interface LocaleCassa { id: string; name: string; closing_days: number[] | null; nascosto?: boolean | null }

const ETICHETTE: Record<string, string> = {
  entrate_contanti: 'Contanti', entrate_pos: 'POS', entrate_bonifico: 'Bonifico', incasso_asporto: 'Asporto',
  coperti: 'Coperti', fondo_cassa_iniziale: 'Fondo iniziale', fondo_cassa_finale: 'Fondo finale', contanti_per_banca: 'Contanti per banca',
}
const sg = (v: number) => (Math.abs(v) < 0.005 ? '€ 0,00' : `${v > 0 ? '+' : '−'}${eur(Math.abs(v))}`)
const r2 = (n: number) => Math.round(n * 100) / 100

interface RigaLista {
  k: string; li: string; giorno: string
  a: string; as: string; b: string; cl: string; c: string; banV: number
  t: string; tono: Tono; esce?: boolean
}
interface RigaDett { l: string; v: string; o?: string; w?: 400 | 600; c?: string; cambiata?: boolean; espandi?: { l: string; m: string; v: string }[] }
interface Dettaglio {
  titolo: string; sotto: string; t: string; tono: Tono
  msg?: { testo: string; tono: 'warn' | 'neg' | 'neu' }
  stats?: { l: string; v: string }[]
  secs: { h: string; righe: RigaDett[] }[]
  azioni: { l: string; stile: 'ink' | 'line' | 'neg'; fai: () => void }[]
  colsAzioni?: string
}
interface Mod { id: string; chiusura_id: string; payload: unknown; created_at: string; richiesto_da: string | null; chi: string; letta: ModificaLetta | null; ch: CassaChiusura | null }

export function CassaManagerClient({ sec, restaurants, selIniziale }: { sec: SezioneCassa; restaurants: LocaleCassa[]; selIniziale?: string }) {
  const tel = useTelefono()
  const sopraDock = (n: React.ReactNode) => (tel && typeof document !== 'undefined' ? createPortal(n, document.body) : n)
  const router = useRouter()
  const oggi = useMemo(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'), [])
  const ieri = piuGiorni(oggi, -1)
  const [loc, setLoc] = useState<string[]>([])
  const [mese, setMese] = useState(oggi.slice(0, 7))
  const [sel, setSel] = useState<string | null>(selIniziale ?? null)
  const [dEsce, setDEsce] = useState(false)
  const [spO, setSpO] = useState(false)
  const [errore, setErrore] = useState(false)
  const { stato: sk, avvia, pronto } = useScheletro()

  const [chiusure, setChiusure] = useState<CassaChiusura[]>([])
  const [primo, setPrimo] = useState<Record<string, string | null>>({})
  const [ultima, setUltima] = useState<Record<string, string | null>>({})
  const [modifiche, setModifiche] = useState<Mod[]>([])
  const [nomi, setNomi] = useState<Record<string, string>>({})
  const [cassieri, setCassieri] = useState<Record<string, string[]>>({})
  const [spese, setSpese] = useState<Record<string, CassaSpesa[]>>({})
  const [buste, setBuste] = useState<{ ch: CassaChiusura; n: number; vers: boolean }[]>([])
  const [busteSenzaColonne, setBusteSenzaColonne] = useState(false)
  const [uscite, setUscite] = useState<string[]>([])
  const [pdf, setPdf] = useState<CassaChiusura | null>(null)

  const locali = useMemo(() => restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) })), [restaurants])
  const info = useMemo(() => Object.fromEntries(locali.map(l => [l.id, l])), [locali])
  const target = useMemo(() => (loc.length ? loc : restaurants.map(r => r.id)), [loc, restaurants])
  const chiave = target.join(',')

  useEffect(() => { impostaSottotitolo(sec === 'chiusure' ? `${meseNome(`${mese}-01`)} ${mese.slice(0, 4)}` : null) }, [sec, mese])
  useEffect(() => () => impostaSottotitolo(null), [])

  // ── Caricamento ─────────────────────────────────────────────────────
  const req = useRef(0)
  const carica = useCallback(async () => {
    const mio = ++req.current
    const sb = createClient()
    const ids = chiave ? chiave.split(',') : []
    try {
      if (sec === 'chiusure') {
        const [y, m] = mese.split('-').map(Number)
        const fine = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
        const [{ data: cs, error }, prim, ult, { data: cas }] = await Promise.all([
          sb.from('cassa_chiusure').select('*').in('restaurant_id', ids).gte('data', `${mese}-01`).lte('data', fine).order('data', { ascending: false }),
          Promise.all(ids.map(id => sb.from('cassa_chiusure').select('data').eq('restaurant_id', id).eq('stato', 'confermata').order('data').limit(1).maybeSingle().then(r => [id, r.data?.data ?? null] as const))),
          // Di un locale in archivio serve anche l'ultima chiusura: dopo
          // quella il locale è chiuso, i giorni non sono "mancanti".
          Promise.all(restaurants.filter(r => r.nascosto && ids.includes(r.id)).map(r => sb.from('cassa_chiusure').select('data').eq('restaurant_id', r.id).eq('stato', 'confermata').order('data', { ascending: false }).limit(1).maybeSingle().then(x => [r.id, x.data?.data ?? null] as const))),
          sb.from('profiles').select('full_name, restaurant_id').eq('role', 'cassiere').in('restaurant_id', ids),
        ])
        if (error) throw error
        const righe = (cs ?? []) as CassaChiusura[]
        const idc = righe.filter(c => c.stato === 'confermata').map(c => c.id)
        const { data: md } = idc.length ? await sb.from('cassa_chiusure_modifiche').select('id, chiusura_id, payload, created_at, richiesto_da').in('chiusura_id', idc).eq('stato', 'in_attesa') : { data: [] }
        const pid = [...new Set(righe.flatMap(c => [c.updated_by, c.created_by]).filter(Boolean))] as string[]
        const { data: pr } = pid.length ? await sb.from('profiles').select('id, full_name').in('id', pid) : { data: [] }
        if (req.current !== mio) return
        setChiusure(righe)
        setPrimo(Object.fromEntries(prim))
        setUltima(Object.fromEntries(ult))
        setModifiche(((md ?? []) as Omit<Mod, 'chi' | 'letta' | 'ch'>[]).map(x => ({ ...x, chi: '', letta: leggiModifica(x.payload), ch: null })))
        setNomi(Object.fromEntries(((pr ?? []) as { id: string; full_name: string }[]).map(p => [p.id, p.full_name])))
        const cm: Record<string, string[]> = {}
        for (const p of (cas ?? []) as { full_name: string; restaurant_id: string }[]) (cm[p.restaurant_id] ??= []).push(p.full_name)
        setCassieri(cm)
      } else if (sec === 'approvazioni') {
        const { data: md, error } = await sb.from('cassa_chiusure_modifiche')
          .select('id, chiusura_id, payload, created_at, richiesto_da, chiusura:cassa_chiusure(*), richiedente:profiles!richiesto_da(full_name)')
          .eq('stato', 'in_attesa').order('created_at')
        if (error) throw error
        if (req.current !== mio) return
        const uno = <T,>(x: T | T[] | null): T | null => (Array.isArray(x) ? x[0] ?? null : x)
        setModifiche(((md ?? []) as unknown as (Omit<Mod, 'chi' | 'letta' | 'ch'> & { chiusura: CassaChiusura | CassaChiusura[] | null; richiedente: { full_name: string } | { full_name: string }[] | null })[])
          .map(x => ({ id: x.id, chiusura_id: x.chiusura_id, payload: x.payload, created_at: x.created_at, richiesto_da: x.richiesto_da, chi: uno(x.richiedente)?.full_name ?? '—', letta: leggiModifica(x.payload), ch: uno(x.chiusura) })))
      } else {
        // Buste: numerate su tutti i locali (il filtro non cambia il numero).
        const tutti = restaurants.map(r => r.id)
        const da = piuGiorni(oggi, -31)
        let senza = false
        let r1 = await sb.from('cassa_chiusure').select('*, busta_numero, busta_versata_at').in('restaurant_id', tutti).eq('stato', 'confermata').gte('data', da).order('data', { ascending: false })
        // Senza la colonna il numero è una posizione: va contata su TUTTI i
        // locali del manager (anche quelli non in elenco, nascosti o attivi
        // che siano), altrimenti i numeri cambierebbero a seconda di cosa è
        // visibile. Il nome del locale (per l'ordine a parità di data)
        // arriva dalla join, perché qui `info` conosce solo i visibili.
        if (r1.error && colonnaMancante(r1.error)) { senza = true; r1 = await sb.from('cassa_chiusure').select('*, locale:restaurants(name)').eq('stato', 'confermata').gte('data', da).order('data', { ascending: false }) }
        if (r1.error) throw r1.error
        const righe = (r1.data ?? []) as (CassaChiusura & { busta_numero?: number | null; busta_versata_at?: string | null; locale?: { name: string } | null })[]
        let base = 0
        if (senza) {
          // Senza la colonna il numero è la posizione della chiusura
          // confermata in ordine di data (provvisorio, vedi migrazione).
          const { count } = await sb.from('cassa_chiusure').select('id', { count: 'exact', head: true }).eq('stato', 'confermata').lt('data', da)
          base = count ?? 0
        }
        const nomeLoc = (c: (typeof righe)[number]) => c.locale?.name ?? info[c.restaurant_id]?.nome ?? ''
        const asc = [...righe].sort((p, q) => p.data.localeCompare(q.data) || nomeLoc(p).localeCompare(nomeLoc(q)))
        const num = new Map(asc.map((c, i) => [c.id, c.busta_numero ?? base + i + 1]))
        if (req.current !== mio) return
        setBusteSenzaColonne(senza)
        // Numerate tutte, mostrate solo quelle dei locali in elenco.
        setBuste(righe.filter(c => tutti.includes(c.restaurant_id)).map(c => ({ ch: c, n: num.get(c.id)!, vers: !!c.busta_versata_at })).sort((p, q) => q.n - p.n))
      }
      setErrore(false)
    } catch {
      if (req.current === mio) setErrore(true)
    }
    if (req.current === mio) pronto()
  }, [sec, mese, chiave, oggi, restaurants, info, pronto])

  useEffect(() => { carica() }, [carica])
  useEffect(() => {
    const sb = createClient()
    const ch = sb.channel(`cassa_manager_${sec}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cassa_chiusure' }, () => carica())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cassa_chiusure_modifiche' }, () => carica())
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [sec, carica])

  const cambiaLoc = (x: string[]) => { avvia(); setSel(null); setSpO(false); setLoc(x) }
  const cambiaMese = (m: string) => { avvia(); setSel(null); setSpO(false); setMese(m) }
  const seleziona = (k: string) => { setSpO(false); setDEsce(false); setSel(k) }
  const chiudiDett = () => { setDEsce(true); setTimeout(() => { setSel(null); setDEsce(false) }, USCITA) }

  // ── Righe e dettaglio per sezione ───────────────────────────────────
  const locNome = (id: string) => info[id]?.nome ?? '—'
  let righe: RigaLista[] = []
  let kpis: { l: string; v: string; c?: string }[] = []
  let dett: Dettaglio | null = null
  let heads: [string, 'left' | 'right'][] = []
  let cols = ''
  let vuoto: { t: string; s: string } | null = null
  // Riga effettivamente aperta nel dettaglio. Sul tablet il pannello a
  // destra non resta vuoto: senza una scelta esplicita (o se la riga scelta
  // non è più in elenco) vale la prima riga utile. È uno stato derivato, non
  // un setState in un effect; sul telefono niente automatismo, aprirebbe il
  // foglio dal basso da solo.
  let selEff: string | null = null
  // Chiusura della riga aperta: serve a caricarne le spese (vedi sotto).
  let chiusuraSel: CassaChiusura | null = null

  const sezioniChiusura = (c: CassaChiusura, m?: ModificaLetta | null): Dettaglio['secs'] => {
    const sp = spese[c.id] ?? []
    const campi = m?.campi ?? {}
    const gone = m?.spese.elimina ?? []
    const modS = Object.fromEntries((m?.spese.modifica ?? []).map(x => [x.id, x.importo]))
    const add = m?.spese.aggiungi ?? []
    const v = (k: keyof CassaChiusura) => Number((campi as Record<string, number>)[k as string] ?? c[k])
    const speseNuove = r2(sp.filter(s => !gone.includes(s.id)).reduce((t, s) => t + (modS[s.id] ?? Number(s.importo)), 0) + add.reduce((t, s) => t + s.importo, 0))
    const spTot = m ? speseNuove : Number(c.totale_spese_giornaliere)
    const nx = {
      con: v('entrate_contanti'), pos: v('entrate_pos'), bon: v('entrate_bonifico'), asp: v('incasso_asporto'), cop: v('coperti'),
      fi: v('fondo_cassa_iniziale'), ff: v('fondo_cassa_finale'), ban: v('contanti_per_banca'), sp: spTot,
    }
    const ent = r2(nx.con + nx.pos + nx.bon), teo = r2(nx.fi + nx.con - nx.sp - nx.ff), dif = r2(nx.ban - teo)
    const o = { con: Number(c.entrate_contanti), pos: Number(c.entrate_pos), bon: Number(c.entrate_bonifico), asp: Number(c.incasso_asporto), cop: Number(c.coperti), fi: Number(c.fondo_cassa_iniziale), ff: Number(c.fondo_cassa_finale), ban: Number(c.contanti_per_banca), sp: Number(c.totale_spese_giornaliere), ent: Number(c.totale_entrate), teo: Number(c.banca_teorica), dif: Number(c.differenza) }
    const riga = (l: string, nuovo: number, vecchio: number, opt: { w?: 600; n?: boolean; sgn?: boolean } = {}): RigaDett => {
      const fm = (x: number) => (opt.n ? String(x) : opt.sgn ? sg(x) : eur(x))
      const cambiata = !!m && Math.abs(nuovo - vecchio) > 0.004
      return { l, v: fm(nuovo), o: cambiata ? fm(vecchio) : undefined, w: opt.w, cambiata, c: opt.sgn ? (Math.abs(nuovo) < 0.005 ? 'text-ok' : 'text-neg') : undefined }
    }
    const voci = [
      ...sp.map(s => ({
        l: s.nome_spesa,
        m: gone.includes(s.id) ? 'eliminata nella modifica' : modS[s.id] !== undefined ? `era ${eur(Number(s.importo))}` : (s as CassaSpesa & { categoria?: { nome: string } | null }).categoria?.nome ?? 'Senza categoria',
        v: eur(gone.includes(s.id) ? 0 : modS[s.id] ?? Number(s.importo)),
      })),
      ...add.map(s => ({ l: s.nome_spesa, m: 'nuova nella modifica', v: eur(s.importo) })),
    ]
    const rSp = riga('Spese', nx.sp, o.sp)
    if (voci.length) rSp.espandi = voci
    return [
      { h: 'Entrate', righe: [riga('Contanti', nx.con, o.con), riga('POS', nx.pos, o.pos), riga('Bonifico', nx.bon, o.bon), riga('Totale entrate', ent, o.ent, { w: 600 }), riga('di cui asporto', nx.asp, o.asp), riga('Coperti', nx.cop, o.cop, { n: true })] },
      { h: 'Cassa', righe: [riga('Fondo cassa iniziale', nx.fi, o.fi), rSp, riga('Fondo cassa finale', nx.ff, o.ff), riga('Banca teorica', teo, o.teo, { w: 600 }), riga('Contanti per banca', nx.ban, o.ban), riga('Differenza', dif, o.dif, { w: 600, sgn: true })] },
    ]
  }

  if (sec === 'chiusure') {
    cols = 'minmax(0,1.3fr) 110px 110px 128px'
    heads = [['Giorno', 'left'], ['Entrate', 'right'], ['Busta', 'right'], ['Stato', 'right']]
    const [y, m] = mese.split('-').map(Number)
    const fineMese = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const ultimo = fineMese < ieri ? fineMese : ieri
    const conRev = new Set(modifiche.map(x => x.chiusura_id))
    type Voce = { li: string; d: string; c: CassaChiusura | null }
    const tutte: Voce[] = []
    const ordine = locali.filter(l => target.includes(l.id))
    const daA = chiusure.some(c => c.data === oggi) ? oggi : ultimo
    for (let d = daA; d >= `${mese}-01`; d = piuGiorni(d, -1)) {
      for (const l of ordine) {
        const c = chiusure.find(x => x.restaurant_id === l.id && x.data === d) ?? null
        if (!c) {
          // Giorno atteso: non di chiusura settimanale e dopo la prima chiusura del locale.
          const r = restaurants.find(x => x.id === l.id)
          if (d === oggi || (r?.closing_days ?? []).includes(giornoSettimana(d)) || !primo[l.id] || d < primo[l.id]!) continue
          // Locale in archivio: dopo l'ultima chiusura inviata è chiuso, non in ritardo.
          if (r?.nascosto && (!ultima[l.id] || d > ultima[l.id]!)) continue
        }
        tutte.push({ li: l.id, d, c })
      }
    }
    righe = tutte.map(({ li, d, c }) => {
      const inviata = c?.stato === 'confermata'
      const [t, tono]: [string, Tono] = !c ? ['Chiusura mancante', 'neg'] : !inviata ? ['In bozza', 'neg'] : conRev.has(c.id) ? ['In revisione', 'warn'] : ['Inviata', 'ok']
      return { k: `${li}|${d}`, li, giorno: d, a: dataBreve(d), as: locNome(li), b: inviata ? eur0(Number(c!.totale_entrate)) : '—', cl: inviata ? 'Busta' : '', c: inviata ? eur(Number(c!.contanti_per_banca)) : '—', banV: inviata ? Number(c!.contanti_per_banca) : 0, t, tono }
    })
    const inv = chiusure.filter(c => c.stato === 'confermata' && target.includes(c.restaurant_id))
    const ent = inv.reduce((s, c) => s + Number(c.totale_entrate), 0), mar = inv.reduce((s, c) => s + Number(c.totale_entrate) - Number(c.totale_spese_giornaliere), 0)
    kpis = [{ l: 'Entrate', v: eur0(ent) }, { l: 'Margine', v: (mar < 0 ? '−' : '') + eur0(mar), c: mar < 0 ? 'text-neg' : undefined }, { l: 'Coperti', v: inv.reduce((s, c) => s + Number(c.coperti), 0).toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions) }]
    vuoto = righe.length ? null : { t: 'Nessuna chiusura nel mese', s: 'Le chiusure inviate dai cassieri compaiono qui, dalla più recente.' }

    // In automatico la prima riga con una chiusura davvero inviata (un
    // giorno mancante in cima non ha nulla da mostrare), altrimenti la prima.
    const cur = tutte.find(x => `${x.li}|${x.d}` === sel)
      ?? (tel ? undefined : tutte.find(x => x.c?.stato === 'confermata') ?? tutte[0])
    if (cur) {
      selEff = `${cur.li}|${cur.d}`
      chiusuraSel = cur.c
      const titolo = `${locNome(cur.li)} · ${dataLunga(cur.d)}`
      const c = cur.c
      if (!c || c.stato !== 'confermata') {
        // A un locale in archivio non si mandano solleciti (è chiuso): la
        // chiusura che manca nello storico si inserisce a mano.
        const inArchivio = !!restaurants.find(x => x.id === cur.li)?.nascosto
        const cs = inArchivio ? [] : cassieri[cur.li] ?? []
        const chi = cs.length ? cs.join(', ') : null
        dett = {
          titolo, sotto: c ? 'bozza non ancora inviata' : 'nessuna chiusura inviata', t: c ? 'In bozza' : 'Mancante', tono: 'neg',
          msg: { tono: 'neg', testo: chi ? `${c ? 'La chiusura è in bozza: il' : 'Il'} cassiere di turno (${chi}) non l'ha ancora inviata. Puoi sollecitarlo con una notifica.` : inArchivio ? 'Il locale è in archivio: la chiusura va inserita da Chiusura cassa.' : 'Al locale non è associato nessun cassiere: la chiusura va inserita da Chiusura cassa.' },
          secs: [], azioni: chi ? [{ l: 'Invia sollecito', stile: 'ink', fai: async () => {
            const r = await sollecitaChiusura(cur.li, cur.d)
            toast(r.ok ? { title: `Sollecito inviato a ${chi}` } : { title: r.errore, variant: 'destructive' })
          } }] : [{ l: 'Inserisci la chiusura', stile: 'ink', fai: () => router.push(`/cassa/chiusura?restaurant_id=${cur.li}&data=${cur.d}`) }],
        }
      } else {
        const md = modifiche.find(x => x.chiusura_id === c.id)
        const chi = nomi[c.updated_by ?? c.created_by ?? ''] ?? null
        const media = Number(c.coperti) ? (Number(c.totale_entrate) - Number(c.incasso_asporto)) / Number(c.coperti) : 0
        dett = {
          titolo, sotto: `inviata${chi ? ` da ${chi}` : ''} alle ${formatInTimeZone(new Date(c.updated_at), TZ, 'HH:mm')}`, t: md ? 'In revisione' : 'Inviata', tono: md ? 'warn' : 'ok',
          msg: md ? { tono: 'warn', testo: "C'è una modifica in attesa della tua revisione." } : undefined,
          stats: [{ l: 'Totale entrate', v: eur(Number(c.totale_entrate)) }, { l: 'Coperti', v: String(c.coperti) }, { l: 'Media scontrino', v: eur(media) }, { l: 'Contanti per banca', v: eur(Number(c.contanti_per_banca)) }],
          secs: sezioniChiusura(c),
          // Oltre al design: correggere, scaricare il PDF ed eliminare (funzioni già in uso).
          azioni: md
            ? [{ l: 'Rivedi la modifica', stile: 'ink', fai: () => router.push(`/cassa/approvazioni?sel=${md.id}`) }]
            : [
              { l: 'Elimina', stile: 'neg', fai: async () => {
                if (!(await chiediConferma({ titolo: 'Eliminare la chiusura?', testo: `${titolo}: verranno eliminate anche le spese collegate.`, conferma: 'Elimina' }))) return
                const { error } = await createClient().from('cassa_chiusure').delete().eq('id', c.id)
                if (error) { toast({ title: friendlySaveError(error), variant: 'destructive' }); return }
                toast({ title: 'Chiusura eliminata' }); setSel(null); carica()
              } },
              { l: 'PDF', stile: 'line', fai: () => setPdf(c) },
              { l: 'Modifica', stile: 'ink', fai: () => router.push(`/cassa/chiusura?restaurant_id=${c.restaurant_id}&data=${c.data}`) },
            ],
          colsAzioni: md ? '1fr' : '1fr 1fr 1.6fr',
        }
      }
    }
  } else if (sec === 'approvazioni') {
    cols = 'minmax(0,1.3fr) 160px 1px 128px'
    heads = [['Chiusura', 'left'], ['Modifica', 'right'], ['', 'right'], ['Stato', 'right']]
    const vis = modifiche.filter(m => m.ch && target.includes(m.ch.restaurant_id))
    const quando = (iso: string) => {
      const d = formatInTimeZone(new Date(iso), TZ, 'yyyy-MM-dd'), h = formatInTimeZone(new Date(iso), TZ, 'HH:mm')
      return d === oggi ? `oggi ${h}` : d === ieri ? `ieri ${h}` : `${dataBreve(d).slice(4)} ${h}`
    }
    const prima = (m: Mod) => {
      const l = m.letta
      if (!l || !m.ch) return '—'
      const voci: string[] = Object.entries(l.campi).map(([k, v]) => `${ETICHETTE[k] ?? k} ${k === 'coperti' ? `${v! - Number(m.ch![k as keyof CassaChiusura]) > 0 ? '+' : ''}${v! - Number(m.ch![k as keyof CassaChiusura])}` : sg(v! - Number(m.ch![k as keyof CassaChiusura]))}`)
      const ns = l.spese.modifica.length + l.spese.elimina.length + l.spese.aggiungi.length
      if (ns) voci.push(`Spese · ${ns} ${ns === 1 ? 'voce' : 'voci'}`)
      return voci.length > 1 ? `${voci[0]} · +${voci.length - 1}` : voci[0] ?? '—'
    }
    righe = vis.map(m => ({ k: m.id, li: m.ch!.restaurant_id, giorno: m.ch!.data, a: `${dataBreve(m.ch!.data)} · ${locNome(m.ch!.restaurant_id)}`, as: `${m.chi} · ${quando(m.created_at)}`, b: prima(m), cl: '', c: '', banV: 0, t: 'Da rivedere', tono: 'warn', esce: uscite.includes(m.id) }))
    kpis = [{ l: 'Da rivedere', v: String(vis.length), c: vis.length ? 'text-warn' : undefined }]
    vuoto = righe.length ? null : { t: 'Nessuna modifica da rivedere', s: 'Quando un cassiere modifica una chiusura già inviata, la trovi qui.' }
    const m = vis.find(x => x.id === sel) ?? (tel ? undefined : vis[0])
    if (m && m.ch) {
      selEff = m.id
      chiusuraSel = m.ch
      const decidi = async (ok: boolean) => {
        const res = await fetch('/api/cassa/modifica-approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modificaId: m.id, action: ok ? 'approve' : 'reject' }) })
        const r = await res.json().catch(() => null)
        if (!res.ok) { toast({ title: r?.error ?? 'Operazione non riuscita, riprova', variant: 'destructive' }); return }
        setUscite(u => [...u, m.id])
        setTimeout(() => { setModifiche(p => p.filter(x => x.id !== m.id)); setSel(null); setUscite(u => u.filter(x => x !== m.id)) }, USCITA)
        toast({ title: ok ? 'Modifica approvata, la chiusura è aggiornata' : 'Modifica rifiutata, resta la chiusura originale' })
      }
      dett = {
        titolo: `${locNome(m.ch.restaurant_id)} · ${dataLunga(m.ch.data)}`, sotto: `modifica di ${m.chi} · ${quando(m.created_at)}`, t: 'Da rivedere', tono: 'warn',
        msg: m.letta?.motivo ? { tono: 'neu', testo: `“${m.letta.motivo}”` } : undefined,
        secs: sezioniChiusura(m.ch, m.letta),
        azioni: [{ l: 'Rifiuta', stile: 'line', fai: () => decidi(false) }, { l: 'Approva modifica', stile: 'ink', fai: () => decidi(true) }],
        colsAzioni: '1fr 1.6fr',
      }
    }
  } else {
    cols = 'minmax(0,1.3fr) 110px 1px 128px'
    heads = [['Busta', 'left'], ['Importo', 'right'], ['', 'right'], ['Stato', 'right']]
    // Una busta da 0 € non esiste fisicamente: non si mostra.
    const vis = buste.filter(b => target.includes(b.ch.restaurant_id) && Number(b.ch.contanti_per_banca) > 0.004)
    righe = vis.map(b => ({ k: b.ch.id, li: b.ch.restaurant_id, giorno: b.ch.data, a: `N° ${b.n}`, as: `${locNome(b.ch.restaurant_id)} · ${dataBreve(b.ch.data)}`, b: eur(Number(b.ch.contanti_per_banca)), cl: '', c: '', banV: 0, t: b.vers ? 'Versata' : 'In cassaforte', tono: b.vers ? 'ok' : 'warn' }))
    const inC = vis.filter(b => !b.vers)
    kpis = [{ l: 'In cassaforte', v: eur(inC.reduce((s, b) => s + Number(b.ch.contanti_per_banca), 0)), c: 'text-warn' }, { l: 'Buste', v: String(inC.length) }]
    vuoto = righe.length ? null : { t: 'Nessuna busta nell’ultimo mese', s: 'Ogni chiusura inviata genera una busta con i contanti per la banca.' }
    const x = vis.find(b => b.ch.id === sel) ?? (tel ? undefined : vis[0])
    if (x) {
      const c = x.ch
      selEff = c.id
      chiusuraSel = c
      dett = {
        titolo: `Busta N° ${x.n}`, sotto: `${locNome(c.restaurant_id)} · chiusura di ${dataLunga(c.data)}`, t: x.vers ? 'Versata' : 'In cassaforte', tono: x.vers ? 'ok' : 'warn',
        stats: [{ l: 'Contanti per banca', v: eur(Number(c.contanti_per_banca)) }, { l: 'Banca teorica', v: eur(Number(c.banca_teorica)) }],
        secs: [{ h: 'Composizione', righe: [
          { l: 'Fondo cassa iniziale', v: eur(Number(c.fondo_cassa_iniziale)) }, { l: '+ Contanti', v: eur(Number(c.entrate_contanti)) },
          { l: '− Spese', v: eur(Number(c.totale_spese_giornaliere)) }, { l: '− Fondo cassa finale', v: eur(Number(c.fondo_cassa_finale)) },
          { l: 'Differenza', v: sg(Number(c.differenza)), w: 600, c: Math.abs(Number(c.differenza)) < 0.005 ? 'text-ok' : 'text-neg' },
        ] }],
        azioni: x.vers ? [] : [{ l: 'Segna come versata in banca', stile: 'ink', fai: async () => {
          if (busteSenzaColonne) { toast({ title: 'Per segnare le buste serve l’aggiornamento del database', variant: 'destructive' }); return }
          const { data: { user } } = await createClient().auth.getUser()
          const { error } = await createClient().from('cassa_chiusure').update({ busta_versata_at: new Date().toISOString(), busta_versata_da: user?.id ?? null } as never).eq('id', c.id)
          if (error) { toast({ title: colonnaMancante(error) ? 'Per segnare le buste serve l’aggiornamento del database' : friendlySaveError(error), variant: 'destructive' }); return }
          setBuste(p => p.map(b => (b.ch.id === c.id ? { ...b, vers: true } : b)))
          toast({ title: `Busta N° ${x.n} segnata come versata` })
        } }],
      }
    }
  }

  // Spese della chiusura aperta (voce "Spese" espandibile): si caricano
  // alla prima apertura, anche quando la riga è stata scelta in automatico.
  const idSpese = chiusuraSel?.id ?? null
  useEffect(() => {
    if (!idSpese || spese[idSpese]) return
    createClient().from('cassa_spese').select('*, categoria:cassa_categorie(nome)').eq('chiusura_id', idSpese).order('created_at').then(({ data }) => setSpese(s => ({ ...s, [idSpese]: (data ?? []) as CassaSpesa[] })))
  }, [idSpese, spese])

  // Raggruppamento per giorno con più locali (Chiusure): intestazione
  // fissa con il totale delle buste del giorno.
  type Voce = { h: true; l: string; b: string } | (RigaLista & { h: false; grp: boolean })
  const lista: Voce[] = []
  if (sec === 'chiusure' && target.length > 1) {
    let ultimo = ''
    for (const r of righe) {
      if (r.giorno !== ultimo) { ultimo = r.giorno; lista.push({ h: true, l: r.a, b: eur(righe.filter(x => x.giorno === r.giorno).reduce((s, x) => s + x.banV, 0)) }) }
      lista.push({ ...r, h: false, grp: true })
    }
  } else righe.forEach(r => lista.push({ ...r, h: false, grp: false }))

  const aperto = !!dett
  const rCols = tel ? 'minmax(0,1fr) auto' : cols

  // Numeri di riepilogo. Sul tablet stanno nella riga di testa; sul telefono
  // sono un blocco a sé, figlio diretto della colonna della pagina (gap 12),
  // così data-ritira li chiude quando si scorre l'elenco e ne riassorbe lo
  // spazio (dentro la riga a capo il margine negativo non lo recupererebbe).
  const numeri = (
    <div data-ritira="" className={cn('flex min-w-0 rounded-[12px]', tel ? 'flex-none border border-border bg-card py-2.5' : '')}>
      {kpis.map((k, i) => (
        <div key={k.l} className={cn('flex min-w-0 flex-col', tel ? 'flex-1 items-start px-3' : 'items-end px-2.5', tel && i > 0 && 'border-l border-border')}>
          <span className="text-xs font-medium text-muted-foreground">{k.l}</span>
          <span className={cn('font-mono text-[17px] font-semibold', tel && 'self-center', k.c)}>{k.v}</span>
        </div>
      ))}
    </div>
  )

  return (
    <Contenitore>
      <div data-sk-root="" data-sk-on={sk === 'on' ? '1' : undefined} className={cn('relative flex min-h-0 flex-1 flex-col gap-3', tel ? 'px-4' : 'px-8')}>
        <div className="relative z-[2] flex flex-none flex-wrap items-center gap-2.5">
          <div data-sk-keep="" className={tel ? 'min-w-0 flex-[1_1_100%]' : 'min-w-0 flex-[0_1_auto]'}>
            <PilloleLocali multipla tuttiComeVuoto locali={locali} selezionati={loc} onCambia={cambiaLoc} className={tel ? '' : 'mx-0 px-0'} />
          </div>
          {sec === 'chiusure' && <NavMese mese={mese} min="2020-01" max={oggi.slice(0, 7)} onCambia={cambiaMese} className={tel ? 'flex-[1_1_100%]' : ''} />}
          {!tel && <span className="flex-1" />}
          {!tel && numeri}
        </div>
        {tel && numeri}

        <div className={cn('grid min-h-0 flex-1 gap-4', tel ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]')}>
          <div className="anim-swapin flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-border bg-card">
            {!tel && (
              <div className="grid flex-none gap-2.5 border-b border-border bg-[oklch(0.97_0.01_250)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground dark:bg-secondary" style={{ gridTemplateColumns: cols }}>
                {heads.map(([l, a], i) => <span key={i} style={{ textAlign: a }}>{l}</span>)}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {errore ? (
                <div className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center">
                  <span className="text-[15px] font-semibold text-neg">Caricamento non riuscito</span>
                  <span className="text-[13px] text-muted-foreground">Controlla la connessione e riprova.</span>
                  <button type="button" onClick={() => { avvia(); carica() }} className="mt-3 flex h-11 items-center rounded-[12px] border border-line-strong bg-card px-[18px] text-sm font-semibold active:scale-[0.97]">Riprova</button>
                </div>
              ) : vuoto && sk === 'no' ? (
                <div key={vuoto.t} className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center text-pretty">
                  <span className="text-[15px] font-semibold">{vuoto.t}</span>
                  <span className="text-[13px] text-muted-foreground">{vuoto.s}</span>
                </div>
              ) : lista.map((r, i) => r.h ? (
                <div key={`h${r.l}`} className="sticky top-0 z-[1] flex h-[34px] items-center justify-between gap-2.5 border-b border-[oklch(0.92_0.01_250)] bg-[oklch(0.97_0.01_250)] px-4 text-xs font-semibold text-[oklch(0.35_0.01_250)] dark:border-border dark:bg-secondary dark:text-foreground/80">
                  <span>{r.l}</span>
                  <span className="flex items-baseline gap-2 font-mono text-xs font-medium"><span>Buste</span><span className="min-w-[84px] text-right">{r.b}</span></span>
                </div>
              ) : (() => {
                const act = selEff === r.k
                const titolo = r.grp ? r.as : r.a
                const sotto = r.grp ? '' : r.as
                const nascondiT = tel && r.t === 'Inviata'
                return (
                  <button key={r.k} type="button" onClick={() => seleziona(r.k)}
                    className={cn('grid min-h-14 w-full items-center border-b border-[oklch(0.94_0.01_250)] text-left transition-[background-color] duration-200 active:scale-[0.995] dark:border-border',
                      tel ? 'gap-x-3 gap-y-0.5 py-2.5 pl-4 pr-3.5' : 'gap-2.5 px-4', act ? 'bg-primary text-primary-foreground' : 'bg-transparent', r.esce && 'anim-swapout')}
                    style={{ gridTemplateColumns: rCols, boxShadow: `inset 3px 0 0 ${info[r.li]?.colore ?? 'transparent'}`, animationDelay: r.esce ? undefined : `${Math.min(i, 12) * 0}ms` }}>
                    <span className="flex min-w-0 flex-col gap-px self-center" style={{ gridArea: tel ? (nascondiT ? '1 / 1 / 3 / 2' : '1 / 1 / 2 / 2') : 'auto' }}>
                      <span className="truncate text-sm font-medium">{titolo}</span>
                      {sotto && <span className={cn('flex items-center gap-1.5 text-xs', act ? 'text-[oklch(0.85_0.01_250)]' : 'text-muted-foreground')}>
                        <span className="h-[7px] w-[7px] flex-none rounded-[2px]" style={{ background: info[r.li]?.colore }} /><span className="truncate">{sotto}</span>
                      </span>}
                    </span>
                    <span className="text-right font-mono text-sm font-medium" style={{ gridArea: tel ? '1 / 2 / 2 / 3' : 'auto' }}>{r.b}</span>
                    <span className={cn('flex items-baseline justify-end gap-2 font-mono font-medium', tel ? 'text-[12.5px]' : 'text-sm', act ? 'text-primary-foreground' : 'text-muted-foreground')} style={{ gridArea: tel ? '2 / 2 / 3 / 3' : 'auto' }}>
                      {/* Sul tablet "Busta" è già l'intestazione della colonna: ripeterla in
                          ogni riga spingeva l'importo fuori dalla colonna, sopra il testo. */}
                      {r.cl && tel && <span>{r.cl}</span>}{(r.c || !tel) && <span className={cn(r.c && tel ? 'min-w-[84px] text-right' : 'text-right')}>{r.c}</span>}
                    </span>
                    {!nascondiT && (
                      <span className={cn('whitespace-nowrap rounded-full px-[9px] py-[3px] text-[10px] font-semibold uppercase tracking-[.05em]', TONO[r.tono], tel ? 'justify-self-start' : 'justify-self-end')} style={{ gridArea: tel ? '2 / 1 / 3 / 2' : 'auto' }}>{r.t}</span>
                    )}
                  </button>
                )
              })())}
            </div>
          </div>

          {/* Sul telefono il dettaglio è un foglio dal basso: va nel body,
              sopra la dock, che altrimenti ne coprirebbe i pulsanti in fondo
              (il contenuto della pagina sta sotto la dock). */}
          {sopraDock(<>
          {tel && aperto && <div onClick={chiudiDett} className="fixed inset-0 z-[69] transition-[background] duration-300" style={{ background: dEsce ? 'rgba(15,20,30,0)' : 'rgba(15,20,30,.22)' }} />}
          {(!tel || aperto) && (
            <div key={`${sec}|${selEff}`} className={cn('z-[70] flex min-h-0 flex-col overflow-hidden border border-border bg-card', dEsce ? 'anim-swapout' : 'anim-swapin',
              tel ? 'fixed inset-x-0 bottom-0 top-[12dvh] rounded-t-[20px] shadow-[0_20px_60px_rgba(20,30,50,.18)]' : 'relative rounded-[12px]')}>
              {!dett ? (
                <div className="flex flex-1 items-center justify-center text-sm font-medium text-muted-foreground">Seleziona una riga per vedere il dettaglio.</div>
              ) : (<>
                <div className="flex flex-none items-center gap-3 border-b border-border px-[18px] py-3.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="text-lg font-semibold">{dett.titolo}</span><span className="text-[13px] text-muted-foreground">{dett.sotto}</span></div>
                  <Pillola tono={dett.tono} className="px-[9px]">{dett.t}</Pillola>
                  {tel && <button type="button" onClick={chiudiDett} aria-label="Chiudi" className="-my-2 -ml-1 -mr-2.5 flex h-11 w-11 flex-none items-center justify-center rounded-full text-muted-foreground active:scale-[0.96]"><IconaX /></button>}
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-[18px] py-3.5">
                  {dett.msg && <div className={cn('rounded-[10px] px-3.5 py-3 text-sm font-medium leading-[1.45]', dett.msg.tono === 'neu' ? 'bg-[oklch(0.965_0.01_250)] text-[oklch(0.3_0.01_250)] dark:bg-secondary dark:text-foreground' : TONO[dett.msg.tono])}>{dett.msg.testo}</div>}
                  {dett.stats && (
                    <div className="grid grid-cols-2 gap-2">
                      {dett.stats.map(s => <div key={s.l} className="flex flex-col gap-[3px] rounded-[10px] bg-background px-3.5 py-3"><span className="text-xs font-medium text-muted-foreground">{s.l}</span><span className="font-mono text-lg font-semibold">{s.v}</span></div>)}
                    </div>
                  )}
                  {dett.secs.map(sc => (
                    <div key={sc.h} className="flex flex-col">
                      <span className="pb-1.5 text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">{sc.h}</span>
                      {sc.righe.map(x => (
                        <div key={x.l} className="flex flex-col border-t border-[oklch(0.94_0.01_250)] dark:border-border">
                          <button type="button" disabled={!x.espandi} onClick={() => setSpO(o => !o)}
                            className={cn('-mx-2 grid min-h-10 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-[6px] px-2 text-left disabled:cursor-default', x.espandi && 'active:scale-[0.99]', x.cambiata && 'bg-[oklch(0.96_0.035_75)] dark:bg-warn-tint')}>
                            <span className={cn('text-sm text-[oklch(0.3_0.01_250)] dark:text-foreground/85', x.w === 600 && 'font-semibold')}>{x.l}</span>
                            <span className="font-mono text-[13px] font-medium text-[oklch(0.55_0.01_250)] line-through">{x.o ?? ''}</span>
                            <span className="flex items-center">{x.espandi && <ChevronEspandi aperto={spO} />}</span>
                            <span className={cn('font-mono text-sm', x.w === 600 && 'font-semibold', x.c)}>{x.v}</span>
                          </button>
                          {x.espandi && spO && (
                            <div className="anim-swapin mb-2.5 flex flex-col rounded-[8px] bg-[oklch(0.97_0.01_250)] px-3 py-1 dark:bg-secondary">
                              {x.espandi.map((it, j) => (
                                <div key={j} className="flex items-baseline gap-2.5 py-[7px]">
                                  <div className="flex min-w-0 flex-1 flex-col gap-px"><span className="text-[13px] font-medium">{it.l}</span><span className="text-xs text-muted-foreground">{it.m}</span></div>
                                  <span className="font-mono text-[13px] font-medium">{it.v}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {dett.azioni.length > 0 && (
                  <div className="grid flex-none gap-2.5 border-t border-border px-[18px] pb-4 pt-3" style={{ gridTemplateColumns: dett.colsAzioni ?? '1fr' }}>
                    {dett.azioni.map(a => (
                      <button key={a.l} type="button" onClick={a.fai}
                        className={cn('flex h-[52px] items-center justify-center gap-2 rounded-[8px] border text-[15px] font-semibold transition-[background-color] duration-200 active:scale-[0.98]',
                          a.stile === 'ink' ? 'border-primary bg-primary text-primary-foreground' : a.stile === 'neg' ? 'border-transparent bg-neg-tint text-neg' : 'border-line-strong bg-transparent text-foreground')}>
                        {a.l}
                      </button>
                    ))}
                  </div>
                )}
              </>)}
            </div>
          )}
          </>)}
        </div>
        {sk !== 'no' && <ScheletroForma esce={sk === 'out'} />}
      </div>

      <CassaFileViewer
        open={!!pdf} onOpenChange={o => { if (!o) setPdf(null) }}
        request={pdf ? { url: '/api/cassa/chiusura-export', body: { chiusura_id: pdf.id } } : null}
        format={pdf ? 'pdf' : null}
        title={pdf ? `${locNome(pdf.restaurant_id)} · ${dataLunga(pdf.data)}` : ''}
        fileNameBase={pdf ? `chiusura-${locNome(pdf.restaurant_id).replace(/[^a-zA-Z0-9]+/g, '-')}-${pdf.data}` : 'chiusura'}
      />
    </Contenitore>
  )
}
