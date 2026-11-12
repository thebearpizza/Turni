'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { friendlySaveError } from '@/lib/supabase/friendlyError'
import { toast } from '@/hooks/use-toast'
import { useTelefono } from '@/hooks/useTelefono'
import { useScheletro } from '@/components/shared/useScheletro'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { CampoNumerico, type TastoTastierino } from '@/components/ui/tastierino'
import { cn } from '@/lib/utils'
import type { ArticoloTipologia, VerificaSospetta } from '@/types'
import { Vista, Pannello, BloccoCampi, Scelte, type RigaVista, type SezioneDettaglio, type AzioneDettaglio } from './Vista'
import {
  ALIQUOTE, Bottone, IcoPiu, IcoScan, Modale, TZ, MESI_LUNGHI, arrotonda2, dataBreve, dataLunga, digita, eu, etichettaMese, fineMese,
  localiDa, nf, numeroDa, spostaMese, useToccoFuori, useUscita,
} from './comuni'
import { FatturaCapture, type FatturaRisolta, type AvvioCattura } from './FatturaCapture'
import { FatturaFotoViewer } from './FatturaFotoViewer'
import { MenuNuovaFattura, ScansionaFattura } from './NuovaFattura'
import { ImportaXml } from './ImportaXml'
import { GrigliaLocali } from './Smistamento'
import { BUCKET_XML, importaXml, lordoXml, riepilogoXml, tabellaMancante, type InAttesa } from './xmlImport'

// Fatture (MTAcquisti, sezione "fatture"): elenco del mese con schede
// Tutte / Da verificare, dettaglio con righe rettificabili dal riquadro
// teal (quantità, prezzo, categoria, aliquota), conferma ed eliminazione;
// "Nuova fattura" apre scanner, caricamento di file o importazione XML.
// Il manager ha anche la scheda "Da assegnare": le fatture XML di cui lo
// smistamento non ha capito il locale, da assegnare e importare a mano.

interface Props {
  ruolo: 'manager' | 'direttore'
  restaurants: { id: string; name: string }[]
  categorieDirette: { id: string; nome: string }[]
  fornitori: { id: string; nome: string }[]
  meseIniziale?: string
  selIniziale?: string | null
  apriXml?: boolean
}

interface RigaArticolo {
  id: string
  testo_estratto: string
  quantita: number
  prezzo_unitario: number
  prezzo_riga: number
  aliquota_iva: number | null
  catalogo_articolo_id: string
  art: { nome_articolo: string; tipologia: ArticoloTipologia; unita_misura: string | null } | null
}
interface Fattura {
  id: string
  restaurant_id: string
  fornitore_id: string
  fornitore: string
  numero_documento: string
  data: string
  ha_articoli: boolean
  categoria_id: string | null
  categoria: string | null
  netto: number
  iva: number
  lordo: number
  vuoti: number | null
  foto_paths: string[]
  xml_path: string | null
  verifiche: VerificaSospetta[]
  rettificata: boolean
  righe: RigaArticolo[]
  ivaDett: { id: string; aliquota: number; imponibile: number; iva: number }[]
}

type Cat = 'food' | 'bev' | 'nofood'
const catDi = (t?: ArticoloTipologia | null): Cat => (t === 'food' ? 'food' : t === 'beverage' ? 'bev' : 'nofood')

const SEL_BASE = `id, restaurant_id, fornitore_id, numero_documento, data, ha_articoli, categoria_spesa_diretta_id, totale_netto, totale_iva, totale_lordo, vuoti_ritirati, foto_paths, verifiche_sospette,
  fornitore:fornitori(nome), categoria_diretta:categorie_fatture_dirette(nome),
  fatture_iva_dettaglio(id, aliquota, imponibile, iva)`
const SEL_RIGHE = (conAliquota: boolean) => `fatture_articoli(id, testo_estratto, quantita, prezzo_unitario, prezzo_riga, catalogo_articolo_id${conAliquota ? ', aliquota_iva' : ''}, art:catalogo_articoli(nome_articolo, tipologia, unita_misura))`

// Colonne aggiunte dalla migrazione proposta (aliquota per riga, data di
// rettifica): finché non c'è, la query ripiega su quella di sempre.
let conColonneNuove = true
// fatture.xml_path (migrazione xml-smistamento): stesso ripiego.
let conXml = true

async function caricaFatture(ids: string[], a: string, b: string): Promise<{ righe: Fattura[]; errore: string | null }> {
  const sb = createClient()
  const q = (nuove: boolean, xml: boolean) => sb.from('fatture')
    .select(`${SEL_BASE}${nuove ? ', rettificata_at' : ''}${xml ? ', xml_path' : ''}, ${SEL_RIGHE(nuove)}`)
    .in('restaurant_id', ids).gte('data', a).lte('data', b)
    .order('data', { ascending: false }).order('created_at', { ascending: false })
  let res = await q(conColonneNuove, conXml)
  if (res.error && conXml) { conXml = false; res = await q(conColonneNuove, false) }
  if (res.error && conColonneNuove) { conColonneNuove = false; res = await q(false, false) }
  if (res.error) return { righe: [], errore: friendlySaveError(res.error) }
  type R = Record<string, unknown> & {
    fornitore: { nome: string } | null; categoria_diretta: { nome: string } | null
    fatture_articoli: (Omit<RigaArticolo, 'aliquota_iva'> & { aliquota_iva?: number | null })[]
    fatture_iva_dettaglio: Fattura['ivaDett']
  }
  return {
    errore: null,
    righe: ((res.data ?? []) as unknown as R[]).map(r => ({
      id: r.id as string,
      restaurant_id: r.restaurant_id as string,
      fornitore_id: r.fornitore_id as string,
      fornitore: r.fornitore?.nome ?? '—',
      numero_documento: r.numero_documento as string,
      data: r.data as string,
      ha_articoli: r.ha_articoli as boolean,
      categoria_id: (r.categoria_spesa_diretta_id as string | null) ?? null,
      categoria: r.categoria_diretta?.nome ?? null,
      netto: Number(r.totale_netto), iva: Number(r.totale_iva), lordo: Number(r.totale_lordo),
      vuoti: (r.vuoti_ritirati as number | null) ?? null,
      foto_paths: (r.foto_paths as string[]) ?? [],
      xml_path: (r.xml_path as string | null | undefined) ?? null,
      verifiche: (r.verifiche_sospette as VerificaSospetta[]) ?? [],
      rettificata: !!r.rettificata_at,
      righe: (r.fatture_articoli ?? []).map(x => ({ ...x, quantita: Number(x.quantita), prezzo_unitario: Number(x.prezzo_unitario), prezzo_riga: Number(x.prezzo_riga), aliquota_iva: x.aliquota_iva ?? null }))
        .sort((p, q2) => p.testo_estratto.localeCompare(q2.testo_estratto, 'it')),
      ivaDett: (r.fatture_iva_dettaglio ?? []).map(x => ({ ...x, aliquota: Number(x.aliquota), imponibile: Number(x.imponibile), iva: Number(x.iva) })),
    })),
  }
}

/** Aliquota nota di una riga: la sua, o quella unica della fattura. */
const aliquotaRiga = (f: Fattura, r: RigaArticolo) => r.aliquota_iva ?? (f.ivaDett.length === 1 ? f.ivaDett[0].aliquota : null)

export function FattureClient({ ruolo, restaurants, categorieDirette, fornitori, meseIniziale, selIniziale, apriXml }: Props) {
  const tel = useTelefono()
  const single = ruolo === 'direttore' || restaurants.length <= 1
  const locali = useMemo(() => localiDa(restaurants), [restaurants])
  const meseOggi = formatInTimeZone(new Date(), TZ, 'yyyy-MM')
  const [mese, setMese] = useState(meseIniziale ?? meseOggi)
  const [loc, setLoc] = useState<string | null>(null)
  const [tab, setTab] = useState<'all' | 'dv' | 'da'>('all')
  const [righe, setRighe] = useState<Fattura[]>([])
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(selIniziale ?? null)
  const { stato: sk, avvia, pronto } = useScheletro()

  // Stato del dettaglio: riga in rettifica, bozza, tastierino, conferma eliminazione.
  const [er, setEr] = useState<number | null>(null)
  const [rd, setRd] = useState<{ q?: number; pr?: number; al?: number | null; cat?: Cat }>({})
  const [kp, setKp] = useState<{ campo: 'q' | 'pr'; v: string; esce: boolean } | null>(null)
  const [del, setDel] = useState(false)
  const [lavoro, setLavoro] = useState(false)
  const [rettificateOra, setRettificateOra] = useState<Set<string>>(new Set())
  const [corrette, setCorrette] = useState<Set<string>>(new Set())

  const ids = useMemo(() => (loc ? [loc] : restaurants.map(r => r.id)), [loc, restaurants])
  const chiave = ids.join(',')
  const req = useRef(0)
  const carica = useCallback(async () => {
    const mio = ++req.current
    const { righe: r, errore: e } = await caricaFatture(chiave ? chiave.split(',') : [], `${mese}-01`, fineMese(mese))
    if (mio !== req.current) return
    setRighe(r); setErrore(e); setCaricamento(false)
    pronto()
  }, [chiave, mese, pronto])

  useEffect(() => { carica() }, [carica])
  useEffect(() => {
    const sb = createClient()
    let t: ReturnType<typeof setTimeout> | null = null
    const ch = sb.channel('acquisti_fatture')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fatture' }, () => { if (t) clearTimeout(t); t = setTimeout(carica, 300) })
      .subscribe()
    return () => { if (t) clearTimeout(t); sb.removeChannel(ch) }
  }, [carica])

  // ── Coda "Da assegnare" (solo manager; null = tabella non ancora creata) ──
  const [coda, setCoda] = useState<InAttesa[] | null>(null)
  const [locCoda, setLocCoda] = useState<string | null>(null)
  const idLocali = restaurants.map(r => r.id).join(',')
  const caricaCoda = useCallback(async () => {
    if (ruolo !== 'manager') return
    const { data, error } = await createClient().from('fatture_xml_in_attesa')
      .select('id, restaurant_ids, fornitore, numero_documento, data, totale, motivo, file_nome, xml_path, dati').order('data', { ascending: false })
    if (error) { setCoda(c => (tabellaMancante(error) ? null : c)); return }
    // In coda restano visibili solo le fatture con almeno un candidato fra
    // i locali in elenco (o senza candidati): quelle rimaste in dubbio fra
    // soli locali nascosti si ritrovano aprendo quel locale in archivio.
    const visibili = new Set(idLocali ? idLocali.split(',') : [])
    setCoda(((data ?? []) as unknown as InAttesa[])
      .filter(x => !x.restaurant_ids?.length || x.restaurant_ids.some(id => visibili.has(id)))
      .map(x => ({ ...x, totale: x.totale == null ? null : Number(x.totale) })))
  }, [ruolo, idLocali])
  useEffect(() => { caricaCoda() }, [caricaCoda])

  const resetDettaglio = () => { setEr(null); setRd({}); setKp(null); setDel(false); setLocCoda(null) }
  const cambiaLoc = (x: string | null) => { avvia(); setLoc(x); setSel(null); resetDettaglio() }
  const cambiaMese = (n: number) => { const m = spostaMese(mese, n); if (m > meseOggi) return; avvia(); setMese(m); setSel(null); resetDettaglio() }

  const daVer = (f: Fattura) => f.verifiche.length > 0
  const nDv = righe.filter(daVer).length
  const lista = tab === 'dv' ? righe.filter(daVer) : tab === 'da' ? [] : righe
  const nomeLoc = (id: string) => locali.find(l => l.id === id)
  const MESE = MESI_LUNGHI[Number(mese.slice(5)) - 1]

  const vista: RigaVista[] = lista.map(f => ({
    id: f.id, a: f.fornitore, as: `${nomeLoc(f.restaurant_id)?.nome ?? ''} · n. ${f.numero_documento}`, lc: nomeLoc(f.restaurant_id)?.colore ?? 'transparent',
    b: eu(f.lordo), c: dataBreve(f.data), t: daVer(f) ? 'Da verificare' : 'Verificata', tTono: daVer(f) ? 'warn' : 'ok',
    ord: [f.fornitore.toLowerCase(), f.lordo, f.data, daVer(f) ? 0 : 1],
  }))
  if (tab === 'da') {
    vista.push(...(coda ?? []).map((x): RigaVista => ({
      id: x.id, a: x.fornitore, as: `n. ${x.numero_documento}${x.motivo ? ` · ${x.motivo}` : ''}`, lc: 'transparent',
      b: x.totale == null ? '—' : eu(x.totale), c: dataBreve(x.data), t: 'Da assegnare', tTono: 'warn',
      ord: [x.fornitore.toLowerCase(), x.totale ?? 0, x.data, 0],
    })))
  }

  // Tablet: all'apertura il dettaglio mostra la prima riga invece del
  // riquadro vuoto (stato derivato; sul telefono aprirebbe un foglio).
  const selEff = sel ?? (tel ? null : vista[0]?.id ?? null)

  // ── Tastierino del riquadro teal ──────────────────────────────────
  const f = righe.find(x => x.id === selEff) ?? null
  const xr = f && er !== null ? f.righe[er] ?? null : null
  const RD = xr && f ? { q: rd.q ?? xr.quantita, pr: rd.pr ?? xr.prezzo_unitario, al: rd.al !== undefined ? rd.al : aliquotaRiga(f, xr), cat: rd.cat ?? catDi(xr.art?.tipologia) } : null

  const chiudiKp = useCallback(() => {
    setKp(k => (k ? { ...k, esce: true } : k))
    setTimeout(() => setKp(k => (k?.esce ? null : k)), 320)
  }, [])
  useToccoFuori(!!kp && !kp.esce, '[data-kp]', chiudiKp)
  const conferma = (k: { campo: 'q' | 'pr'; v: string }) => {
    const v = numeroDa(k.v)
    if (v === null || v < 0) return
    if (k.campo === 'q' && v > 0) setRd(p => ({ ...p, q: Math.round(v * 1000) / 1000 }))
    if (k.campo === 'pr') setRd(p => ({ ...p, pr: arrotonda2(v) }))
  }
  const apriKp = (campo: 'q' | 'pr') => {
    if (kp && !kp.esce) { if (kp.campo === campo) return; conferma(kp) }
    setKp({ campo, v: '', esce: false })
  }
  const kv = (campo: 'q' | 'pr', v: string) => (kp && !kp.esce && kp.campo === campo && kp.v !== '' ? kp.v : v)

  async function salvaRiga() {
    if (!f || !xr || !RD) return
    const pend = kp && !kp.esce ? kp : null
    let q = RD.q, pr = RD.pr
    if (pend) { const v = numeroDa(pend.v); if (v !== null) { if (pend.campo === 'q' && v > 0) q = v; if (pend.campo === 'pr') pr = arrotonda2(v) } }
    const vecchiaAl = aliquotaRiga(f, xr), vecchiaCat = catDi(xr.art?.tipologia)
    const cambia = q !== xr.quantita || pr !== xr.prezzo_unitario || RD.al !== vecchiaAl || RD.cat !== vecchiaCat
    setKp(null)
    if (!cambia) { setEr(null); setRd({}); return }
    setLavoro(true)
    const errore = await rettificaRiga(f, xr, { q, pr, al: RD.al ?? null, cat: RD.cat, vecchiaAl, vecchiaCat })
    setLavoro(false)
    if (errore) { toast({ title: errore, variant: 'destructive' }); return }
    setEr(null); setRd({})
    setCorrette(s => new Set(s).add(f.id))
    if (!daVer(f)) setRettificateOra(s => new Set(s).add(f.id))
    toast({ title: `${xr.art?.nome_articolo ?? xr.testo_estratto} rettificato` })
    carica()
  }

  async function confermaFattura() {
    if (!f) return
    setLavoro(true)
    const { error } = await createClient().from('fatture').update({ verifiche_sospette: [] }).eq('id', f.id)
    setLavoro(false)
    if (error) { toast({ title: `Conferma non riuscita: ${friendlySaveError(error)}`, variant: 'destructive' }); return }
    resetDettaglio()
    toast({ title: `Fattura di ${f.fornitore} verificata` })
    carica()
  }

  async function eliminaFattura() {
    if (!f) return
    setLavoro(true)
    const sb = createClient()
    // RPC e non delete: ripulisce anche gli articoli di catalogo rimasti
    // senza acquisti (creati solo per questa fattura).
    const { error } = await sb.rpc('elimina_fattura_con_pulizia_articoli', { p_fattura_id: f.id })
    setLavoro(false)
    if (error) { toast({ title: `Eliminazione non riuscita: ${friendlySaveError(error)}`, variant: 'destructive' }); return }
    if (f.foto_paths.length) sb.storage.from('fatture_foto').remove(f.foto_paths).catch(() => {})
    if (f.xml_path) sb.storage.from(BUCKET_XML).remove([f.xml_path]).catch(() => {})
    resetDettaglio(); setSel(null)
    setRighe(r => r.filter(x => x.id !== f.id))
    toast({ title: `Fattura n. ${f.numero_documento} eliminata` })
    carica()
  }

  // ── Dettaglio ─────────────────────────────────────────────────────
  let dettaglio: React.ReactNode = null
  if (f) {
    const D0 = daVer(f)
    const unita = xr?.art?.unita_misura || 'pz'
    const messaggio = del
      ? { testo: `Eliminare la fattura n. ${f.numero_documento}? Spariranno anche i carichi in inventario e la spesa in Analisi.`, tono: 'neg' as const }
      : D0 ? { testo: corrette.has(f.id) ? 'Importi corretti. Controlla il totale lordo con la fattura cartacea e conferma.' : f.verifiche.map(v => v.messaggio).join(' '), tono: 'warn' as const }
      : null
    const ivaPer = [...f.ivaDett.reduce((m, x) => m.set(x.aliquota, (m.get(x.aliquota) ?? 0) + x.iva), new Map<number, number>())].sort((p, q) => p[0] - q[0])
    const sezioni: SezioneDettaglio[] = []
    if (f.ha_articoli) {
      sezioni.push({
        h: 'Righe',
        righe: f.righe.map((x, i) => ({
          l: `${x.art?.nome_articolo ?? x.testo_estratto} · ${nf(x.quantita)} ${x.art?.unita_misura || 'pz'} × ${eu(x.prezzo_unitario)}`,
          v: eu(x.prezzo_riga), matita: true, attiva: er === i,
          on: () => { setKp(null); setDel(false); setRd({}); setEr(er === i ? null : i) },
        })),
      })
    } else {
      sezioni.push({ h: 'Spesa diretta', righe: [{ l: 'Categoria', v: f.categoria ?? '—' }] })
    }
    sezioni.push({ h: 'IVA per aliquota', righe: [...ivaPer.map(([al, v]) => ({ l: `IVA ${nf(al)}%`, v: eu(v) })), { l: 'Totale lordo', v: eu(f.lordo), forte: true }] })
    const documento = [
      ...(f.vuoti ? [{ l: 'Vuoti ritirati', v: '−' + eu(f.vuoti) }, { l: 'Da pagare', v: eu(f.lordo - f.vuoti), forte: true }] : []),
      ...(f.xml_path ? [{ l: 'File XML', v: 'Apri', on: () => apriFileXml(f.xml_path!), matita: false }] : []),
      ...(f.foto_paths.length ? [{ l: 'Foto della fattura', v: `${f.foto_paths.length} ${f.foto_paths.length === 1 ? 'pagina' : 'pagine'}`, on: () => setViewer(f), matita: false }] : []),
      { l: 'Fornitore, numero, data e vuoti', v: '', on: () => apriModifica(f), matita: true },
    ]
    sezioni.push({ h: 'Documento', righe: documento })

    const azioni: AzioneDettaglio[] = del
      ? [{ l: 'Annulla', tipo: 'secondario', on: () => setDel(false) }, { l: 'Elimina fattura', tipo: 'pericoloPieno', on: eliminaFattura, disabled: lavoro }]
      : [
          // Manager e direttore (solo le fatture del suo locale: lo
          // controlla l'RPC).
          { l: 'Elimina', tipo: 'pericolo' as const, on: () => { setKp(null); setEr(null); setDel(true) } },
          ...(D0 ? [{ l: 'Conferma fattura', tipo: 'primario' as const, on: confermaFattura, disabled: lavoro }] : []),
        ]
    const colAz = del ? '1fr 1.4fr' : D0 ? '1fr 2fr' : '1fr'

    dettaglio = (
      <Pannello
        tel={tel}
        titolo={f.fornitore}
        sotto={`Fattura n. ${f.numero_documento} del ${dataLunga(f.data)} · ${nomeLoc(f.restaurant_id)?.nome ?? ''}`}
        badge={D0 ? { t: 'Da verificare', tono: 'warn' } : (f.rettificata || rettificateOra.has(f.id)) ? { t: 'Rettificata', tono: 'ok' } : { t: 'Verificata', tono: 'ok' }}
        messaggio={messaggio}
        stats={[{ l: 'Totale netto', v: eu(f.netto) }, { l: 'Totale lordo', v: eu(f.lordo) }]}
        blocco={xr && RD ? (
          <BloccoCampi
            titolo={xr.art?.nome_articolo ?? xr.testo_estratto}
            campi={[
              { k: 'q', l: 'Quantità', v: kv('q', nf(RD.q)), u: unita, on: kp?.campo === 'q' && !kp.esce, tocca: () => apriKp('q') },
              { k: 'pr', l: `Prezzo per ${unita}`, v: kv('pr', RD.pr.toFixed(2).replace('.', ',')), u: '€', on: kp?.campo === 'pr' && !kp.esce, tocca: () => apriKp('pr') },
            ]}
          >
            <Scelte titolo="Categoria" colonne={3} opzioni={([['food', 'Food'], ['bev', 'Beverage'], ['nofood', 'No food']] as [Cat, string][]).map(([k, l]) => ({ l, on: RD.cat === k, tocca: () => { setKp(null); setRd(p => ({ ...p, cat: k })) } }))} />
            <Scelte titolo="Aliquota IVA" colonne={5} mono opzioni={ALIQUOTE.map(al => ({ l: `${al}%`, on: RD.al === al, tocca: () => { setKp(null); setRd(p => ({ ...p, al })) } }))} />
            <div className="grid grid-cols-[1fr_2fr] gap-2.5">
              <Bottone alto={48} onClick={() => { setKp(null); setEr(null); setRd({}) }}>Annulla</Bottone>
              <Bottone alto={48} tipo="primario" disabled={lavoro} onClick={salvaRiga}>Salva riga · {eu(arrotonda2(RD.q * RD.pr))}</Bottone>
            </div>
          </BloccoCampi>
        ) : null}
        sezioni={sezioni}
        azioni={azioni}
        colonneAzioni={colAz}
        tastierino={kp ? {
          esce: kp.esce,
          onKey: (k: TastoTastierino) => setKp(p => (p ? { ...p, v: digita(p.v, k, p.campo === 'q' ? 3 : 2) } : p)),
          onDone: () => { if (kp) conferma(kp); chiudiKp() },
        } : null}
      />
    )
  }

  // ── File XML conservato: si apre con un URL firmato di 5 minuti ────
  async function apriFileXml(path: string) {
    // La finestra si apre subito, nel gesto dell'utente: dopo l'await i
    // browser la bloccherebbero come pop-up.
    const w = window.open('', '_blank')
    const { data, error } = await createClient().storage.from(BUCKET_XML).createSignedUrl(path, 300)
    if (error || !data?.signedUrl) { w?.close(); toast({ title: `File XML non disponibile: ${error?.message ?? 'errore'}`, variant: 'destructive' }); return }
    if (w) w.location.href = data.signedUrl
    else window.location.href = data.signedUrl
  }

  // ── Coda "Da assegnare": scegli il locale e importa, oppure scarta ──
  const qx = tab === 'da' ? coda?.find(x => x.id === selEff) ?? null : null
  async function assegnaDaCoda() {
    if (!qx || !locCoda) return
    const sb = createClient(), nomeL = nomeLoc(locCoda)?.nome ?? ''
    setLavoro(true)
    // Il file passa dalla cartella della coda a quella del locale; se la
    // copia non riesce resta dov'è (la fattura lo vede comunque).
    let xmlPath = qx.xml_path, origine: string | null = null
    if (xmlPath?.startsWith('coda/')) {
      const dest = `${locCoda}/${xmlPath.slice(5)}`
      const { error } = await sb.storage.from(BUCKET_XML).copy(xmlPath, dest)
      if (!error) { origine = xmlPath; xmlPath = dest }
    }
    const tipologie = new Map(Object.entries(qx.dati.tipologie ?? {}).map(([k, v]) => [Number(k), v]))
    let esito: Awaited<ReturnType<typeof importaXml>> | null = null, errore: string | null = null
    try { esito = await importaXml([{ f: qx.dati, restaurantId: locCoda, modificata: !!qx.dati.modificata, xmlPath, tipologie }]) }
    catch (e) { errore = e instanceof Error ? e.message : 'errore' }
    if (!esito?.ok.length) {
      setLavoro(false)
      if (origine && xmlPath) sb.storage.from(BUCKET_XML).remove([xmlPath]).catch(() => {})
      toast({ title: `Importazione non riuscita: ${errore ?? esito?.errori[0] ?? 'errore'}`, variant: 'destructive' })
      return
    }
    const { error: delErr } = await sb.from('fatture_xml_in_attesa').delete().eq('id', qx.id)
    if (origine && !delErr) sb.storage.from(BUCKET_XML).remove([origine]).catch(() => {})
    setLavoro(false)
    setCoda(c => c?.filter(x => x.id !== qx.id) ?? c)
    resetDettaglio(); setSel(null)
    toast({ title: `Fattura di ${qx.fornitore} importata in ${nomeL}${esito.dv ? ': controlla i dati e conferma' : ''}` })
    caricaCoda(); carica()
  }
  async function scartaDaCoda() {
    if (!qx) return
    const sb = createClient()
    setLavoro(true)
    const { error } = await sb.from('fatture_xml_in_attesa').delete().eq('id', qx.id)
    setLavoro(false)
    if (error) { toast({ title: `Scarto non riuscito: ${friendlySaveError(error)}`, variant: 'destructive' }); return }
    if (qx.xml_path) sb.storage.from(BUCKET_XML).remove([qx.xml_path]).catch(() => {})
    setCoda(c => c?.filter(x => x.id !== qx.id) ?? c)
    resetDettaglio(); setSel(null)
    toast({ title: `Fattura n. ${qx.numero_documento} scartata` })
  }
  if (qx) {
    const fx = qx.dati, mod = !!fx.modificata, rie = riepilogoXml(fx, mod)
    const lordo = lordoXml(fx, mod), netto = rie.reduce((t, r) => t + r.imponibile, 0)
    const scelto = locCoda ? nomeLoc(locCoda) : null
    dettaglio = (
      <Pannello
        tel={tel}
        titolo={qx.fornitore}
        sotto={`Fattura n. ${qx.numero_documento} del ${dataLunga(qx.data)}${qx.file_nome ? ` · ${qx.file_nome}` : ''}`}
        badge={{ t: 'Da assegnare', tono: 'warn' }}
        messaggio={del
          ? { testo: `Scartare la fattura n. ${qx.numero_documento}? Non verrà importata e il file XML sarà eliminato.`, tono: 'neg' }
          : { testo: `${qx.motivo ?? 'Locale non riconosciuto'}. Scegli il locale e importala.`, tono: 'warn' }}
        stats={[{ l: 'Totale netto', v: eu(netto) }, { l: 'Totale lordo', v: eu(lordo) }]}
        blocco={
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-muted-foreground">Locale</span>
            <GrigliaLocali tel={tel} locali={locali} scelto={locCoda} onScegli={id => { setDel(false); setLocCoda(id) }} />
          </div>
        }
        sezioni={[
          { h: 'Righe', righe: fx.righe.map(r => ({ l: `${r.descrizione} · ${nf(r.quantita)} ${r.unita?.toLowerCase() || 'pz'} × ${eu(r.prezzoUnitario)}`, v: eu(r.prezzoTotale) })) },
          { h: 'IVA per aliquota', righe: [...rie.map(r => ({ l: `IVA ${nf(r.aliquota)}% su ${eu(r.imponibile)}`, v: eu(r.imposta) })), { l: 'Totale lordo', v: eu(lordo), forte: true }] },
          { h: 'Documento', righe: [
            { l: 'Partita IVA', v: fx.piva ?? '—' },
            ...(fx.destinatario ? [{ l: 'Codice destinatario', v: fx.destinatario }] : []),
            ...(qx.xml_path ? [{ l: 'File XML', v: 'Apri', on: () => apriFileXml(qx.xml_path!), matita: false }] : []),
          ] },
        ]}
        azioni={del
          ? [{ l: 'Annulla', tipo: 'secondario', on: () => setDel(false) }, { l: 'Scarta fattura', tipo: 'pericoloPieno', on: scartaDaCoda, disabled: lavoro }]
          : [{ l: 'Scarta', tipo: 'pericolo', on: () => setDel(true) }, { l: scelto ? `Importa in ${scelto.nome}` : 'Scegli il locale', tipo: 'primario', on: assegnaDaCoda, disabled: lavoro || !scelto }]}
        colonneAzioni={del ? '1fr 1.4fr' : '1fr 2fr'}
      />
    )
  }

  // ── Nuova fattura, scanner, cattura, XML, foto, modifica ─────────
  const menu = useUscita<true>()
  const scan = useUscita<true>()
  const xml = useUscita<true>()
  const [cattura, setCattura] = useState<{ restaurantId: string; pagine: File[]; avvio: AvvioCattura; rescan?: { fatturaId: string; fotoPaths: string[] } } | null>(null)
  const [viewer, setViewer] = useState<Fattura | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const localeDefault = loc ?? restaurants[0]?.id ?? ''

  // /acquisti/fatture?xml=1 (voce "Importa fatture XML" del menu profilo):
  // si apre direttamente l'importazione.
  const xmlAperto = useRef(false)
  const apriXmlOra = xml.apri
  useEffect(() => {
    if (!apriXml || xmlAperto.current) return
    xmlAperto.current = true
    // Si toglie ?xml=1 dall'indirizzo senza una nuova navigazione (una
    // router.replace ricaricava la pagina e poteva richiudere il foglio).
    setTimeout(() => { apriXmlOra(true); window.history.replaceState(null, '', '/acquisti/fatture') }, 0)
  }, [apriXml, apriXmlOra])
  const ridFile = useRef('')
  const scegliFile = (rid: string) => { ridFile.current = rid; fileRef.current?.click() }

  function daFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    const rid = ridFile.current || localeDefault
    if (!files.length || !rid) return
    setCattura({ restaurantId: rid, pagine: files, avvio: files.length === 1 && files[0].type.startsWith('image/') ? 'ritaglia' : 'pagine' })
  }

  function mostraMese(data: string) {
    const m = data.slice(0, 7)
    if (m !== mese) { avvia(); setMese(m) } else carica()
  }

  async function salvaCatturata(x: FatturaRisolta, restaurantId: string, rescanId?: string) {
    const sb = createClient()
    const target = rescanId ?? x.overwrite_fattura_id
    if (target) {
      const { data: esistente } = await sb.from('fatture').select('restaurant_id, foto_paths').eq('id', target).single()
      const res = await fetch('/api/cassa/fatture/sostituisci', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fattura_id: target, restaurant_id: esistente?.restaurant_id ?? restaurantId, ...x }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Errore nel salvataggio della fattura')
      const nuovi = new Set(x.foto_paths)
      const via = ((esistente?.foto_paths ?? []) as string[]).filter(p => !nuovi.has(p))
      if (via.length) sb.storage.from('fatture_foto').remove(via).catch(() => {})
    } else {
      const res = await fetch('/api/cassa/fatture/salva', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId, ...x }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Errore nel salvataggio della fattura')
    }
    toast({ title: `Fattura di ${x.fornitore.nome} salvata${x.verifiche_sospette.length ? ': controlla i dati e conferma' : ''}` })
    mostraMese(x.data)
  }

  // Modifica dei dati della fattura (fornitore, numero, data, categoria
  // per le spese dirette, vuoti): una sola RPC per i primi quattro, così
  // il vincolo fornitore+numero non scatta su uno stato intermedio.
  const mod = useUscita<{ f: Fattura; fornitore: string; numero: string; data: string; categoria: string; vuoti: number | null }>()
  const apriModifica = (x: Fattura) => mod.apri({ f: x, fornitore: x.fornitore_id, numero: x.numero_documento, data: x.data, categoria: x.categoria_id ?? '', vuoti: x.vuoti })
  async function salvaModifica() {
    const d = mod.dati
    if (!d) return
    if (!d.fornitore || !d.numero.trim() || !d.data) { toast({ title: 'Fornitore, numero documento e data sono obbligatori', variant: 'destructive' }); return }
    if (!d.f.ha_articoli && !d.categoria) { toast({ title: 'Scegli la categoria della spesa', variant: 'destructive' }); return }
    setLavoro(true)
    const sb = createClient()
    const { error } = await sb.rpc('cambia_fornitore_fattura', {
      p_fattura_id: d.f.id, p_nuovo_fornitore_id: d.fornitore, p_numero_documento: d.numero.trim(), p_data: d.data,
      p_categoria_spesa_diretta_id: d.f.ha_articoli ? null : d.categoria,
    })
    let err = error
    if (!err && d.vuoti !== d.f.vuoti) err = (await sb.from('fatture').update({ vuoti_ritirati: d.vuoti || null }).eq('id', d.f.id)).error
    setLavoro(false)
    if (err) { toast({ title: err.code === '23505' ? 'Esiste già una fattura con questo numero per questo fornitore' : `Salvataggio non riuscito: ${friendlySaveError(err)}`, variant: 'destructive' }); return }
    mod.chiudi()
    toast({ title: 'Dati della fattura aggiornati' })
    mostraMese(d.data)
  }

  const nuovaBtn = (
    <button type="button"
      onClick={() => (tel ? scan.apri(true) : menu.apri(true))}
      disabled={!restaurants.length}
      className="flex h-10 items-center gap-2 rounded-[8px] bg-primary px-4 text-sm font-semibold text-primary-foreground active:scale-[0.97] disabled:opacity-50">
      {tel ? <IcoScan /> : <IcoPiu />}{tel ? 'Scansiona' : 'Nuova fattura'}
    </button>
  )

  return (
    <>
      <Vista
        tel={tel}
        skeleton={sk}
        locali={single ? undefined : <PilloleLocali locali={locali} selezionati={loc ? [loc] : []} onCambia={x => cambiaLoc(x[0] ?? null)} className="sm:mx-0 sm:px-0" />}
        mese={{ etichetta: etichettaMese(mese), prec: () => cambiaMese(-1), succ: () => cambiaMese(1), precOk: true, succOk: mese < meseOggi }}
        schede={[{ k: 'all', l: 'Tutte', n: righe.length }, { k: 'dv', l: 'Da verificare', n: nDv }, ...(coda && (coda.length || tab === 'da') ? [{ k: 'da', l: 'Da assegnare', n: coda.length }] : [])]}
        scheda={tab}
        onScheda={k => { setTab(k as 'all' | 'dv' | 'da'); setSel(null); resetDettaglio(); if (k === 'da') caricaCoda() }}
        kpis={[
          { l: `${MESE}, netto`, v: eu(righe.reduce((s, x) => s + x.netto, 0), 0) },
          { l: 'Fatture', v: String(righe.length) },
          { l: 'Da verificare', v: String(nDv), tono: nDv ? 'warn' : undefined },
        ]}
        azione={nuovaBtn}
        colonne={[{ l: 'Fornitore' }, { l: 'Lordo', destra: true }, { l: 'Data', destra: true }, { l: 'Stato', destra: true }]}
        righe={vista}
        caricamento={caricamento}
        errore={errore ? { testo: errore, riprova: () => { avvia(); carica() } } : null}
        vuoto={tab === 'da'
          ? { t: 'Nessuna fattura da assegnare', s: 'Le fatture XML di cui non si capisce il locale compaiono qui, di qualsiasi mese.' }
          : tab === 'dv'
          ? { t: 'Nessuna fattura da verificare', s: 'Le fatture caricate con dati incerti compaiono qui.' }
          : { t: 'Nessuna fattura nel mese', s: 'Le fatture caricate per questo mese compaiono qui.' }}
        sel={selEff}
        onSel={id => { resetDettaglio(); setSel(id) }}
        // Rettifiche ed eliminazione agiscono sulla fattura mostrata: al
        // primo tocco quella scelta da sola diventa la selezione vera, così
        // una fattura nuova in cima alla lista non la sostituisce a metà lavoro.
        onFissa={() => { if (sel === null && selEff) setSel(selEff) }}
        onChiudi={() => { resetDettaglio(); setSel(null) }}
        dettaglio={dettaglio}
        chiaveDettaglio={selEff ?? ''}
      />

      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={daFile} />

      {menu.dati && (
        <MenuNuovaFattura tel={tel} esce={menu.esce} onChiudi={() => menu.chiudi()}
          onScatta={() => menu.chiudi(() => scan.apri(true))}
          onFile={() => (single ? (menu.chiudi(), scegliFile(localeDefault)) : menu.chiudi(() => scan.apri(true)))}
          onXml={() => menu.chiudi(() => xml.apri(true))} />
      )}
      {scan.dati && (
        <ScansionaFattura tel={tel} esce={scan.esce} locali={single ? [] : locali} localeIniziale={localeDefault}
          onChiudi={() => scan.chiudi()}
          onFile={rid => { scan.chiudi(); scegliFile(rid) }}
          onPagine={(rid, pagine, avvio) => scan.chiudi(() => setCattura({ restaurantId: rid, pagine, avvio }))} />
      )}
      {xml.dati && (
        <ImportaXml tel={tel} esce={xml.esce} locali={locali}
          onChiudi={() => xml.chiudi()}
          onImportate={(n, dv, attesa, chiudi) => {
            if (chiudi) xml.chiudi()
            const parti = [n ? `${n} ${n === 1 ? 'fattura importata' : 'fatture importate'}` : '', dv ? `${dv} da verificare` : '', attesa ? `${attesa} da assegnare` : ''].filter(Boolean)
            toast({ title: parti.join(' · ') })
            carica(); if (attesa) caricaCoda()
          }} />
      )}
      {cattura && (
        <FatturaCapture
          tel={tel}
          restaurantId={cattura.restaurantId}
          categorieDirette={categorieDirette}
          fornitori={fornitori}
          pagineIniziali={cattura.pagine}
          avvio={cattura.avvio}
          rescan={cattura.rescan}
          onComplete={x => salvaCatturata(x, cattura.restaurantId, cattura.rescan?.fatturaId)}
          onFinished={() => setCattura(null)}
          onCancel={() => setCattura(null)}
        />
      )}
      <FatturaFotoViewer
        open={!!viewer}
        onOpenChange={o => { if (!o) setViewer(null) }}
        fotoPaths={viewer?.foto_paths ?? []}
        title={viewer ? `${viewer.fornitore} · n. ${viewer.numero_documento}` : ''}
        onRescan={viewer ? () => { const v = viewer; setViewer(null); setCattura({ restaurantId: v.restaurant_id, pagine: [], avvio: 'pagine', rescan: { fatturaId: v.id, fotoPaths: v.foto_paths } }) } : undefined}
      />
      {mod.dati && (
        <Modale tel={tel} esce={mod.esce} onChiudi={() => mod.chiudi()} titolo="Dati della fattura" sotto={mod.dati.f.fornitore}
          piede={
            <div className={cn('grid grid-cols-[1fr_1.6fr] gap-2.5 border-t border-border py-3', tel ? 'px-4' : 'px-[22px]')}>
              <Bottone onClick={() => mod.chiudi()}>Annulla</Bottone>
              <Bottone tipo="primario" disabled={lavoro} onClick={salvaModifica}>Salva</Bottone>
            </div>
          }>
          <ModificaDati tel={tel} d={mod.dati} fornitori={fornitori} categorie={categorieDirette} onCambia={p => mod.setDati(x => (x ? { ...x, ...p } : x))} />
        </Modale>
      )}
    </>
  )
}

const CAMPO = 'box-border h-11 w-full rounded-[6px] border border-line-strong bg-card px-3 text-[15px] font-medium outline-none focus:border-[1.5px] focus:border-[oklch(0.58_0.12_180)]'

function ModificaDati({ tel, d, fornitori, categorie, onCambia }: {
  tel: boolean
  d: { f: { ha_articoli: boolean }; fornitore: string; numero: string; data: string; categoria: string; vuoti: number | null }
  fornitori: { id: string; nome: string }[]
  categorie: { id: string; nome: string }[]
  onCambia: (p: Partial<{ fornitore: string; numero: string; data: string; categoria: string; vuoti: number | null }>) => void
}) {
  return (
    <div className={cn('flex flex-col gap-3.5 py-4', tel ? 'px-4' : 'px-[22px]')}>
      <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Fornitore</span>
        <select value={d.fornitore} onChange={e => onCambia({ fornitore: e.target.value })} className={CAMPO}>
          {fornitori.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Numero documento</span>
          <input value={d.numero} onChange={e => onCambia({ numero: e.target.value })} className={cn(CAMPO, 'font-mono')} />
        </label>
        <label className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Data</span>
          <input type="date" value={d.data} onChange={e => onCambia({ data: e.target.value })} className={cn(CAMPO, 'font-mono')} />
        </label>
      </div>
      {!d.f.ha_articoli && (
        <div className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Categoria</span>
          <div className="grid grid-cols-2 gap-1.5">
            {categorie.map(c => (
              <button key={c.id} type="button" onClick={() => onCambia({ categoria: c.id })}
                className={cn('h-11 rounded-[8px] border text-sm font-medium active:scale-[0.97]', d.categoria === c.id ? 'border-primary bg-primary text-primary-foreground' : 'border-line-strong bg-card')}>{c.nome}</button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Vuoti ritirati <span className="font-normal text-muted-foreground">(facoltativo)</span></span>
        <CampoNumerico value={d.vuoti} onChange={v => onCambia({ vuoti: v })} suffisso="€" allinea="right" />
        <span className="text-xs text-muted-foreground">Cauzione su fusti e casse scalata dal fornitore: non cambia il totale, solo quanto resta da pagare.</span>
      </div>
    </div>
  )
}

// ── Rettifica di una riga ────────────────────────────────────────────

/**
 * Corregge quantità, prezzo, aliquota e categoria di una riga. Prima prova
 * la RPC della migrazione proposta (atomica, ricalcola anche il riepilogo
 * IVA); finché non esiste, aggiorna la riga e sposta l'imponibile tra le
 * aliquote del riepilogo IVA. I totali li ricalcola il trigger.
 */
async function rettificaRiga(f: Fattura, r: RigaArticolo, n: { q: number; pr: number; al: number | null; cat: Cat; vecchiaAl: number | null; vecchiaCat: Cat }): Promise<string | null> {
  const sb = createClient()
  const tipologia: ArticoloTipologia | null = n.cat === n.vecchiaCat ? null
    : n.cat === 'food' ? 'food' : n.cat === 'bev' ? 'beverage' : (r.art?.tipologia === 'detergenza' ? 'detergenza' : 'altro_no_food')
  const nuovaRiga = arrotonda2(n.q * n.pr)
  const rpc = await sb.rpc('rettifica_riga_fattura', { p_riga_id: r.id, p_quantita: n.q, p_prezzo_unitario: n.pr, p_aliquota: n.al, p_tipologia: tipologia })
  if (!rpc.error) return null
  const manca = rpc.error.code === 'PGRST202' || rpc.error.code === '42883' || /could not find the function/i.test(rpc.error.message)
  if (!manca) return `Rettifica non riuscita: ${friendlySaveError(rpc.error)}`

  const e1 = (await sb.from('fatture_articoli').update({ quantita: n.q, prezzo_unitario: n.pr, prezzo_riga: nuovaRiga }).eq('id', r.id)).error
  if (e1) return `Rettifica non riuscita: ${friendlySaveError(e1)}`
  if (tipologia) {
    const e2 = (await sb.from('catalogo_articoli').update({ tipologia }).eq('id', r.catalogo_articolo_id)).error
    if (e2) return `Riga corretta, categoria non aggiornata: ${friendlySaveError(e2)}`
  }
  // Riepilogo IVA: l'imponibile della riga esce dalla vecchia aliquota ed
  // entra nella nuova. Senza aliquota nota (fattura con più aliquote e
  // riga senza aliquota salvata) il riepilogo resta com'era.
  if (n.al !== null) {
    const mappa = new Map(f.ivaDett.map(x => [x.aliquota, { ...x }]))
    if (n.vecchiaAl !== null && mappa.has(n.vecchiaAl)) { const x = mappa.get(n.vecchiaAl)!; x.imponibile = arrotonda2(x.imponibile - r.prezzo_riga) }
    const dest = mappa.get(n.al)
    if (dest) dest.imponibile = arrotonda2(dest.imponibile + nuovaRiga)
    for (const x of mappa.values()) {
      const vecchio = f.ivaDett.find(y => y.id === x.id)
      if (vecchio && vecchio.imponibile === x.imponibile) continue
      const e3 = (await sb.from('fatture_iva_dettaglio').update({ imponibile: x.imponibile, iva: arrotonda2(x.imponibile * x.aliquota / 100) }).eq('id', x.id)).error
      if (e3) return `Riga corretta, riepilogo IVA non aggiornato: ${friendlySaveError(e3)}`
    }
    if (!dest) {
      const e4 = (await sb.from('fatture_iva_dettaglio').insert({ fattura_id: f.id, aliquota: n.al, imponibile: nuovaRiga, iva: arrotonda2(nuovaRiga * n.al / 100) })).error
      if (e4) return `Riga corretta, riepilogo IVA non aggiornato: ${friendlySaveError(e4)}`
    }
  }
  // Un totale corretto a mano in passato coprirebbe la rettifica: ora vale la somma delle righe.
  await sb.from('fatture').update({ totale_lordo_manuale: null, totale_netto_manuale: null }).eq('id', f.id)
  return null
}
