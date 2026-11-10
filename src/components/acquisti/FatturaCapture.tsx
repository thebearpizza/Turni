'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/compressImage'
import { Tastierino, type TastoTastierino } from '@/components/ui/tastierino'
import { cn } from '@/lib/utils'
import type { ArticoloTipologia, VerificaSospetta, RiquadroArticolo } from '@/types'
import { DocumentScanner } from './DocumentScanner'
import { ALIQUOTE, Badge, IcoAvviso, IcoErrore, IcoGiu, IcoPiu, IcoX, dataNumerica, eu, n2, numeroDa, useMontato, useToccoFuori, type Tono } from './comuni'

// Cattura di una fattura (Acquisti cattura, 11b–11e): pagine, lettura a
// gruppi di 4, errore con "Riprova" che rilegge solo i gruppi mancanti,
// revisione di una fattura alla volta e schermata dei doppioni. Non salva:
// passa i dati risolti a onComplete, una volta per fattura confermata.

interface AliquotaEstratta { aliquota: number; imponibile: number; iva: number }

interface ArticoloEstratto {
  testo_estratto: string
  quantita: number
  prezzo_riga: number
  unita_misura: string | null
  tipologia_suggerita: ArticoloTipologia
  esito: 'auto_mappato' | 'chiaro' | 'ambiguo' | 'nuovo'
  catalogo_articolo_id: string | null
  candidato_nome: string | null
  sospetto: VerificaSospetta | null
  pagina_indice: number
  riquadro: RiquadroArticolo | null
  aliquota_iva?: number | null
}

/** Pagina letta (fase 1), prima del raggruppamento in fatture. */
type PaginaLetta = Record<string, unknown>

interface EstraiResponse {
  duplicato: boolean
  fattura_esistente_id?: string
  fattura_esistente_data?: string
  fattura_esistente_numero?: string
  fattura_esistente_totale?: number
  fattura_esistente_caricata?: string
  fattura_esistente_da_pdf?: boolean
  numero_letto?: string
  totale_letto?: number
  foto_paths: string[]
  fornitore: { id: string; nome: string; partita_iva: string | null; nuovo: boolean }
  fattura?: {
    data: string
    numero_documento: string
    ha_articoli: boolean
    iva_dettaglio: AliquotaEstratta[]
    totale_netto: number
    totale_iva: number
    totale_lordo: number
    verifiche_sospette: VerificaSospetta[]
  }
  articoli?: ArticoloEstratto[]
  /** Compilata a mano (lettura non riuscita): fornitore da scegliere. */
  manuale?: boolean
}

interface DatiNuovoArticolo { nome_articolo: string; tipologia: ArticoloTipologia; unita_misura?: string }

export interface FatturaRisolta {
  foto_paths: string[]
  fornitore: { id: string; nome: string; partita_iva: string | null }
  data: string
  numero_documento: string
  /** "Sostituisci quella esistente" su un doppione: aggiorna quella fattura. */
  overwrite_fattura_id?: string
  ha_articoli: boolean
  categoria_spesa_diretta_id: string | null
  iva_dettaglio: AliquotaEstratta[]
  totale_netto: number
  totale_iva: number
  totale_lordo: number
  /** Correzioni a mano del totale (null = nessuno scavalco). */
  totale_lordo_manuale: number | null
  totale_netto_manuale: number | null
  vuoti_ritirati: number | null
  articoli: Array<
    { testo_estratto: string; quantita: number; prezzo_riga: number; pagina_indice: number; riquadro: RiquadroArticolo | null; aliquota_iva?: number | null } & (
      | { catalogo_articolo_id: string; nuovo_articolo?: undefined }
      | { catalogo_articolo_id?: undefined; nuovo_articolo: DatiNuovoArticolo }
    )
  >
  verifiche_sospette: VerificaSospetta[]
}

export type AvvioCattura = 'pagine' | 'ritaglia' | 'leggi'

interface Props {
  tel: boolean
  restaurantId: string
  categorieDirette: { id: string; nome: string }[]
  fornitori: { id: string; nome: string }[]
  /** File già scelti (scanner, PDF): 'ritaglia' passa la prima foto dal ritaglio, 'leggi' parte subito. */
  pagineIniziali?: File[]
  avvio?: AvvioCattura
  /** Ri-scansione: precompila le pagine con le foto già salvate della fattura. */
  rescan?: { fatturaId: string; fotoPaths: string[] }
  onComplete: (fattura: FatturaRisolta) => Promise<void>
  onFinished: () => void
  onCancel: () => void
}

// Quante pagine per chiamata a /estrai: più pagine insieme vanno spesso in
// timeout per la concorrenza verso il modello AI.
const PAGINE_PER_GRUPPO = 4

type Schermata = 'pagine' | 'lettura' | 'errore' | 'revisione'
interface Lettura { fase: 'upload' | 'lettura' | 'composizione'; gruppo: number; gruppi: number[][] }

async function comprimi(f: File) {
  if (!f.type.startsWith('image/')) return f
  try { return await compressImage(f, 2200, 0.9) } catch { return f }
}

export function FatturaCapture({ tel, restaurantId, categorieDirette, fornitori, pagineIniziali, avvio = 'pagine', rescan, onComplete, onFinished, onCancel }: Props) {
  const montato = useMontato()
  const [pagine, setPagine] = useState<{ f: File; url: string }[]>([])
  const [schermata, setSchermata] = useState<Schermata>('pagine')
  const [ritaglio, setRitaglio] = useState<{ f: File; indice: number | null } | null>(null)
  const [lettura, setLettura] = useState<Lettura | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [results, setResults] = useState<EstraiResponse[]>([])
  const [idx, setIdx] = useState(0)
  const cur = results[idx] as EstraiResponse | undefined

  // Lavoro già fatto, per "Riprova" senza ricaricare né rileggere.
  const caricati = useRef<string[]>([])
  const letti = useRef<PaginaLetta[]>([])
  const gruppiLetti = useRef(0)

  const aggiungi = useCallback(async (files: File[]) => {
    for (const f of files) {
      const c = await comprimi(f)
      setPagine(p => [...p, { f: c, url: URL.createObjectURL(c) }])
    }
  }, [])

  // ── Avvio: file passati dallo scanner, oppure foto della ri-scansione ──
  const avviato = useRef(false)
  const elaboraRef = useRef<(files?: File[]) => void>(() => {})
  useEffect(() => {
    if (avviato.current) return
    avviato.current = true
    setTimeout(async () => {
      if (rescan) {
        const sb = createClient()
        try {
          for (const path of rescan.fotoPaths) {
            const { data, error } = await sb.storage.from('fatture_foto').download(path)
            if (error || !data) throw error ?? new Error('Foto non trovata')
            const f = new File([data], `pagina.${path.split('.').pop() ?? 'jpg'}`, { type: data.type || 'image/jpeg' })
            setPagine(p => [...p, { f, url: URL.createObjectURL(f) }])
          }
        } catch (e) {
          setErrore(`Foto della fattura non recuperate: ${e instanceof Error ? e.message : 'errore'}`)
        }
        return
      }
      const files = pagineIniziali ?? []
      if (avvio === 'ritaglia' && files.length === 1 && files[0].type.startsWith('image/')) { setRitaglio({ f: files[0], indice: null }); return }
      if (avvio === 'leggi') {
        const c = await Promise.all(files.map(comprimi))
        setPagine(c.map(f => ({ f, url: URL.createObjectURL(f) })))
        elaboraRef.current(c)
        return
      }
      await aggiungi(files)
    }, 0)
  }, [rescan, pagineIniziali, avvio, aggiungi])

  function rimuovi(i: number) {
    setPagine(p => { URL.revokeObjectURL(p[i].url); return p.filter((_, j) => j !== i) })
  }

  async function confermaRitaglio(f: File) {
    const r = ritaglio
    setRitaglio(null)
    if (!r) return
    const c = await comprimi(f)
    if (r.indice === null) setPagine(p => [...p, { f: c, url: URL.createObjectURL(c) }])
    else setPagine(p => p.map((x, j) => (j === r.indice ? (URL.revokeObjectURL(x.url), { f: c, url: URL.createObjectURL(c) }) : x)))
  }

  function daInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    // Una singola foto passa sempre dal ritaglio; PDF o più file no.
    if (files.length === 1 && files[0].type.startsWith('image/')) { setRitaglio({ f: files[0], indice: null }); return }
    aggiungi(files)
  }

  // ── Lettura ─────────────────────────────────────────────────────────
  async function chiamaComponi(pg: PaginaLetta[], paths: string[], escludi?: string): Promise<{ fatture: EstraiResponse[] } | { error: string }> {
    try {
      const res = await fetch('/api/cassa/fatture/componi', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId, foto_paths: paths, pagine: pg, exclude_fattura_id: escludi }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) return { error: data?.error ?? (res.status === 504 ? 'La composizione ha superato il tempo massimo.' : `Errore nella composizione della fattura (codice ${res.status}).`) }
      return { fatture: (data.fatture ?? []) as EstraiResponse[] }
    } catch { return { error: 'Errore di rete durante la composizione.' } }
  }

  async function elabora(filesForzati?: File[]) {
    const files = filesForzati ?? pagine.map(p => p.f)
    if (!files.length) return
    setSchermata('lettura'); setErrore(null)
    const sb = createClient()
    // Le foto le carica il browser direttamente sullo storage: il corpo di
    // una richiesta a una funzione serverless è limitato a 4,5 MB.
    if (caricati.current.length !== files.length) {
      setLettura({ fase: 'upload', gruppo: 0, gruppi: [] })
      const paths: string[] = []
      try {
        for (let i = 0; i < files.length; i++) {
          const ext = files[i].name.split('.').pop() ?? 'jpg'
          const path = `${restaurantId}/${Date.now()}-${i}.${ext}`
          const { error } = await sb.storage.from('fatture_foto').upload(path, files[i], { contentType: files[i].type || 'image/jpeg', upsert: false })
          if (error) throw error
          paths.push(path)
        }
      } catch (e) {
        if (paths.length) sb.storage.from('fatture_foto').remove(paths).catch(() => {})
        setErrore(`Caricamento delle foto non riuscito: ${e instanceof Error ? e.message : 'errore'}. Riprova.`)
        setSchermata('errore')
        return
      }
      caricati.current = paths; letti.current = []; gruppiLetti.current = 0
    }
    const paths = caricati.current
    const gruppi: number[][] = []
    for (let i = 0; i < paths.length; i += PAGINE_PER_GRUPPO) gruppi.push(Array.from({ length: Math.min(PAGINE_PER_GRUPPO, paths.length - i) }, (_, k) => i + k))

    for (let g = gruppiLetti.current; g < gruppi.length; g++) {
      setLettura({ fase: 'lettura', gruppo: g, gruppi })
      let msg: string | null = null, pg: PaginaLetta[] | null = null
      try {
        const res = await fetch('/api/cassa/fatture/estrai', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ restaurant_id: restaurantId, foto_paths: gruppi[g].map(i => paths[i]), exclude_fattura_id: rescan?.fatturaId }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data) msg = data?.error ?? (res.status === 504 ? 'La lettura ha superato il tempo massimo.' : `Lettura non riuscita (codice ${res.status}).`)
        else pg = data.pagine ?? []
      } catch { msg = 'Errore di rete durante la lettura.' }
      if (msg) {
        setErrore(`${msg} Riprova con meno pagine per volta, oppure compila i dati a mano.`)
        setSchermata('errore')
        return
      }
      letti.current = [...letti.current, ...(pg ?? [])]
      gruppiLetti.current = g + 1
    }

    setLettura({ fase: 'composizione', gruppo: gruppi.length, gruppi })
    const comp = await chiamaComponi(letti.current, paths, rescan?.fatturaId)
    if ('error' in comp) {
      // Una composizione fallita rifà da capo la lettura: il server ha già ripulito le foto.
      if (!rescan) { caricati.current = []; letti.current = []; gruppiLetti.current = 0 }
      setErrore(`${comp.error} Riprova, oppure compila i dati a mano.`)
      setSchermata('errore')
      return
    }
    setResults(comp.fatture); setIdx(0); resetRevisione(); setSchermata('revisione')
  }
  useEffect(() => { elaboraRef.current = elabora })

  function compilaAMano() {
    setResults([{
      duplicato: false, manuale: true, foto_paths: caricati.current,
      fornitore: { id: '', nome: '', partita_iva: null, nuovo: false },
      fattura: { data: '', numero_documento: '', ha_articoli: false, iva_dettaglio: [], totale_netto: 0, totale_iva: 0, totale_lordo: 0, verifiche_sospette: [] },
      articoli: [],
    }])
    setIdx(0); resetRevisione(); setSchermata('revisione')
  }

  // ── Revisione ───────────────────────────────────────────────────────
  const [ed, setEd] = useState<Record<string, string | undefined>>({})
  const [kp, setKp] = useState<{ k: string; esce: boolean } | null>(null)
  const prev = useRef<string | undefined>(undefined)
  const [fornitoreEd, setFornitoreEd] = useState<{ id: string; nome: string } | null>(null)
  const [dataEd, setDataEd] = useState<string | null>(null)
  const [numEd, setNumEd] = useState<string | null>(null)
  const [categoria, setCategoria] = useState('')
  const [resolved, setResolved] = useState<Map<string, { id: string; sospetto: VerificaSospetta | null }>>(new Map())
  const [rifiutati, setRifiutati] = useState<Set<string>>(new Set())
  const [overwrite, setOverwrite] = useState<Map<number, string>>(new Map())
  const [salva, setSalva] = useState(false)
  const [rilettura, setRilettura] = useState(false)

  function resetRevisione() {
    setEd({}); setKp(null); setFornitoreEd(null); setDataEd(null); setNumEd(null); setCategoria('')
    setResolved(new Map()); setRifiutati(new Set()); setErrore(null)
  }

  const kpK = kp && !kp.esce ? kp.k : null
  const chiudiKp = useCallback(() => {
    if (!kpK) return
    // "Fatto" o tocco fuori senza aver digitato: resta il valore di prima.
    setEd(e => (e[kpK] === '' || e[kpK] === undefined ? { ...e, [kpK]: prev.current } : e))
    setKp({ k: kpK, esce: true })
    setTimeout(() => setKp(x => (x?.esce ? null : x)), 320)
  }, [kpK])
  useToccoFuori(!!kp && !kp.esce, '[data-kp]', chiudiKp)
  const tocca = (k: string) => () => {
    if (kp?.k === k && !kp.esce) return
    if (kp && !kp.esce) setEd(e => (e[kp.k] === '' ? { ...e, [kp.k]: prev.current } : e))
    prev.current = ed[k]
    setKp({ k, esce: false })
    if (k[0] !== 'i') setEd(e => ({ ...e, [k]: '' }))
  }
  const premi = (t: TastoTastierino) => setEd(e => {
    if (!kp) return e
    let c = e[kp.k] ?? ''
    if (t === 'del') c = c.slice(0, -1)
    else if (t === ',') { if (!c.includes(',')) c = (c || '0') + ',' }
    else { if (c.includes(',') && c.split(',')[1].length >= (kp.k[0] === 'q' ? 3 : 2)) return e; if (c.replace(',', '').length >= 8) return e; c = c === '0' ? t : c + t }
    return { ...e, [kp.k]: c }
  })
  const ov = (k: string) => { const v = ed[k]; return v !== undefined && v !== '' ? numeroDa(v) : null }

  const articoli = cur?.articoli ?? []
  const fornitoreEff = fornitoreEd ?? (cur && cur.fornitore.id ? cur.fornitore : null)
  const aliquotaUnica = cur?.fattura && cur.fattura.iva_dettaglio.length === 1 ? cur.fattura.iva_dettaglio[0].aliquota : null

  function risolto(a: ArticoloEstratto): { id: string; sospetto: VerificaSospetta | null } | null {
    // Con il fornitore cambiato a mano gli abbinamenti del server puntano
    // al catalogo sbagliato: l'articolo torna nuovo.
    if (cur && fornitoreEd && fornitoreEd.id !== cur.fornitore.id) return resolved.get(a.testo_estratto) ?? null
    if ((a.esito === 'auto_mappato' || a.esito === 'chiaro') && !rifiutati.has(a.testo_estratto)) return a.catalogo_articolo_id ? { id: a.catalogo_articolo_id, sospetto: a.sospetto } : null
    return resolved.get(a.testo_estratto) ?? null
  }

  async function confermaStesso(a: ArticoloEstratto, prezzoUnitario: number) {
    if (!fornitoreEff || !a.catalogo_articolo_id) return
    try {
      const res = await fetch('/api/cassa/fatture/conferma-articolo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId, fornitore_id: fornitoreEff.id, testo_estratto: a.testo_estratto, decisione: 'stesso', catalogo_articolo_id: a.catalogo_articolo_id, prezzo_unitario: prezzoUnitario }),
      })
      const data = await res.json()
      if (!res.ok) { setErrore(data.error ?? 'Scelta non salvata, riprova'); return }
      setResolved(m => new Map(m).set(a.testo_estratto, { id: data.catalogo_articolo_id, sospetto: data.sospetto ?? null }))
    } catch { setErrore('Errore di rete, riprova') }
  }

  // Valori effettivi di ogni riga (letti o corretti) e totali dal vivo.
  const righe = articoli.map((a, i) => {
    const pu0 = a.quantita ? a.prezzo_riga / a.quantita : a.prezzo_riga
    const al0 = a.aliquota_iva ?? aliquotaUnica ?? 22
    const q = ov('q' + i) ?? a.quantita, p = ov('p' + i) ?? pu0, iv = ov('i' + i) ?? al0
    const mod = (ov('q' + i) !== null && q !== a.quantita) || (ov('p' + i) !== null && Math.abs(p - pu0) > 0.0001) || (ov('i' + i) !== null && iv !== al0)
    return { a, i, q, p, iv, riga: q * p, mod, ivaMod: ov('i' + i) !== null && iv !== al0 }
  })
  const toccate = righe.some(r => r.mod)
  const nettoRighe = righe.reduce((t, r) => t + r.riga, 0)
  const ivaRighe = righe.reduce((t, r) => t + r.riga * r.iv / 100, 0)
  const fatt = cur?.fattura
  const ivaE = ov('ti') ?? (fatt?.ha_articoli && toccate ? ivaRighe : fatt?.totale_iva ?? 0)
  const nettoE = ov('tn') ?? (ov('tl') !== null ? (ov('tl') as number) - ivaE : fatt?.ha_articoli ? nettoRighe : fatt?.totale_netto ?? 0)
  const lordoE = ov('tl') ?? nettoE + ivaE
  const vuoti = ov('vu')
  const dataEff = (dataEd ?? fatt?.data ?? '').trim()
  const numEff = (numEd ?? fatt?.numero_documento ?? '').trim()
  const testataOk = !!dataEff && !!numEff && !!fornitoreEff
  const serveCategoria = fatt?.ha_articoli === false
  const pronta = testataOk && (!serveCategoria || !!categoria) && (!cur?.manuale || nettoE > 0)
  const ultima = idx >= results.length - 1

  function avanti() {
    if (cur?.duplicato && cur.foto_paths.length) createClient().storage.from('fatture_foto').remove(cur.foto_paths).catch(() => {})
    if (ultima) { onFinished(); return }
    setIdx(i => i + 1); resetRevisione()
  }
  function annulla() {
    // Le foto delle fatture non ancora salvate non verranno mai collegate.
    if (schermata === 'revisione') {
      const via = results.slice(idx).flatMap(r => r.foto_paths)
      if (via.length) createClient().storage.from('fatture_foto').remove(via).catch(() => {})
    } else if (caricati.current.length && !rescan) {
      createClient().storage.from('fatture_foto').remove(caricati.current).catch(() => {})
    }
    onCancel()
  }

  async function sostituisciDoppione() {
    if (!cur?.fattura_esistente_id) return
    setRilettura(true); setErrore(null)
    try {
      const r = await fetch('/api/cassa/fatture/estrai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId, foto_paths: cur.foto_paths, exclude_fattura_id: cur.fattura_esistente_id }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.pagine) { setErrore(d?.error ?? 'Rilettura non riuscita, riprova.'); return }
      const comp = await chiamaComponi(d.pagine, cur.foto_paths, cur.fattura_esistente_id)
      if ('error' in comp || !comp.fatture[0]) { setErrore('error' in comp ? comp.error : 'Rilettura non riuscita, riprova.'); return }
      const nuovo = comp.fatture[0]
      if (!nuovo.duplicato) setOverwrite(m => new Map(m).set(idx, cur.fattura_esistente_id as string))
      setResults(rs => rs.map((x, i) => (i === idx ? nuovo : x)))
    } catch { setErrore('Errore di rete, riprova') } finally { setRilettura(false) }
  }

  async function conferma() {
    if (!cur || !fatt || !fornitoreEff || !pronta) return
    // Riepilogo IVA: quello letto, oppure ricostruito dalle righe quando
    // quantità, prezzi o aliquote sono stati corretti.
    let ivaDett: AliquotaEstratta[] = fatt.iva_dettaglio
    if (fatt.ha_articoli && toccate) {
      const m = new Map<number, number>()
      righe.forEach(r => m.set(r.iv, (m.get(r.iv) ?? 0) + r.riga))
      ivaDett = [...m].map(([aliquota, imp]) => ({ aliquota, imponibile: Math.round(imp * 100) / 100, iva: Math.round(imp * aliquota) / 100 }))
    }
    if (cur.manuale) {
      const al = nettoE > 0 ? ALIQUOTE.reduce((b, x) => (Math.abs(x - ivaE / nettoE * 100) < Math.abs(b - ivaE / nettoE * 100) ? x : b), 22) : 0
      ivaDett = [{ aliquota: al, imponibile: Math.round(nettoE * 100) / 100, iva: Math.round(ivaE * 100) / 100 }]
    }
    const verificheArt = articoli.map(a => risolto(a)?.sospetto).filter((v): v is VerificaSospetta => !!v)
    setSalva(true); setErrore(null)
    try {
      await onComplete({
        foto_paths: cur.foto_paths,
        overwrite_fattura_id: overwrite.get(idx),
        fornitore: { ...fornitoreEff, partita_iva: fornitoreEd ? null : cur.fornitore.partita_iva },
        data: dataEff,
        numero_documento: numEff,
        ha_articoli: fatt.ha_articoli,
        categoria_spesa_diretta_id: serveCategoria ? categoria : null,
        iva_dettaglio: ivaDett,
        totale_netto: fatt.totale_netto, totale_iva: fatt.totale_iva, totale_lordo: fatt.totale_lordo,
        totale_netto_manuale: ov('tn') !== null ? nettoE : null,
        totale_lordo_manuale: ov('tl') !== null || ov('ti') !== null ? lordoE : null,
        vuoti_ritirati: vuoti,
        articoli: righe.map(r => {
          const info = risolto(r.a)
          const base = { testo_estratto: r.a.testo_estratto, quantita: r.q, prezzo_riga: Math.round(r.riga * 100) / 100, pagina_indice: r.a.pagina_indice, riquadro: r.a.riquadro, aliquota_iva: r.iv }
          return info ? { ...base, catalogo_articolo_id: info.id }
            : { ...base, nuovo_articolo: { nome_articolo: r.a.testo_estratto, tipologia: r.a.tipologia_suggerita, unita_misura: r.a.unita_misura ?? undefined } }
        }),
        verifiche_sospette: [...fatt.verifiche_sospette, ...verificheArt],
      })
      avanti()
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Salvataggio non riuscito')
    } finally { setSalva(false) }
  }

  // ── Resa ────────────────────────────────────────────────────────────
  if (!montato) return null
  const nPag = pagine.length
  const titolo = schermata === 'revisione' && results.length > 1 ? `Fattura ${idx + 1} di ${results.length}` : rescan ? 'Ri-scansiona' : 'Nuova fattura'
  const sotto = schermata === 'lettura' ? "Non chiudere l'app"
    : schermata === 'revisione' ? (cur?.duplicato ? cur.fornitore.nome : 'Controlla i dati letti')
    : `${nPag} ${nPag === 1 ? 'pagina' : 'pagine'}`
  const fileCam = <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={daInput} />
  const fileMulti = <input type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={daInput} />

  const corpo = ritaglio ? (
    <DocumentScanner file={ritaglio.f} pagina={(ritaglio.indice ?? nPag) + 1} onConfirm={confermaRitaglio} onCancel={() => setRitaglio(null)} />
  ) : (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-none items-center gap-2.5 border-b border-border px-4 py-2">
        <button type="button" onClick={annulla} aria-label="Chiudi" className="flex h-11 w-11 items-center justify-center text-muted-foreground active:scale-[0.96]"><IcoX s={18} /></button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <span className="text-base font-semibold">{titolo}</span>
          <span className="truncate text-xs text-muted-foreground">{sotto}</span>
        </div>
        <div className="w-11" />
      </div>

      {schermata === 'pagine' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {pagine.map((p, i) => {
              const pdf = p.f.type === 'application/pdf'
              return (
                <div key={p.url} className="anim-swapin relative box-border flex aspect-[3/4] flex-col gap-[5px] overflow-hidden rounded-[6px] border border-[oklch(0.88_0.01_250)] bg-card dark:border-border">
                  {pdf ? (
                    <div className="flex flex-col gap-[5px] px-2 py-2.5">
                      <div className="h-1.5 w-3/5 rounded-[2px] bg-[oklch(0.85_0.01_250)]" /><div className="h-1 w-[85%] rounded-[2px] bg-[oklch(0.9_0.01_250)]" />
                      <div className="h-1 w-3/4 rounded-[2px] bg-[oklch(0.9_0.01_250)]" /><div className="h-1 w-4/5 rounded-[2px] bg-[oklch(0.9_0.01_250)]" />
                      <span className="mt-1 line-clamp-2 break-all text-[10px] text-muted-foreground">{p.f.name}</span>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- anteprima locale da blob URL
                    <img src={p.url} alt={`Pagina ${i + 1}`} className="h-full w-full object-cover" />
                  )}
                  <span className="absolute bottom-1.5 left-1.5 box-border flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-[5px] font-mono text-[11px] font-semibold text-primary-foreground">{i + 1}</span>
                  <button type="button" onClick={() => rimuovi(i)} aria-label="Togli pagina" className="absolute right-1 top-1 flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[rgba(15,20,30,.6)] text-white active:scale-[0.94]"><IcoX s={16} /></button>
                  {!pdf && <button type="button" onClick={() => setRitaglio({ f: p.f, indice: i })} className="absolute bottom-1 right-1 flex h-6 items-center rounded-full bg-[rgba(15,20,30,.6)] px-[7px] text-[10px] font-medium text-white active:scale-[0.96]">Ritaglia</button>}
                </div>
              )
            })}
            <label className="flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-1 rounded-[6px] border-[1.5px] border-dashed border-[oklch(0.8_0.01_250)] text-xs font-medium text-muted-foreground active:scale-[0.98] dark:border-line-strong">
              <IcoPiu s={18} />Pagina{fileCam}
            </label>
          </div>
          <span className="text-[13px] leading-normal text-muted-foreground">Puoi mettere pagine di fatture diverse, anche di più fornitori: la lettura le separa da sola.</span>
          {errore && <p className="text-sm font-medium text-neg">{errore}</p>}
          <div className="mt-auto grid grid-cols-2 gap-2">
            <label className="flex h-12 cursor-pointer items-center justify-center rounded-[6px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">Scatta foto{fileCam}</label>
            <label className="flex h-12 cursor-pointer items-center justify-center rounded-[6px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">Da file{fileMulti}</label>
          </div>
          <button type="button" disabled={!nPag} onClick={() => elabora()}
            className="mb-[calc(env(safe-area-inset-bottom)+18px)] flex h-14 flex-none items-center justify-center rounded-[6px] bg-primary text-base font-semibold text-primary-foreground active:scale-[0.98] disabled:bg-[oklch(0.85_0.01_250)] disabled:text-[oklch(0.5_0.01_250)]">
            Elabora {nPag} {nPag === 1 ? 'pagina' : 'pagine'}
          </button>
        </div>
      )}

      {schermata === 'lettura' && lettura && <SchermoLettura l={lettura} nPag={caricati.current.length || nPag} />}

      {schermata === 'errore' && (
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-4 p-6">
          <div className="anim-swapin flex flex-col gap-3 rounded-[12px] bg-neg-tint p-3.5">
            <div className="flex items-start gap-2.5"><IcoErrore /><span className="text-sm font-medium leading-[1.45] text-neg text-pretty">{errore}</span></div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => elabora()} className="h-11 rounded-[12px] bg-primary text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.97]">Riprova</button>
              <button type="button" onClick={compilaAMano} className="h-11 rounded-[12px] border border-line-strong bg-card text-sm font-semibold transition-transform active:scale-[0.97]">Compila a mano</button>
            </div>
          </div>
          {gruppiLetti.current > 0 && lettura && (
            <span className="text-center text-xs leading-normal text-muted-foreground">
              {gruppiLetti.current === 1 ? 'Gruppo 1' : `Gruppi 1–${gruppiLetti.current}`} di {lettura.gruppi.length} {gruppiLetti.current === 1 ? 'letto e salvato' : 'letti e salvati'}. Riprova rilegge solo {gruppiLetti.current + 1 === lettura.gruppi.length ? `il gruppo ${lettura.gruppi.length}` : `i gruppi da ${gruppiLetti.current + 1}`}.
            </span>
          )}
        </div>
      )}

      {schermata === 'revisione' && cur && cur.duplicato && (
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 p-4">
          <Avanzamento n={results.length} i={idx} />
          <div className="flex flex-col gap-1.5 rounded-[8px] bg-neg-tint p-4">
            <span className="text-base font-semibold text-neg">Possibile doppione</span>
            <span className="text-sm leading-normal text-neg">Una fattura di {cur.fornitore.nome} con lo stesso numero documento è già presente{cur.fattura_esistente_data ? ` (data ${dataNumerica(cur.fattura_esistente_data)})` : ''}. Non è stata salvata.</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { h: 'GIÀ A SISTEMA', n: cur.fattura_esistente_numero, v: cur.fattura_esistente_totale, s: cur.fattura_esistente_caricata ? `caricata il ${new Date(cur.fattura_esistente_caricata).toLocaleDateString('it-IT', { day: 'numeric', month: 'numeric' })} da ${cur.fattura_esistente_da_pdf ? 'PDF' : 'foto'}` : '', b: 'border-border' },
              { h: 'APPENA LETTA', n: cur.numero_letto, v: cur.totale_letto, s: 'foto di oggi', b: 'border-[oklch(0.62_0.1_25)]' },
            ].map(d => (
              <div key={d.h} className={cn('flex flex-col gap-1 rounded-[8px] border bg-card p-3', d.b)}>
                <span className="font-mono text-[11px] font-semibold tracking-[.5px] text-muted-foreground">{d.h}</span>
                <span className="font-mono text-sm font-medium">N. {d.n ?? '—'}</span>
                <span className="font-mono text-sm font-medium">{d.v != null ? eu(d.v) : '—'}</span>
                <span className="text-xs text-muted-foreground">{d.s}</span>
              </div>
            ))}
          </div>
          {errore && <p className="text-sm font-medium text-neg">{errore}</p>}
          <div className="mb-[calc(env(safe-area-inset-bottom)+18px)] mt-auto flex flex-col gap-2">
            <button type="button" disabled={rilettura} onClick={avanti} className="flex h-[52px] items-center justify-center rounded-[6px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-50">{ultima ? 'Chiudi' : 'Fattura successiva'}</button>
            <button type="button" disabled={rilettura} onClick={sostituisciDoppione} className="flex h-12 items-center justify-center rounded-[6px] border border-line-strong text-[15px] font-medium active:scale-[0.98] disabled:opacity-50">{rilettura ? 'Rilettura…' : 'Sostituisci quella esistente'}</button>
          </div>
        </div>
      )}

      {schermata === 'revisione' && cur && !cur.duplicato && fatt && (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4 pt-3" style={{ paddingBottom: kp ? 420 : 16 }}>
            <Avanzamento n={results.length} i={idx} />
            <div className="flex flex-col gap-2.5 rounded-[8px] border border-border bg-card px-3.5 py-3">
              <label className="flex flex-col gap-1"><span className="text-xs font-medium text-muted-foreground">Fornitore</span>
                <span className={cn('relative flex h-11 items-center justify-between rounded-[6px] border px-3 text-[15px] font-medium', !fornitoreEff ? 'border-[1.5px] border-[oklch(0.62_0.1_75)]' : 'border-line-strong')}>
                  <span className="truncate">{fornitoreEff?.nome || 'Scegli il fornitore'}{!fornitoreEd && cur.fornitore.nuovo ? ' · nuovo' : ''}</span><IcoGiu className="text-muted-foreground" />
                  <select aria-label="Fornitore" value={fornitoreEff?.id ?? ''} onChange={e => { const x = fornitori.find(y => y.id === e.target.value); if (x) { setFornitoreEd({ id: x.id, nome: x.nome }); setResolved(new Map()); setRifiutati(new Set()) } }} className="absolute inset-0 opacity-0">
                    {!fornitoreEff && <option value="">Scegli il fornitore</option>}
                    {cur.fornitore.id && !fornitori.some(x => x.id === cur.fornitore.id) && <option value={cur.fornitore.id}>{cur.fornitore.nome} (nuovo)</option>}
                    {fornitori.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
                  </select>
                </span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(() => {
                  const sospData = fatt.verifiche_sospette.some(v => v.campo === 'data') || !dataEff
                  return (
                    <label className="flex flex-col gap-1"><span className={cn('text-xs', sospData ? 'font-semibold text-warn' : 'font-medium text-muted-foreground')}>Data</span>
                      <span className={cn('relative flex h-11 items-center rounded-[6px] px-3 font-mono text-[15px] font-medium', sospData ? 'border-[1.5px] border-[oklch(0.62_0.1_75)]' : 'border border-line-strong')}>
                        {dataEff ? dataNumerica(dataEff) : <span className="font-sans font-normal text-muted-foreground">Non letta</span>}
                        <input type="date" aria-label="Data" value={dataEff} onChange={e => setDataEd(e.target.value)} className="absolute inset-0 opacity-0" />
                      </span>
                    </label>
                  )
                })()}
                <label className="flex flex-col gap-1"><span className={cn('text-xs', !numEff ? 'font-semibold text-warn' : 'font-medium text-muted-foreground')}>Documento</span>
                  <input value={numEff} placeholder="Non letto" onChange={e => setNumEd(e.target.value)}
                    className={cn('box-border h-11 w-full rounded-[6px] bg-transparent px-3 font-mono text-[15px] font-medium outline-none placeholder:font-sans placeholder:font-normal placeholder:text-muted-foreground', !numEff ? 'border-[1.5px] border-[oklch(0.62_0.1_75)]' : 'border border-line-strong focus:border-[oklch(0.58_0.12_180)]')} />
                </label>
              </div>
              {fatt.verifiche_sospette.map((v, i) => (
                <div key={i} className="flex items-start gap-2 rounded-[8px] bg-warn-tint px-3 py-2.5 text-warn"><IcoAvviso /><span className="text-[13px] font-medium leading-[1.4] text-pretty">{v.messaggio}</span></div>
              ))}
              <div className="grid grid-cols-3 gap-2">
                {([['tn', 'Netto', nettoE], ['ti', 'IVA', ivaE], ['tl', 'Lordo', lordoE]] as [string, string, number][]).map(([k, l, val]) => {
                  const on = kp?.k === k && !kp.esce
                  return (
                    <div key={k} className="flex flex-col gap-1"><span className="text-xs font-medium text-muted-foreground">{l}</span>
                      <button type="button" data-kp="1" onClick={tocca(k)} className={cn('box-border flex h-10 items-center rounded-[6px] bg-card px-2.5 font-mono text-sm font-medium', on ? 'border-[1.5px] border-[oklch(0.58_0.12_180)]' : 'border border-line-strong')}>{on ? (ed[k] || ' ') : n2(val)}</button>
                    </div>
                  )
                })}
              </div>
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <div className="flex flex-col gap-1"><span className="text-xs font-medium text-muted-foreground">Vuoti ritirati <span className="font-normal">(facoltativo)</span></span>
                  <button type="button" data-kp="1" onClick={tocca('vu')} className={cn('box-border flex h-10 items-center justify-between rounded-[6px] bg-card px-2.5 font-mono text-sm font-medium', kp?.k === 'vu' && !kp.esce ? 'border-[1.5px] border-[oklch(0.58_0.12_180)] text-foreground' : 'border border-line-strong', !vuoti && kp?.k !== 'vu' && 'text-[oklch(0.6_0.01_250)]')}>
                    {kp?.k === 'vu' && !kp.esce ? (ed.vu || ' ') : vuoti ? n2(vuoti) : '0,00'}<span className="font-sans text-xs text-muted-foreground">€</span>
                  </button>
                </div>
                {!!vuoti && <div className="flex flex-col items-end gap-0.5 pb-1"><span className="text-xs text-muted-foreground">Da pagare</span><span className="font-mono text-base font-semibold">{eu(lordoE - vuoti)}</span></div>}
              </div>
              {!testataOk && (
                <span className="flex items-start gap-1.5 text-xs font-medium text-warn"><IcoAvviso />
                  {!fornitoreEff ? 'Scegli il fornitore per poter salvare.' : !dataEff && !numEff ? 'Inserisci data e numero documento per poter salvare.' : !dataEff ? 'Inserisci la data per poter salvare.' : 'Inserisci il numero documento per poter salvare.'}
                </span>
              )}
            </div>

            {serveCategoria && (
              <div className="flex flex-col gap-2 px-1"><span className="text-[15px] font-semibold">Categoria della spesa</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {categorieDirette.map(c => (
                    <button key={c.id} type="button" onClick={() => setCategoria(c.id)} className={cn('h-11 rounded-[8px] border text-sm font-medium transition-colors active:scale-[0.97]', categoria === c.id ? 'border-primary bg-primary text-primary-foreground' : 'border-line-strong bg-card')}>{c.nome}</button>
                  ))}
                </div>
              </div>
            )}

            {articoli.length > 0 && (
              <div className="flex justify-between px-1"><span className="text-[15px] font-semibold">Articoli ({articoli.length})</span><span className="text-[13px] text-muted-foreground">tocca per correggere</span></div>
            )}
            {righe.map(r => {
              const a = r.a, info = risolto(a)
              const noto = (a.esito === 'auto_mappato' || a.esito === 'chiaro') && !(fornitoreEd && fornitoreEd.id !== cur.fornitore.id)
              const st: { s: string; tono: Tono } = info ? { s: a.esito === 'auto_mappato' ? 'Già noto' : 'Abbinato', tono: 'ok' } : { s: 'Nuovo', tono: 'neu' }
              const link = noto && rifiutati.has(a.testo_estratto) ? { l: 'Ripristina abbinamento', on: () => setRifiutati(s => { const n = new Set(s); n.delete(a.testo_estratto); return n }) }
                : noto ? { l: 'Non è questo', on: () => setRifiutati(s => new Set(s).add(a.testo_estratto)) }
                : resolved.has(a.testo_estratto) ? { l: 'Non è questo', on: () => setResolved(m => { const n = new Map(m); n.delete(a.testo_estratto); return n }) }
                : a.esito === 'ambiguo' && a.candidato_nome && a.catalogo_articolo_id ? { l: 'È lo stesso', on: () => confermaStesso(a, r.p) }
                : null
              const avviso = !info && a.esito === 'ambiguo' && a.candidato_nome ? `È lo stesso di "${a.candidato_nome}"?` : info?.sospetto && !r.mod ? `⚠ ${info.sospetto.messaggio}` : null
              const campo = (k: string, l: string, v: string, u: string) => {
                const on = kp?.k === k && !kp.esce
                return (
                  <div className="flex min-w-0 flex-col gap-1"><span className="text-[11px] font-medium text-muted-foreground">{l}</span>
                    <button type="button" data-kp="1" onClick={tocca(k)} className={cn('box-border flex h-[38px] items-center justify-between gap-1 rounded-[6px] bg-card px-2.5 font-mono text-sm font-medium', on ? 'border-[1.5px] border-[oklch(0.58_0.12_180)]' : 'border border-line-strong')}>
                      <span className="truncate">{on && k[0] !== 'i' ? (ed[k] || ' ') : v}</span><span className="font-sans text-[11px] font-normal text-muted-foreground">{u}</span>
                    </button>
                  </div>
                )
              }
              return (
                <div key={`${a.testo_estratto}-${r.i}`} className="flex flex-col gap-2.5 rounded-[8px] border border-border bg-card p-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-0.5">
                    <span className="truncate text-[15px] font-medium">{a.testo_estratto}</span><span className="font-mono text-[15px] font-semibold">{eu(r.riga)}</span>
                    <div className="flex items-center gap-1.5"><Badge tono={st.tono} className="px-2 py-0.5">{st.s}</Badge><span className="text-[11px] text-muted-foreground">{r.mod ? 'corretto' : ''}</span></div>
                    {link && <button type="button" onClick={link.on} className="justify-self-end text-xs font-medium text-muted-foreground underline underline-offset-[3px]">{link.l}</button>}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {campo('q' + r.i, 'Quantità', String(Math.round(r.q * 1000) / 1000).replace('.', ','), a.unita_misura ?? 'pz')}
                    {campo('p' + r.i, 'Prezzo unitario', n2(r.p), '€')}
                    {campo('i' + r.i, 'IVA', String(r.iv).replace('.', ','), '%')}
                  </div>
                  {avviso && <span className="text-xs font-medium text-warn">{avviso}</span>}
                </div>
              )
            })}
            {errore && <p className="px-1 text-sm font-medium text-neg">{errore}</p>}
          </div>
          {kp && (
            <div data-kp="1" className="absolute inset-x-0 bottom-0 z-[60] flex justify-center border-t border-[oklch(0.88_0.01_250)] bg-[oklch(0.95_0.01_250/0.92)] pb-[calc(env(safe-area-inset-bottom)+30px)] pt-2.5 dark:border-border dark:bg-background/95">
              <div className={kp.esce ? 'anim-swapout' : 'anim-swapin'}>
                {kp.k[0] !== 'i' ? <Tastierino onKey={premi} onDone={chiudiKp} /> : (
                  <div className="flex w-[312px] flex-col gap-2 rounded-[10px] border border-line-strong bg-card p-3 shadow-[0_6px_24px_rgba(20,30,50,.10)]">
                    <span className="px-0.5 text-xs font-medium text-muted-foreground">Aliquota IVA</span>
                    <div className="grid grid-cols-5 gap-1.5">
                      {ALIQUOTE.map(v => {
                        const on = (righe[Number(kp.k.slice(1))]?.iv ?? -1) === v
                        return <button key={v} type="button" onClick={e => { e.stopPropagation(); setEd(x => ({ ...x, [kp.k]: String(v) })); chiudiKp() }} className={cn('flex h-14 items-center justify-center rounded-[6px] font-mono text-base font-semibold active:scale-[0.97]', on ? 'bg-primary text-primary-foreground' : 'bg-[oklch(0.95_0.01_250)] dark:bg-secondary')}>{v}%</button>
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="grid flex-none grid-cols-[1fr_1.6fr] gap-2 border-t border-border bg-card px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-3">
            <button type="button" onClick={annulla} disabled={salva} className="flex h-[52px] items-center justify-center rounded-[6px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">Annulla</button>
            <button type="button" onClick={conferma} disabled={!pronta || salva}
              className="flex h-[52px] items-center justify-center rounded-[6px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:bg-[oklch(0.85_0.01_250)] disabled:text-[oklch(0.5_0.01_250)]">
              {salva ? 'Salvataggio…' : ultima ? 'Salva fattura' : `Salva e vai alla ${idx + 2}`}
            </button>
          </div>
        </>
      )}
    </div>
  )

  return createPortal(
    <div className={cn('fixed inset-0 z-[75] flex justify-center', tel ? '' : 'items-start bg-[rgba(15,20,30,.28)] px-4 pb-6 pt-[60px]')}>
      <div role="dialog" aria-label={titolo}
        className={cn('anim-swapin relative flex flex-col overflow-hidden', tel ? 'h-[100dvh] w-full pt-[env(safe-area-inset-top)]' : 'h-full max-h-[900px] w-[600px] max-w-full rounded-[14px] border border-border shadow-[0_20px_60px_rgba(20,30,50,.18)]', ritaglio ? 'bg-[oklch(0.16_0.01_250)]' : 'bg-background')}>
        {corpo}
      </div>
    </div>,
    document.body,
  )
}

function Avanzamento({ n, i }: { n: number; i: number }) {
  if (n < 2) return null
  return <div className="flex flex-none gap-1">{Array.from({ length: n }, (_, k) => <div key={k} className={cn('h-[3px] flex-1 rounded-[2px]', k <= i ? 'bg-[oklch(0.58_0.12_240)]' : 'bg-border')} />)}</div>
}

function SchermoLettura({ l, nPag }: { l: Lettura; nPag: number }) {
  const passi: { t: string; s: 'ok' | 'on' | 'no' }[] = [
    { t: 'Caricamento foto', s: l.fase === 'upload' ? 'on' : 'ok' },
    ...(l.gruppi.length ? l.gruppi : [Array.from({ length: Math.max(1, nPag) }, (_, k) => k)]).map((g, k) => ({
      t: g.length === 1 ? `Lettura pagina ${g[0] + 1}` : `Lettura pagine ${g[0] + 1}–${g[g.length - 1] + 1}`,
      s: (l.fase === 'composizione' || (l.fase === 'lettura' && k < l.gruppo) ? 'ok' : l.fase === 'lettura' && k === l.gruppo ? 'on' : 'no') as 'ok' | 'on' | 'no',
    })),
    { t: 'Composizione fatture', s: l.fase === 'composizione' ? 'on' : 'no' },
  ]
  const G = Math.max(1, l.gruppi.length)
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto p-6">
      <div className="relative box-border flex h-[200px] w-[150px] flex-col gap-2 overflow-hidden rounded-[6px] border border-[oklch(0.88_0.01_250)] bg-card px-3.5 py-[18px] dark:border-border">
        <div className="h-2 w-3/5 rounded-[2px] bg-[oklch(0.85_0.01_250)]" />
        {[90, 80, 85, 70].map(w => <div key={w} className="h-[5px] rounded-[2px] bg-[oklch(0.9_0.01_250)]" style={{ width: `${w}%` }} />)}
        <div className="absolute inset-x-0 h-0.5 bg-[oklch(0.58_0.12_240)] shadow-[0_0_12px_oklch(0.58_0.12_240)] [animation:scan_1.6s_ease-in-out_infinite_alternate]" />
        <style>{'@keyframes scan{0%{top:8%}100%{top:88%}}'}</style>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-lg font-semibold">Lettura in corso</span>
        <span className="text-sm text-muted-foreground">Gruppo {Math.min(G, l.gruppo + 1)} di {G} · {nPag === 1 ? '1 pagina' : `pagine ${nPag}`}</span>
      </div>
      <div className="flex w-full max-w-[420px] flex-col gap-2">
        {passi.map(p => (
          <div key={p.t} className="flex min-h-11 items-center gap-2.5 rounded-[8px] border border-border bg-card px-3.5">
            <span className={cn('box-border flex h-5 w-5 items-center justify-center rounded-full',
              p.s === 'ok' ? 'bg-[oklch(0.55_0.1_150)]' : p.s === 'on' ? 'animate-spin border-2 border-[oklch(0.58_0.12_240)] border-t-transparent' : 'border-2 border-[oklch(0.85_0.01_250)] dark:border-line-strong')}>
              {p.s === 'ok' && <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 5.2l2 2L8 3" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </span>
            <span className={cn('flex-1 text-sm font-medium', p.s === 'no' && 'text-muted-foreground')}>{p.t}</span>
          </div>
        ))}
      </div>
      <span className="text-center text-xs leading-normal text-muted-foreground">Le pagine si leggono a gruppi di 4. Se un gruppo non riesce, quelli già letti restano salvati.</span>
    </div>
  )
}
