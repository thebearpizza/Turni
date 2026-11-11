// Lettura delle fatture elettroniche (FatturaPA) nel browser: file .xml,
// firmati .xml.p7m e archivi .zip con tutto il mese. Fornitore, righe e
// riepilogo IVA si leggono dal tracciato, senza OCR.

export interface RigaXml { descrizione: string; quantita: number; unita: string | null; prezzoUnitario: number; prezzoTotale: number; aliquota: number }
export interface FatturaXml {
  chiave: string
  file: string
  tipo: string
  piva: string | null
  fornitore: string
  numero: string
  data: string
  totaleDocumento: number | null
  righe: RigaXml[]
  riepilogo: { aliquota: number; imponibile: number; imposta: number }[]
  scadenza: string | null
  pagamento: string | null
  /** CodiceDestinatario SDI (maiuscolo; null se assente o "0000000"). */
  destinatario: string | null
  pec: string | null
  /** Testi dove può comparire il locale: servono allo smistamento. */
  indizi: Indizio[]
}

/** Dove si è trovato un testo utile a capire il locale della fattura. */
export type FonteIndizio = 'destinazione' | 'sede' | 'causale' | 'riferimenti' | 'righe'
export interface Indizio { fonte: FonteIndizio; testo: string }
export const FONTE_INDIZIO: Record<FonteIndizio, string> = {
  destinazione: 'nella destinazione', sede: 'nella sede del cliente', causale: 'nella causale', riferimenti: 'nei riferimenti', righe: 'nelle righe',
}

const MODALITA: Record<string, string> = {
  MP01: 'Contanti', MP02: 'Assegno', MP05: 'Bonifico', MP08: 'Carta', MP09: 'RID', MP10: 'RID', MP11: 'RID', MP12: 'RiBa', MP19: 'SEPA DD', MP20: 'SEPA DD', MP21: 'SEPA DD', MP23: 'PagoPA',
}

// ── ZIP (lettore minimo: metodo 0 e deflate, via DecompressionStream) ──
async function inflate(dati: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw')
  const out = new Blob([dati as BlobPart]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

async function leggiZip(buf: Uint8Array): Promise<{ nome: string; dati: Uint8Array }[]> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('Archivio ZIP non leggibile')
  const n = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const out: { nome: string; dati: Uint8Array }[] = []
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const metodo = dv.getUint16(p + 10, true), comp = dv.getUint32(p + 20, true)
    const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true)
    const nome = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + ln))
    p += 46 + ln + le + lc
    if (nome.endsWith('/')) continue
    const inizio = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true)
    const grezzo = buf.subarray(inizio, inizio + comp)
    if (metodo === 0) out.push({ nome, dati: grezzo })
    else if (metodo === 8) out.push({ nome, dati: await inflate(grezzo) })
  }
  return out
}

// ── P7M: il tracciato XML è dentro la busta CMS; si ritaglia fra il primo
// tag e la chiusura di FatturaElettronica, togliendo se serve le
// intestazioni dei blocchi DER che spezzano il contenuto. ──
function daP7m(buf: Uint8Array): string | null {
  const bin = Array.from(buf, c => String.fromCharCode(c)).join('')
  const fine = bin.search(/<\/([A-Za-z0-9_]+:)?FatturaElettronica>/)
  if (fine < 0) return null
  const chiusura = bin.slice(fine).match(/^<\/([A-Za-z0-9_]+:)?FatturaElettronica>/)![0]
  let inizio = bin.indexOf('<?xml')
  if (inizio < 0 || inizio > fine) inizio = bin.search(/<([A-Za-z0-9_]+:)?FatturaElettronica[\s>]/)
  if (inizio < 0) return null
  const pezzo = buf.subarray(inizio, fine + chiusura.length)
  const testo = new TextDecoder('utf-8').decode(pezzo)
  if (valido(testo)) return testo
  // Blocchi di OCTET STRING a lunghezza indefinita: 0x04 0x81 n / 0x04 0x82 nn.
  const pulito: number[] = []
  for (let i = 0; i < pezzo.length; i++) {
    if (pezzo[i] === 0x04 && (pezzo[i + 1] === 0x82) && i > 0) { i += 3; continue }
    if (pezzo[i] === 0x04 && (pezzo[i + 1] === 0x81) && i > 0) { i += 2; continue }
    pulito.push(pezzo[i])
  }
  const t2 = new TextDecoder('utf-8').decode(new Uint8Array(pulito))
  return valido(t2) ? t2 : null
}
const valido = (s: string) => !new DOMParser().parseFromString(s, 'application/xml').getElementsByTagName('parsererror').length

export async function leggiFile(f: File): Promise<{ nome: string; xml: string }[]> {
  const buf = new Uint8Array(await f.arrayBuffer())
  const n = f.name.toLowerCase()
  if (n.endsWith('.zip')) {
    const voci = await leggiZip(buf)
    const out: { nome: string; xml: string }[] = []
    for (const v of voci) {
      const nv = v.nome.toLowerCase()
      if (nv.endsWith('.zip')) out.push(...await leggiFile(new File([v.dati as BlobPart], v.nome)))
      else if (nv.endsWith('.p7m')) { const x = daP7m(v.dati); if (x) out.push({ nome: v.nome, xml: x }) }
      else if (nv.endsWith('.xml')) out.push({ nome: v.nome, xml: new TextDecoder('utf-8').decode(v.dati) })
    }
    return out
  }
  if (n.endsWith('.p7m')) { const x = daP7m(buf); return x ? [{ nome: f.name, xml: x }] : [] }
  return [{ nome: f.name, xml: new TextDecoder('utf-8').decode(buf) }]
}

// ── Tracciato ──
const figli = (el: Element | null | undefined, nome: string) => (el ? Array.from(el.children).filter(c => c.localName === nome) : [])
function giu(el: Element | null | undefined, ...percorso: string[]): Element | null {
  let cur: Element | null = el ?? null
  for (const p of percorso) { cur = figli(cur, p)[0] ?? null; if (!cur) return null }
  return cur
}
const testo = (el: Element | null | undefined, ...p: string[]) => giu(el, ...p)?.textContent?.trim() ?? null
const numero = (s: string | null) => { const v = s == null ? NaN : parseFloat(s); return Number.isFinite(v) ? v : null }

/** Indirizzo in una riga (Indirizzo, civico, CAP, comune, provincia). */
const indirizzo = (el: Element | null) => (el ? ['Indirizzo', 'NumeroCivico', 'CAP', 'Comune', 'Provincia'].map(k => testo(el, k)).filter(Boolean).join(' ') : '')

/** Toglie vuoti e doppioni (stessa fonte e stesso testo). */
function unici(xs: Indizio[]): Indizio[] {
  const visti = new Set<string>()
  return xs.map(x => ({ fonte: x.fonte, testo: x.testo.replace(/\s+/g, ' ').trim() }))
    .filter(x => x.testo && !visti.has(x.fonte + '|' + x.testo.toLowerCase()) && visti.add(x.fonte + '|' + x.testo.toLowerCase()))
}

export function interpreta(xml: string, file: string): FatturaXml[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return []
  const radice = doc.documentElement
  if (radice.localName !== 'FatturaElettronica') return []
  const ced = giu(radice, 'FatturaElettronicaHeader', 'CedentePrestatore', 'DatiAnagrafici')
  const piva = testo(ced, 'IdFiscaleIVA', 'IdCodice')
  const anag = giu(ced, 'Anagrafica')
  const fornitore = testo(anag, 'Denominazione') ?? [testo(anag, 'Nome'), testo(anag, 'Cognome')].filter(Boolean).join(' ')
  // Destinatario e testi dell'intestazione comuni a tutti i corpi del file.
  const intest = giu(radice, 'FatturaElettronicaHeader')
  const trasm = giu(intest, 'DatiTrasmissione')
  const cod = testo(trasm, 'CodiceDestinatario')?.toUpperCase() ?? null
  const destinatario = cod && !/^0+$/.test(cod) ? cod : null
  const pec = testo(trasm, 'PECDestinatario')?.toLowerCase() ?? null
  const cess = giu(intest, 'CessionarioCommittente')
  const indiziTestata: Indizio[] = [
    ...[giu(cess, 'Sede'), giu(cess, 'StabileOrganizzazione')].map(x => ({ fonte: 'sede' as const, testo: indirizzo(x) })),
    { fonte: 'riferimenti', testo: testo(intest, 'CedentePrestatore', 'RiferimentoAmministrazione') ?? '' },
  ]
  return figli(radice, 'FatturaElettronicaBody').map((b, k) => {
    const g = giu(b, 'DatiGenerali', 'DatiGeneraliDocumento')
    const beni = giu(b, 'DatiBeniServizi')
    const righe: RigaXml[] = figli(beni, 'DettaglioLinee').map(l => {
      const q = numero(testo(l, 'Quantita')) ?? 1
      const tot = numero(testo(l, 'PrezzoTotale')) ?? 0
      return { descrizione: (testo(l, 'Descrizione') ?? '').replace(/\s+/g, ' ').trim(), quantita: q, unita: testo(l, 'UnitaMisura'), prezzoUnitario: numero(testo(l, 'PrezzoUnitario')) ?? (q ? tot / q : tot), prezzoTotale: tot, aliquota: numero(testo(l, 'AliquotaIVA')) ?? 0 }
    })
    const dg = giu(b, 'DatiGenerali')
    const linee = figli(beni, 'DettaglioLinee')
    const indizi: Indizio[] = [
      ...figli(dg, 'DatiTrasporto').map(t => ({ fonte: 'destinazione' as const, testo: indirizzo(giu(t, 'IndirizzoResa')) })),
      ...indiziTestata,
      ...figli(g, 'Causale').map(c => ({ fonte: 'causale' as const, testo: c.textContent ?? '' })),
      ...['DatiOrdineAcquisto', 'DatiContratto', 'DatiConvenzione', 'DatiRicezione'].flatMap(k => figli(dg, k)).flatMap(d => [testo(d, 'IdDocumento'), testo(d, 'CodiceCommessaConvenzione')])
        .map(t => ({ fonte: 'riferimenti' as const, testo: t ?? '' })),
      ...linee.map(l => ({ fonte: 'riferimenti' as const, testo: testo(l, 'RiferimentoAmministrazione') ?? '' })),
      ...linee.flatMap(l => [testo(l, 'Descrizione'), ...figli(l, 'AltriDatiGestionali').map(a => testo(a, 'RiferimentoTesto'))])
        .map(t => ({ fonte: 'righe' as const, testo: t ?? '' })),
    ]
    const pag = giu(b, 'DatiPagamento', 'DettaglioPagamento')
    const mp = testo(pag, 'ModalitaPagamento')
    return {
      chiave: `${file}#${k}`, file,
      tipo: testo(g, 'TipoDocumento') ?? 'TD01',
      piva, fornitore: fornitore || 'Fornitore senza nome',
      numero: testo(g, 'Numero') ?? '',
      data: (testo(g, 'Data') ?? '').slice(0, 10),
      totaleDocumento: numero(testo(g, 'ImportoTotaleDocumento')),
      righe,
      riepilogo: figli(beni, 'DatiRiepilogo').map(r => ({ aliquota: numero(testo(r, 'AliquotaIVA')) ?? 0, imponibile: numero(testo(r, 'ImponibileImporto')) ?? 0, imposta: numero(testo(r, 'Imposta')) ?? 0 })),
      scadenza: testo(pag, 'DataScadenzaPagamento'),
      pagamento: mp ? MODALITA[mp] ?? mp : null,
      destinatario, pec,
      indizi: unici(indizi),
    }
  })
}
