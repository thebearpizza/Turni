'use client'
import { useCallback, useRef, useState } from 'react'
import { Tastierino, type TastoTastierino } from '@/components/ui/tastierino'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { ArticoloTipologia } from '@/types'
import { ALIQUOTE, Badge, IcoGiu, MESI_LUNGHI, Modale, TIPOLOGIE, dataBreve, digita, eu, n2, nf, numeroDa, useToccoFuori, type Locale, type Tono } from './comuni'
import { interpreta, leggiFile, type FatturaXml } from './fatturaXml'
import { anteprimaXml, importaXml, lordoXml, mettiInAttesa, riepilogoXml, smistaXml, type EsitoXml, type Smistamento } from './xmlImport'
import { BadgeIa, GrigliaLocali, SceltaTipologia } from './Smistamento'

// Importa XML (MTAcquisti, Acquisti cattura 11f–11g): si scelgono i file
// del mese (anche uno ZIP), si legge il tracciato, si controlla il
// riepilogo con doppioni e anomalie già segnalati, si può correggere una
// riga e poi si importa tutto insieme.
//
// Il locale non si sceglie prima: ogni fattura viene smistata da sola
// (codice destinatario, riferimenti nei testi, IA solo se sicura; vedi
// /api/acquisti/xml/smista) e nel riepilogo si può cambiare. Quelle di
// cui non si capisce il locale vanno nella coda "Da assegnare" di
// Fatture. Il file XML di ogni fattura si conserva nello storage.

type Stato = 'nuova' | 'presente' | 'verifica' | 'esclusa' | 'assegnare'
const STATO: Record<Stato, { l: string; tono: Tono }> = {
  nuova: { l: 'Nuova', tono: 'ok' }, presente: { l: 'Già presente', tono: 'neu' }, verifica: { l: 'Verifica', tono: 'warn' }, esclusa: { l: 'Esclusa', tono: 'neu' }, assegnare: { l: 'Da assegnare', tono: 'warn' },
}
const COME = [
  'Scarica dal cassetto fiscale o dal tuo intermediario i file XML del mese.',
  'Caricali tutti insieme: fornitore, articoli e IVA si leggono senza OCR.',
  'Controlli il riepilogo: locale, doppioni e anomalie sono già segnalati.',
]

export function ImportaXml({ tel, esce, locali, onChiudi, onImportate }: {
  tel: boolean; esce: boolean; locali: Locale[]
  onChiudi: () => void
  /** chiudi = false se restano fatture nel riepilogo (es. coda non disponibile). */
  onImportate: (n: number, daVerificare: number, inAttesa: number, chiudi: boolean) => void
}) {
  const [fase, setFase] = useState<'pick' | 'read' | 'sum' | 'import'>('pick')
  const [nFile, setNFile] = useState(0)
  const [fatture, setFatture] = useState<FatturaXml[]>([])
  const [testi, setTesti] = useState<Map<string, string>>(new Map())
  const [esiti, setEsiti] = useState<Map<string, EsitoXml>>(new Map())
  const [smist, setSmist] = useState<Map<string, Smistamento>>(new Map())
  const [tipScelte, setTipScelte] = useState<Map<string, ArticoloTipologia>>(new Map())
  const [aperta, setAperta] = useState<string | null>(null)
  const [edit, setEdit] = useState<[string, number] | null>(null)
  const [kp, setKp] = useState<{ c: [string, number, 'q' | 'p']; v: string; esce: boolean } | null>(null)
  const [modificate, setModificate] = useState<Set<string>>(new Set())
  const [progresso, setProgresso] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const single = locali.length <= 1
  const tutti = locali.map(l => l.id)

  async function scelti(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    setFase('read')
    try {
      const lette = (await Promise.all(files.map(leggiFile))).flat()
      const fs = lette.flatMap(x => interpreta(x.xml, x.nome))
      if (!fs.length) throw new Error('Nessuna fattura elettronica trovata nei file scelti')
      // Con un solo locale non c'è niente da smistare.
      const smistamento = single
        ? Promise.resolve(new Map(fs.map(f => [f.chiave, { restaurant_id: locali[0]?.id ?? null, via: 'unico' as const, motivo: 'Unico locale', candidati: tutti }])))
        : smistaXml(fs).catch(err => {
          toast({ title: `Smistamento automatico non riuscito: ${err instanceof Error ? err.message : 'errore'}. Scegli il locale nel riepilogo.`, variant: 'destructive' })
          return new Map(fs.map(f => [f.chiave, { restaurant_id: null, via: null, motivo: 'Smistamento automatico non riuscito', candidati: tutti } as Smistamento]))
        })
      const [sm, es] = await Promise.all([smistamento, anteprimaXml(fs.map(f => ({ f, restaurantId: single ? locali[0]?.id ?? null : null })), false, true)])
      setNFile(lette.length)
      setFatture(fs)
      setTesti(new Map(lette.map(x => [x.nome, x.xml])))
      setSmist(sm)
      setEsiti(es)
      setFase('sum')
    } catch (err) {
      toast({ title: `Lettura non riuscita: ${err instanceof Error ? err.message : 'errore'}`, variant: 'destructive' })
      setFase('pick')
    }
  }

  // Una fattura da foto sostituita dall'XML resta nel locale dov'era.
  const localeDi = (f: FatturaXml) => esiti.get(f.chiave)?.sostituisce?.restaurant_id ?? smist.get(f.chiave)?.restaurant_id ?? null
  const stato = (f: FatturaXml): Stato => {
    if (f.tipo === 'TD04' || !f.righe.some(r => r.prezzoTotale > 0) || !f.numero || !f.data) return 'esclusa'
    const e = esiti.get(f.chiave)
    if (e?.duplicato) return 'presente'
    if (!localeDi(f)) return 'assegnare'
    return e?.verifiche.length ? 'verifica' : 'nuova'
  }
  const lordoDi = (f: FatturaXml) => lordoXml(f, modificate.has(f.chiave))
  const riepilogo = (f: FatturaXml) => riepilogoXml(f, modificate.has(f.chiave))
  const scegliLocale = (f: FatturaXml, id: string | null) => setSmist(m => {
    const n = new Map(m), v = m.get(f.chiave)
    n.set(f.chiave, { restaurant_id: id, via: id ? 'mano' : null, motivo: id ? 'Scelto a mano' : 'Da assegnare: lo sceglierai in Fatture', candidati: v?.candidati.length ? v.candidati : tutti })
    return n
  })
  // "Tutte in un locale": quando i file arrivano dall'account di un solo
  // locale (es. Crunch Teglia, stesso codice SDI degli altri) l'origine è
  // certa e lo smistamento automatico non serve. Ogni riga resta
  // modificabile anche dopo.
  const assegnabili = fatture.filter(f => { const st = stato(f); return st !== 'presente' && st !== 'esclusa' })
  const tutteIn = assegnabili.length > 0 && assegnabili.every(f => smist.get(f.chiave)?.via === 'mano' && localeDi(f) === localeDi(assegnabili[0])) ? localeDi(assegnabili[0]) : null
  const assegnaTutte = (id: string | null) => setSmist(m => {
    const n = new Map(m)
    for (const f of assegnabili) n.set(f.chiave, { restaurant_id: id, via: id ? 'mano' : null, motivo: id ? 'Scelto a mano per tutte' : 'Da assegnare: lo sceglierai in Fatture', candidati: m.get(f.chiave)?.candidati.length ? m.get(f.chiave)!.candidati : tutti })
    return n
  })
  // Righe senza articolo a catalogo: tipologia proposta dall'IA (o scelta qui).
  const nuovoArticolo = (f: FatturaXml, i: number) => { const e = esiti.get(f.chiave); return !!e && !e.duplicato && (f.righe[i]?.prezzoTotale ?? 0) > 0 && !e.righe[i]?.catalogo_articolo_id }
  const tipologiaDi = (f: FatturaXml, i: number): ArticoloTipologia => tipScelte.get(`${f.chiave}|${i}`) ?? esiti.get(f.chiave)?.righe[i]?.tipologia_proposta ?? 'food'
  const tipologieDi = (f: FatturaXml) => new Map(f.righe.flatMap((_, i) => (nuovoArticolo(f, i) ? [[i, tipologiaDi(f, i)] as [number, ArticoloTipologia]] : [])))
  const nota = (f: FatturaXml): string | null => {
    if (f.tipo === 'TD04') return 'nota di credito: non importata'
    const e = esiti.get(f.chiave)
    if (e?.sostituisce) return 'sostituisce la fattura da foto'
    const s = e?.righe.find(r => r.sospetto)?.sospetto
    if (s) { const i = e!.righe.findIndex(r => r.sospetto), m = s.messaggio.match(/\(([+−-]?\d+)%/); return `prezzo ${f.righe[i]?.descrizione.split(' ')[0].toLowerCase() ?? ''} ${m ? (m[1].startsWith('-') ? m[1] : '+' + m[1]) + '%' : 'fuori norma'}` }
    if (e && !e.duplicato && e.fornitore.nuovo) return 'fornitore nuovo'
    return null
  }

  const importabili = fatture.filter(f => stato(f) === 'nuova' || stato(f) === 'verifica')
  const daAssegnare = fatture.filter(f => stato(f) === 'assegnare')
  const nPres = fatture.filter(f => stato(f) === 'presente').length
  const nVer = fatture.filter(f => stato(f) === 'verifica').length
  const nTot = importabili.length + daAssegnare.length

  // ── Tastierino delle righe ───────────────────────────────────────────
  const chiudiKp = useCallback(() => {
    setKp(k => (k && !k.esce ? { ...k, esce: true } : k))
    setTimeout(() => setKp(k => (k?.esce ? null : k)), 320)
  }, [])
  useToccoFuori(!!kp && !kp.esce, '[data-xkk],[data-xkf]', chiudiKp)
  const correggi = (chiave: string, i: number, p: Partial<{ quantita: number; prezzoUnitario: number; aliquota: number }>) => {
    setFatture(fs => fs.map(f => f.chiave !== chiave ? f : { ...f, righe: f.righe.map((r, j) => {
      if (j !== i) return r
      const n = { ...r, ...p }
      return { ...n, prezzoTotale: Math.round(n.quantita * n.prezzoUnitario * 100) / 100 }
    }) }))
    setModificate(s => new Set(s).add(chiave))
  }
  const fatto = () => {
    if (kp && kp.v !== '') { const v = numeroDa(kp.v); if (v !== null && v >= 0) correggi(kp.c[0], kp.c[1], kp.c[2] === 'q' ? { quantita: v } : { prezzoUnitario: v }) }
    chiudiKp()
  }

  async function importa() {
    if (!nTot) return
    setFase('import'); setProgresso(0)
    const fatte = new Set<string>()
    let ok = 0, dv = 0, attesa = 0, giaInCoda = 0, codaMancante = false
    const errori: string[] = []
    try {
      if (importabili.length) {
        const r = await importaXml(importabili.map(f => ({ f, restaurantId: localeDi(f)!, modificata: modificate.has(f.chiave), xml: testi.get(f.file) ?? null, tipologie: tipologieDi(f) })), () => setProgresso(p => p + 1))
        r.ok.forEach(k => fatte.add(k)); ok = r.ok.length; dv = r.dv; errori.push(...r.errori)
        if (r.fileNonConservati) toast({ title: `${r.fileNonConservati} ${r.fileNonConservati === 1 ? 'file XML non conservato' : 'file XML non conservati'}: le fatture sono comunque importate`, variant: 'destructive' })
      }
      for (const f of daAssegnare) {
        if (codaMancante) break
        const s = smist.get(f.chiave)
        const r = await mettiInAttesa({ f, xml: testi.get(f.file) ?? null, modificata: modificate.has(f.chiave), candidati: s?.candidati.length ? s.candidati : tutti, motivo: s?.motivo ?? 'Da assegnare', tipologie: tipologieDi(f) })
        if (r.ok) { attesa++; fatte.add(f.chiave) }
        else if (r.giaInAttesa) { giaInCoda++; fatte.add(f.chiave) }
        else if (r.mancante) codaMancante = true
        else errori.push(`${f.fornitore} n. ${f.numero}: ${r.errore ?? 'non messa in attesa'}`)
        setProgresso(p => p + 1)
      }
    } catch (err) {
      toast({ title: `Importazione interrotta: ${err instanceof Error ? err.message : 'errore'}`, variant: 'destructive' })
    }
    if (codaMancante) toast({ title: 'La coda "Da assegnare" non è ancora attiva: scegli il locale delle fatture rimaste e importale', variant: 'destructive' })
    if (errori.length) toast({ title: `${errori.length} ${errori.length === 1 ? 'fattura non importata' : 'fatture non importate'}: riprova`, description: errori.slice(0, 3).join(' · '), variant: 'destructive' })
    if (giaInCoda) toast({ title: `${giaInCoda} ${giaInCoda === 1 ? 'fattura era già' : 'fatture erano già'} in Da assegnare` })
    const restano = fatture.filter(f => !fatte.has(f.chiave) && (stato(f) === 'nuova' || stato(f) === 'verifica' || stato(f) === 'assegnare'))
    if (ok || attesa) onImportate(ok, dv, attesa, !restano.length)
    if (restano.length) { setFatture(fs => fs.filter(f => !fatte.has(f.chiave))); setAperta(null); setFase('sum') }
    else if (!ok && !attesa) setFase('sum')
  }

  // Mese prevalente per il sottotitolo del riepilogo.
  const mesi = new Map<string, number>()
  fatture.forEach(f => mesi.set(f.data.slice(0, 7), (mesi.get(f.data.slice(0, 7)) ?? 0) + 1))
  const mese = [...mesi].sort((a, b) => b[1] - a[1])[0]?.[0]
  const sotto = fase === 'sum' || fase === 'import' ? `${mese ? `${MESI_LUNGHI[Number(mese.slice(5)) - 1]} ${mese.slice(0, 4)}` : ''} · ${nFile} ${nFile === 1 ? 'file' : 'file'}` : 'Fatture elettroniche'
  const px = tel ? 'px-4' : 'px-[22px]'

  return (
    <Modale tel={tel} esce={esce} onChiudi={onChiudi} titolo="Importa XML" sotto={sotto}>
      {(fase === 'pick' || fase === 'read') && (
        <div className={cn('flex flex-col gap-3.5 py-4', px)}>
          <div className="flex h-[150px] flex-none flex-col items-center justify-center gap-1.5 rounded-[8px] border-[1.5px] border-dashed border-[oklch(0.8_0.01_250)] dark:border-line-strong">
            <span className="text-base font-semibold">{fase === 'read' ? 'Lettura dei file…' : 'Seleziona i file XML'}</span>
            <span className="text-[13px] text-muted-foreground">anche uno ZIP con tutto il mese</span>
            <button type="button" disabled={fase === 'read'} onClick={() => input.current?.click()} className="mt-1.5 flex h-11 items-center rounded-[8px] bg-primary px-[18px] text-sm font-semibold text-primary-foreground active:scale-[0.97] disabled:opacity-50">{fase === 'read' ? 'Lettura…' : 'Scegli file'}</button>
            <input ref={input} type="file" multiple accept=".xml,.p7m,.zip,application/xml,text/xml,application/zip" className="sr-only" onChange={scelti} />
          </div>
          <div className="flex flex-col gap-2"><span className="text-[15px] font-semibold">Come funziona</span>
            {COME.map((t, i) => (
              <div key={i} className="flex gap-2.5 text-sm leading-[1.45] text-[oklch(0.35_0.01_250)] dark:text-foreground/80">
                <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-[oklch(0.93_0.01_250)] font-mono text-[11px] font-semibold dark:bg-secondary">{i + 1}</span>{t}
              </div>
            ))}
          </div>
        </div>
      )}
      {(fase === 'sum' || fase === 'import') && (
        <div className={cn('flex flex-col gap-3 py-4', px)}>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${single ? 3 : tel ? 2 : 4},1fr)` }}>
            {[{ v: fatture.length, l: 'Trovate', c: '' }, { v: nPres, l: 'Già presenti', c: 'text-muted-foreground' }, { v: nVer, l: 'Da verificare', c: 'text-warn' }, ...(single ? [] : [{ v: daAssegnare.length, l: 'Da assegnare', c: 'text-warn' }])].map(k => (
              <div key={k.l} className="flex flex-col gap-0.5 rounded-[8px] border border-border px-3 py-2.5"><span className={cn('font-mono text-[22px] font-semibold', k.c)}>{k.v}</span><span className="text-xs text-muted-foreground">{k.l}</span></div>
            ))}
          </div>
          {!single && assegnabili.length > 1 && fase === 'sum' && (
            <div className="flex flex-col gap-1.5 rounded-[8px] border border-border px-3.5 py-2.5">
              <span className="text-[15px] font-semibold">Tutte di un solo locale?</span>
              <span className="text-xs text-muted-foreground">Se i file vengono dall&apos;account di un locale, sceglilo qui: vale per tutte le fatture, poi puoi cambiare le singole.</span>
              <GrigliaLocali tel={tel} locali={locali} scelto={tutteIn} onScegli={assegnaTutte} />
            </div>
          )}
          <div className="flex flex-col overflow-hidden rounded-[8px] border border-border">
            <div className="flex justify-between border-b border-border px-3.5 py-2.5"><span className="text-[15px] font-semibold">Fatture trovate</span><span className="font-mono text-[13px] font-medium text-muted-foreground">{eu(fatture.reduce((t, f) => t + lordoDi(f), 0), 0)}</span></div>
            {fatture.map(f => {
              const st = stato(f), open = aperta === f.chiave, n = nota(f), rie = riepilogo(f)
              const e = esiti.get(f.chiave), sm = smist.get(f.chiave), lo = locali.find(l => l.id === sm?.restaurant_id)
              const conLocale = !single && st !== 'presente' && st !== 'esclusa'
              const nNuovi = f.righe.filter((_, i) => nuovoArticolo(f, i)).length
              return (
                <div key={f.chiave} className={cn('border-b border-[oklch(0.93_0.01_250)] last:border-b-0 dark:border-border', (st === 'verifica' || st === 'assegnare') && 'bg-[oklch(0.985_0.01_75)] dark:bg-warn-tint/30')}>
                  <button type="button" onClick={() => { chiudiKp(); setEdit(null); setAperta(open ? null : f.chiave) }}
                    className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto_18px] items-center gap-x-2.5 gap-y-0.5 px-3.5 py-2.5 text-left active:scale-[0.99]', (st === 'presente' || st === 'esclusa') && 'opacity-55')}>
                    <span className="truncate text-sm font-medium">{e?.fornitore.nome ?? f.fornitore}</span>
                    <span className="text-right font-mono text-sm font-medium">{eu(lordoDi(f))}</span>
                    <span className="col-start-3 row-span-2 row-start-1 flex items-center justify-center text-muted-foreground"><IcoGiu className="transition-transform duration-300" style={{ transform: `rotate(${open ? 180 : 0}deg)` }} /></span>
                    <span className="truncate text-xs text-muted-foreground">
                      {conLocale && (lo ? <><span className="mr-1 inline-block h-2 w-2 rounded-full align-[0px]" style={{ background: lo.colore }} />{lo.nome} · </> : null)}
                      N. {f.numero} · {f.data ? dataBreve(f.data) : '—'}{n ? ` · ${n}` : ''}
                    </span>
                    <span className="flex items-center gap-1 justify-self-end">
                      {conLocale && sm?.via === 'ia' && <BadgeIa />}
                      <Badge tono={STATO[st].tono} className="px-2 py-0.5">{STATO[st].l}</Badge>
                    </span>
                  </button>
                  {open && (
                    <div className="anim-swapin flex flex-col gap-2 px-3.5 pb-3">
                      {conLocale && (
                        <div className="flex flex-col gap-1.5 pb-1">
                          <div className="flex min-w-0 items-baseline gap-1.5 text-xs">
                            <span className="flex-none font-semibold">Locale</span>
                            <span className={cn('min-w-0 text-pretty', sm?.via === 'ia' || !lo ? 'font-medium text-warn' : 'text-muted-foreground')}>
                              {sm?.via === 'ia' ? `${sm.motivo} · controlla` : lo ? sm?.motivo ?? '' : `${sm?.motivo ?? 'Nessun indizio'}: scegli il locale o lasciala in Da assegnare`}
                            </span>
                          </div>
                          <GrigliaLocali tel={tel} locali={locali} scelto={sm?.restaurant_id ?? null} onScegli={id => scegliLocale(f, id)} azzerabile />
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-1.5 text-[11px] text-muted-foreground">
                        <span>P.IVA {f.piva ?? '—'}</span><span>{f.scadenza ? `Scad. ${dataBreve(f.scadenza)}` : ''}</span><span className="text-right">{f.pagamento ?? ''}</span>
                      </div>
                      <div className="overflow-hidden rounded-[8px] border border-border bg-card">
                        <div className="grid grid-cols-[minmax(0,1fr)_44px_64px_40px_70px] gap-1.5 bg-[oklch(0.95_0.01_250)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[.04em] text-muted-foreground dark:bg-secondary">
                          <span>Prodotto</span><span className="text-right">Q.tà</span><span className="text-right">Prezzo</span><span className="text-right">IVA</span><span className="text-right">Totale</span>
                        </div>
                        {f.righe.map((r, i) => {
                          const ed = edit?.[0] === f.chiave && edit[1] === i
                          const rincaro = !!e?.righe[i]?.sospetto
                          const campo = (c: 'q' | 'p', l: string, v: string) => {
                            const on = kp && !kp.esce && kp.c[0] === f.chiave && kp.c[1] === i && kp.c[2] === c
                            return (
                              <div className="flex flex-col gap-[5px]"><span className="text-xs font-medium text-muted-foreground">{l}</span>
                                <button type="button" data-xkf={on ? 'on' : 'off'} onClick={() => setKp({ c: [f.chiave, i, c], v: '', esce: false })}
                                  className={cn('box-border flex h-12 items-center justify-end rounded-[6px] bg-white px-3 font-mono text-[17px] font-medium dark:bg-card', on ? 'border-[1.5px] border-[oklch(0.58_0.12_180)]' : 'border border-line-strong')}>
                                  {on && kp.v !== '' ? kp.v : v}
                                </button>
                              </div>
                            )
                          }
                          return (
                            <div key={i} className={cn('border-t border-[oklch(0.93_0.01_250)] dark:border-border', ed && 'bg-background')}>
                              <button type="button" onClick={() => { chiudiKp(); setEdit(ed ? null : [f.chiave, i]) }} className="grid w-full grid-cols-[minmax(0,1fr)_44px_64px_40px_70px] items-baseline gap-1.5 px-2.5 py-[9px] text-left font-mono text-xs">
                                <span className="flex min-w-0 items-baseline gap-1.5 font-sans"><span className="truncate">{r.descrizione}</span>{nuovoArticolo(f, i) && <span className="flex-none text-[10px] font-semibold uppercase tracking-[.04em] text-warn">{TIPOLOGIE[tipologiaDi(f, i)].l}</span>}</span><span className="text-right">{nf(r.quantita)}</span>
                                <span className={cn('text-right', rincaro && 'text-neg')}>{n2(r.prezzoUnitario)}</span><span className="text-right text-muted-foreground">{nf(r.aliquota)}%</span>
                                <span className="text-right font-medium">{n2(r.prezzoTotale)}</span>
                              </button>
                              {ed && (
                                <div data-xkf="1" className="anim-swapin flex flex-col gap-2.5 px-2.5 pb-3 pt-0.5">
                                  <span className="break-words text-sm font-semibold text-pretty">{r.descrizione}</span>
                                  <div className="grid grid-cols-2 gap-2">{campo('q', 'Quantità', nf(r.quantita))}{campo('p', 'Prezzo unitario', n2(r.prezzoUnitario))}</div>
                                  {nuovoArticolo(f, i) && (
                                    <div className="flex flex-col gap-[5px]"><span className="text-xs font-medium text-muted-foreground">Tipologia dell&apos;articolo nuovo · proposta dall&apos;IA, da controllare</span>
                                      <SceltaTipologia valore={tipologiaDi(f, i)} onScegli={t => setTipScelte(m => new Map(m).set(`${f.chiave}|${i}`, t))} />
                                    </div>
                                  )}
                                  <div className="flex flex-col gap-[5px]"><span className="text-xs font-medium text-muted-foreground">Aliquota IVA</span>
                                    <div className="grid grid-cols-5 gap-1.5">
                                      {ALIQUOTE.map(v => (
                                        <button key={v} type="button" onClick={() => correggi(f.chiave, i, { aliquota: v })} className={cn('flex h-10 items-center justify-center rounded-[8px] border font-mono text-[13px] font-medium transition-colors active:scale-[0.97]', r.aliquota === v ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-white dark:border-line-strong dark:bg-card')}>{v}%</button>
                                      ))}
                                    </div>
                                  </div>
                                  {!tel && kp && kp.c[0] === f.chiave && kp.c[1] === i && (
                                    <div data-xkk="1" className={cn('flex justify-center', kp.esce ? 'anim-swapout' : 'anim-swapin')}>
                                      <Tastierino onKey={(k: TastoTastierino) => setKp(p => (p ? { ...p, v: digita(p.v, k, p.c[2] === 'q' ? 3 : 2) } : p))} onDone={fatto} />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      <div className="ml-auto flex w-[240px] max-w-full flex-col gap-[3px] font-mono text-xs text-muted-foreground">
                        <div className="flex justify-between"><span>Imponibile</span><span>{eu(rie.reduce((t, r) => t + r.imponibile, 0))}</span></div>
                        {rie.map(r => <div key={r.aliquota} className="flex justify-between"><span>IVA {nf(r.aliquota)}% su {eu(r.imponibile)}</span><span>{eu(r.imposta)}</span></div>)}
                        <div className="mt-0.5 flex justify-between border-t border-border pt-1 font-semibold text-foreground"><span>Totale lordo</span><span>{eu(lordoDi(f))}</span></div>
                      </div>
                      {n && st !== 'presente' && <span className="text-xs font-medium text-warn">⚠ {n}</span>}
                      {nNuovi > 0 && <span className="text-xs text-muted-foreground">{nNuovi === 1 ? '1 articolo nuovo' : `${nNuovi} articoli nuovi`}: tipologia proposta dall&apos;IA, da controllare in Articoli. Tocca una riga per cambiarla.</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-[1fr_1.6fr] gap-2.5">
            <button type="button" onClick={onChiudi} disabled={fase === 'import'} className="flex h-[52px] items-center justify-center rounded-[8px] border border-line-strong text-[15px] font-medium active:scale-[0.98] disabled:opacity-50">Annulla</button>
            <button type="button" onClick={importa} disabled={!nTot || fase === 'import'} className="flex h-[52px] items-center justify-center rounded-[8px] bg-primary px-2 text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-50">
              {fase === 'import' ? `Importazione ${Math.min(progresso + 1, nTot)} di ${nTot}…`
                : importabili.length ? `Importa ${importabili.length} ${importabili.length === 1 ? 'fattura' : 'fatture'}${daAssegnare.length ? ` · ${daAssegnare.length} in attesa` : ''}`
                : `Metti in attesa ${daAssegnare.length} ${daAssegnare.length === 1 ? 'fattura' : 'fatture'}`}
            </button>
          </div>
          {(nPres > 0 || nVer > 0 || daAssegnare.length > 0) && (
            <span className="text-center text-xs text-muted-foreground">
              {nPres > 0 && `${nPres === 1 ? 'Quella già presente viene saltata' : `Le ${nPres} già presenti vengono saltate`}. `}
              {nVer > 0 && `${nVer === 1 ? 'Quella da verificare entra' : `Le ${nVer} da verificare entrano`} con il badge "Da verificare". `}
              {daAssegnare.length > 0 && `${daAssegnare.length === 1 ? 'Quella da assegnare aspetta' : `Le ${daAssegnare.length} da assegnare aspettano`} in Fatture › Da assegnare finché non scegli il locale.`}
            </span>
          )}
          {tel && kp && (
            <div data-xkk="1" className={cn('sticky bottom-0 z-[5] -mx-4 mt-auto flex justify-center border-t border-border bg-[oklch(0.95_0.01_250/0.95)] py-2.5 dark:bg-background/95', kp.esce ? 'anim-swapout' : 'anim-swapin')}>
              <Tastierino onKey={(k: TastoTastierino) => setKp(p => (p ? { ...p, v: digita(p.v, k, p.c[2] === 'q' ? 3 : 2) } : p))} onDone={fatto} />
            </div>
          )}
        </div>
      )}
    </Modale>
  )
}
