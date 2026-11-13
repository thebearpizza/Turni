import { createClient } from '@/lib/supabase/client'
import type { ArticoloTipologia, VerificaSospetta } from '@/types'
import type { FatturaXml } from './fatturaXml'

// Passi dell'import XML condivisi fra il foglio "Importa XML" e la coda
// "Da assegnare" di Fatture: anteprima (fornitore, doppioni, catalogo),
// conservazione del file XML e salvataggio con la route di sempre.

export const BUCKET_XML = 'fatture_xml'

export interface EsitoXml {
  chiave: string
  fornitore: { id: string | null; nome: string; nuovo: boolean }
  duplicato: boolean
  /** Stessa fattura già caricata da foto: l'XML la sostituisce (righe, totali, IVA) e le foto si eliminano. */
  sostituisce?: { id: string; restaurant_id: string; foto_paths: string[] } | null
  righe: { catalogo_articolo_id: string | null; sospetto: VerificaSospetta | null; tipologia_proposta?: ArticoloTipologia | null }[]
  verifiche: VerificaSospetta[]
}

/** Esito dello smistamento per locale (vedi /api/acquisti/xml/smista). */
export type ViaSmistamento = 'unico' | 'codice' | 'riferimento' | 'ia' | 'mano' | null
export interface Smistamento { restaurant_id: string | null; via: ViaSmistamento; motivo: string; candidati: string[] }

// Blocchi da 40 fatture per richiesta: uno ZIP di un mese in un'unica
// richiesta superava il limite di tempo del server e falliva. In anteprima
// i blocchi vanno 3 alla volta; con la creazione dei fornitori uno dopo
// l'altro, perché lo stesso fornitore nuovo non venga creato due volte.
const BLOCCO = 40
async function anteprimaBlocco(fs: { f: FatturaXml; restaurantId: string | null }[], crea: boolean, proponi: boolean): Promise<EsitoXml[]> {
  const res = await fetch('/api/acquisti/xml', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      crea_fornitori: crea, proponi_tipologie: proponi,
      fatture: fs.map(({ f, restaurantId }) => ({ chiave: f.chiave, restaurant_id: restaurantId, piva: f.piva, fornitore: f.fornitore, numero: f.numero, righe: f.righe.map(r => ({ descrizione: r.descrizione, prezzo_unitario: r.prezzoUnitario })) })),
    }),
  })
  const d = await res.json().catch(() => null)
  if (!res.ok || !d?.fatture) throw new Error(d?.error ?? (res.status === 504 ? 'il server ha impiegato troppo, riprova' : `Errore ${res.status}`))
  return d.fatture as EsitoXml[]
}

export async function anteprimaXml(fs: { f: FatturaXml; restaurantId: string | null }[], crea: boolean, proponi = false): Promise<Map<string, EsitoXml>> {
  const blocchi = Array.from({ length: Math.ceil(fs.length / BLOCCO) }, (_, i) => fs.slice(i * BLOCCO, i * BLOCCO + BLOCCO))
  const out: EsitoXml[] = []
  if (crea) {
    for (const b of blocchi) out.push(...await anteprimaBlocco(b, true, false))
  } else {
    for (let i = 0; i < blocchi.length; i += 3) out.push(...(await Promise.all(blocchi.slice(i, i + 3).map(b => anteprimaBlocco(b, false, proponi)))).flat())
  }
  return new Map(out.map(e => [e.chiave, e]))
}

export async function smistaXml(fs: FatturaXml[]): Promise<Map<string, Smistamento>> {
  const res = await fetch('/api/acquisti/xml/smista', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fatture: fs.map(f => ({ chiave: f.chiave, destinatario: f.destinatario, pec: f.pec, fornitore: f.fornitore, indizi: f.indizi })) }),
  })
  const d = await res.json().catch(() => null)
  if (!res.ok || !Array.isArray(d?.fatture)) throw new Error(d?.error ?? `Errore ${res.status}`)
  return new Map((d.fatture as ({ chiave: string } & Smistamento)[]).filter(Boolean).map(e => [e.chiave, { restaurant_id: e.restaurant_id, via: e.via, motivo: e.motivo, candidati: e.candidati ?? [] }]))
}

/** Riepilogo IVA: quello del documento, o ricalcolato se le righe sono state corrette. */
export function riepilogoXml(f: FatturaXml, modificata: boolean) {
  if (!modificata && f.riepilogo.length) return f.riepilogo
  const m = new Map<number, number>()
  f.righe.forEach(r => m.set(r.aliquota, (m.get(r.aliquota) ?? 0) + r.prezzoTotale))
  return [...m].sort((a, b) => a[0] - b[0]).map(([aliquota, imponibile]) => ({ aliquota, imponibile, imposta: Math.round(imponibile * aliquota) / 100 }))
}
export function lordoXml(f: FatturaXml, modificata: boolean) {
  if (!modificata && f.totaleDocumento != null) return f.totaleDocumento
  return riepilogoXml(f, modificata).reduce((t, r) => t + r.imponibile + r.imposta, 0)
}

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
/** Bucket assente (migrazione non applicata): si importa senza conservare il file. */
export const bucketMancante = (m?: string) => /bucket not found/i.test(m ?? '')

/**
 * Carica il testo XML nel bucket privato (cartella del locale o "coda").
 * null se non riesce: l'import prosegue comunque, senza file collegato.
 */
export async function conservaXml(cartella: string, testo: string): Promise<{ path: string | null; errore: string | null }> {
  const path = `${cartella}/${uuid()}.xml`
  const { error } = await createClient().storage.from(BUCKET_XML).upload(path, new Blob([testo], { type: 'application/xml' }), { contentType: 'application/xml', upsert: false })
  if (error) return { path: null, errore: bucketMancante(error.message) ? null : error.message }
  return { path, errore: null }
}

export interface DaImportare {
  f: FatturaXml
  restaurantId: string
  modificata: boolean
  /** Testo XML da conservare ora, oppure percorso già nello storage. */
  xml?: string | null
  xmlPath?: string | null
  /** Tipologia scelta/proposta per le righe senza articolo (indice riga). */
  tipologie?: Map<number, ArticoloTipologia>
}

/**
 * Registra i fornitori mancanti e salva ogni fattura con
 * /api/cassa/fatture/salva. Gli articoli nuovi prendono la tipologia
 * proposta dall'IA (o scelta in revisione) e nascono "da controllare".
 */
export async function importaXml(items: DaImportare[], avanzamento?: () => void): Promise<{ ok: string[]; dv: number; errori: string[]; fileNonConservati: number }> {
  const risolti = await anteprimaXml(items.map(x => ({ f: x.f, restaurantId: x.restaurantId })), true)
  const ok: string[] = [], errori: string[] = []
  let dv = 0, fileNonConservati = 0
  // Fornitori diversi si salvano in parallelo (4 alla volta); le fatture
  // dello stesso fornitore in fila, perché un articolo nuovo comune a più
  // fatture va creato una volta sola nel catalogo.
  const code = new Map<string, DaImportare[]>()
  for (const x of items) { const k = risolti.get(x.f.chiave)?.fornitore.id ?? `?${x.f.chiave}`; code.set(k, [...(code.get(k) ?? []), x]) }
  const salvaUna = async (x: DaImportare) => {
    const { f } = x
    const e = risolti.get(f.chiave)
    if (!e?.fornitore.id || e.duplicato) { errori.push(e?.duplicato ? `${f.fornitore} n. ${f.numero}: già presente` : `${f.fornitore}: fornitore non registrato`); avanzamento?.(); return }
    const sost = e.sostituisce ?? null
    const restaurantId = sost?.restaurant_id ?? x.restaurantId
    let xmlPath = x.xmlPath ?? null, caricato = false
    if (!xmlPath && x.xml) {
      const c = await conservaXml(restaurantId, x.xml)
      xmlPath = c.path; caricato = !!c.path
      if (c.errore) fileNonConservati++
    }
    const rie = riepilogoXml(f, x.modificata)
    const imp = rie.reduce((t, r) => t + r.imponibile, 0), iva = rie.reduce((t, r) => t + r.imposta, 0)
    const righe = f.righe.map((r, i) => ({ r, i })).filter(y => y.r.prezzoTotale > 0)
    const somma = righe.reduce((t, y) => t + y.r.prezzoTotale, 0)
    // Sconti e righe a zero non diventano articoli di catalogo: il
    // totale giusto resta quello del documento.
    const scavalco = Math.abs(somma - imp) > 0.02
    const res = await fetch(sost ? '/api/cassa/fatture/sostituisci' : '/api/cassa/fatture/salva', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(sost ? { fattura_id: sost.id, da_xml: true } : {}),
        restaurant_id: restaurantId, foto_paths: [], xml_path: xmlPath,
        fornitore: { id: e.fornitore.id, nome: e.fornitore.nome, partita_iva: f.piva },
        numero_documento: f.numero, data: f.data, ha_articoli: true, categoria_spesa_diretta_id: null,
        iva_dettaglio: rie.map(r => ({ aliquota: r.aliquota, imponibile: r.imponibile, iva: r.imposta })),
        totale_netto_manuale: scavalco ? Math.round(imp * 100) / 100 : null,
        totale_lordo_manuale: scavalco ? Math.round((f.totaleDocumento ?? imp + iva) * 100) / 100 : null,
        vuoti_ritirati: null,
        articoli: righe.map(({ r, i }) => {
          const base = { testo_estratto: r.descrizione, quantita: r.quantita, prezzo_riga: r.prezzoTotale, pagina_indice: 0, riquadro: null, aliquota_iva: r.aliquota }
          const id = e.righe[i]?.catalogo_articolo_id
          if (id) return { ...base, catalogo_articolo_id: id }
          const tipologia = x.tipologie?.get(i) ?? 'food'
          return { ...base, nuovo_articolo: { nome_articolo: r.descrizione, tipologia, unita_misura: r.unita?.toLowerCase() || undefined, da_controllare: true } }
        }),
        verifiche_sospette: e.verifiche,
      }),
    })
    if (res.ok) {
      ok.push(f.chiave); if (e.verifiche.length) dv++
      if (sost?.foto_paths.length) createClient().storage.from('fatture_foto').remove(sost.foto_paths).then(() => {}, () => {})
    }
    else {
      errori.push(`${f.fornitore} n. ${f.numero}: ${(await res.json().catch(() => null))?.error ?? `errore ${res.status}`}`)
      if (caricato && xmlPath) createClient().storage.from(BUCKET_XML).remove([xmlPath]).then(() => {}, () => {})
    }
    avanzamento?.()
  }
  const liste = [...code.values()]
  let prossima = 0
  await Promise.all(Array.from({ length: Math.min(4, liste.length) }, async () => {
    while (prossima < liste.length) { const l = liste[prossima++]; for (const x of l) await salvaUna(x) }
  }))
  return { ok, dv, errori, fileNonConservati }
}

/** Voce della coda "Da assegnare" come la legge Fatture. */
export interface InAttesa {
  id: string
  restaurant_ids: string[]
  fornitore: string
  numero_documento: string
  data: string
  totale: number | null
  motivo: string | null
  file_nome: string | null
  xml_path: string | null
  dati: FatturaXml & { modificata?: boolean; tipologie?: Record<string, ArticoloTipologia> }
}

/** Tabella della coda assente (migrazione non applicata). */
export const tabellaMancante = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /does not exist|could not find the table/i.test(e.message ?? ''))

/** Mette in coda una fattura senza locale, con il suo XML. */
export async function mettiInAttesa(x: { f: FatturaXml; xml: string | null; modificata: boolean; candidati: string[]; motivo: string; tipologie?: Map<number, ArticoloTipologia> }): Promise<{ ok: boolean; giaInAttesa?: boolean; mancante?: boolean; errore?: string }> {
  const sb = createClient()
  const { data: { user } } = await sb.auth.getUser()
  const c = x.xml ? await conservaXml('coda', x.xml) : { path: null, errore: null }
  const { error } = await sb.from('fatture_xml_in_attesa').insert({
    restaurant_ids: x.candidati, fornitore: x.f.fornitore, partita_iva: x.f.piva, numero_documento: x.f.numero, data: x.f.data,
    totale: Math.round(lordoXml(x.f, x.modificata) * 100) / 100, motivo: x.motivo, file_nome: x.f.file, xml_path: c.path,
    dati: { ...x.f, modificata: x.modificata, tipologie: x.tipologie ? Object.fromEntries(x.tipologie) : {} },
    created_by: user?.id,
  })
  if (error) {
    if (c.path) sb.storage.from(BUCKET_XML).remove([c.path]).then(() => {}, () => {})
    if (error.code === '23505') return { ok: false, giaInAttesa: true }
    return { ok: false, mancante: tabellaMancante(error), errore: error.message }
  }
  return { ok: true }
}
