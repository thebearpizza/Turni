'use client'
import { useCallback, useRef, useState } from 'react'
import { Tastierino, type TastoTastierino } from '@/components/ui/tastierino'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { VerificaSospetta } from '@/types'
import { ALIQUOTE, Badge, IcoGiu, MESI_LUNGHI, Modale, dataBreve, digita, eu, n2, nf, numeroDa, useToccoFuori, type Locale, type Tono } from './comuni'
import { interpreta, leggiFile, type FatturaXml } from './fatturaXml'

// Importa XML (MTAcquisti, Acquisti cattura 11f–11g): si scelgono i file
// del mese (anche uno ZIP), si legge il tracciato, si controlla il
// riepilogo con doppioni e anomalie già segnalati, si può correggere una
// riga e poi si importa tutto insieme.

interface Esito {
  chiave: string
  fornitore: { id: string | null; nome: string; nuovo: boolean }
  duplicato: boolean
  righe: { catalogo_articolo_id: string | null; sospetto: VerificaSospetta | null }[]
  verifiche: VerificaSospetta[]
}
type Stato = 'nuova' | 'presente' | 'verifica' | 'esclusa'
const STATO: Record<Stato, { l: string; tono: Tono }> = {
  nuova: { l: 'Nuova', tono: 'ok' }, presente: { l: 'Già presente', tono: 'neu' }, verifica: { l: 'Verifica', tono: 'warn' }, esclusa: { l: 'Esclusa', tono: 'neu' },
}
const COME = [
  'Scarica dal cassetto fiscale o dal tuo intermediario i file XML del mese.',
  'Caricali tutti insieme: fornitore, articoli e IVA si leggono senza OCR.',
  'Controlli il riepilogo: doppioni e anomalie sono già segnalati.',
]

export function ImportaXml({ tel, esce, locali, localeIniziale, onChiudi, onImportate }: {
  tel: boolean; esce: boolean; locali: Locale[]; localeIniziale: string
  onChiudi: () => void; onImportate: (n: number, daVerificare: number) => void
}) {
  const [fase, setFase] = useState<'pick' | 'read' | 'sum' | 'import'>('pick')
  const [li, setLi] = useState(localeIniziale)
  const [nFile, setNFile] = useState(0)
  const [fatture, setFatture] = useState<FatturaXml[]>([])
  const [esiti, setEsiti] = useState<Map<string, Esito>>(new Map())
  const [aperta, setAperta] = useState<string | null>(null)
  const [edit, setEdit] = useState<[string, number] | null>(null)
  const [kp, setKp] = useState<{ c: [string, number, 'q' | 'p']; v: string; esce: boolean } | null>(null)
  const [modificate, setModificate] = useState<Set<string>>(new Set())
  const [progresso, setProgresso] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  async function anteprima(fs: FatturaXml[], crea: boolean) {
    const res = await fetch('/api/acquisti/xml', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurant_id: li, crea_fornitori: crea, fatture: fs.map(f => ({ chiave: f.chiave, piva: f.piva, fornitore: f.fornitore, numero: f.numero, righe: f.righe.map(r => ({ descrizione: r.descrizione, prezzo_unitario: r.prezzoUnitario })) })) }),
    })
    const d = await res.json().catch(() => null)
    if (!res.ok || !d?.fatture) throw new Error(d?.error ?? `Errore ${res.status}`)
    return new Map((d.fatture as Esito[]).map(e => [e.chiave, e]))
  }

  async function scelti(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    setFase('read')
    try {
      const lette = (await Promise.all(files.map(leggiFile))).flat()
      const fs = lette.flatMap(x => interpreta(x.xml, x.nome))
      if (!fs.length) throw new Error('Nessuna fattura elettronica trovata nei file scelti')
      setNFile(lette.length)
      setFatture(fs)
      setEsiti(await anteprima(fs, false))
      setFase('sum')
    } catch (err) {
      toast({ title: `Lettura non riuscita: ${err instanceof Error ? err.message : 'errore'}`, variant: 'destructive' })
      setFase('pick')
    }
  }

  const stato = (f: FatturaXml): Stato => {
    if (f.tipo === 'TD04' || !f.righe.some(r => r.prezzoTotale > 0) || !f.numero || !f.data) return 'esclusa'
    const e = esiti.get(f.chiave)
    if (e?.duplicato) return 'presente'
    return e?.verifiche.length ? 'verifica' : 'nuova'
  }
  const lordoDi = (f: FatturaXml) => {
    if (!modificate.has(f.chiave) && f.totaleDocumento != null) return f.totaleDocumento
    return riepilogo(f).reduce((t, r) => t + r.imponibile + r.imposta, 0)
  }
  const riepilogo = (f: FatturaXml) => {
    if (!modificate.has(f.chiave) && f.riepilogo.length) return f.riepilogo
    const m = new Map<number, number>()
    f.righe.forEach(r => m.set(r.aliquota, (m.get(r.aliquota) ?? 0) + r.prezzoTotale))
    return [...m].sort((a, b) => a[0] - b[0]).map(([aliquota, imponibile]) => ({ aliquota, imponibile, imposta: Math.round(imponibile * aliquota) / 100 }))
  }
  const nota = (f: FatturaXml): string | null => {
    if (f.tipo === 'TD04') return 'nota di credito: non importata'
    const e = esiti.get(f.chiave)
    const s = e?.righe.find(r => r.sospetto)?.sospetto
    if (s) { const i = e!.righe.findIndex(r => r.sospetto), m = s.messaggio.match(/\(([+−-]?\d+)%/); return `prezzo ${f.righe[i]?.descrizione.split(' ')[0].toLowerCase() ?? ''} ${m ? (m[1].startsWith('-') ? m[1] : '+' + m[1]) + '%' : 'fuori norma'}` }
    if (e && !e.duplicato && e.fornitore.nuovo) return 'fornitore nuovo'
    return null
  }

  const importabili = fatture.filter(f => stato(f) === 'nuova' || stato(f) === 'verifica')
  const nPres = fatture.filter(f => stato(f) === 'presente').length
  const nVer = fatture.filter(f => stato(f) === 'verifica').length

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
    if (!importabili.length) return
    setFase('import'); setProgresso(0)
    let ok = 0, dv = 0
    try {
      const risolti = await anteprima(importabili, true)
      for (const f of importabili) {
        const e = risolti.get(f.chiave)
        if (!e?.fornitore.id || e.duplicato) continue
        const rie = riepilogo(f)
        const imp = rie.reduce((t, r) => t + r.imponibile, 0), iva = rie.reduce((t, r) => t + r.imposta, 0)
        const righe = f.righe.map((r, i) => ({ r, i })).filter(x => x.r.prezzoTotale > 0)
        const somma = righe.reduce((t, x) => t + x.r.prezzoTotale, 0)
        // Sconti e righe a zero non diventano articoli di catalogo: il
        // totale giusto resta quello del documento.
        const scavalco = Math.abs(somma - imp) > 0.02
        const res = await fetch('/api/cassa/fatture/salva', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            restaurant_id: li, foto_paths: [],
            fornitore: { id: e.fornitore.id, nome: e.fornitore.nome, partita_iva: f.piva },
            numero_documento: f.numero, data: f.data, ha_articoli: true, categoria_spesa_diretta_id: null,
            iva_dettaglio: rie.map(r => ({ aliquota: r.aliquota, imponibile: r.imponibile, iva: r.imposta })),
            totale_netto_manuale: scavalco ? Math.round(imp * 100) / 100 : null,
            totale_lordo_manuale: scavalco ? Math.round((f.totaleDocumento ?? imp + iva) * 100) / 100 : null,
            vuoti_ritirati: null,
            articoli: righe.map(({ r, i }) => {
              const base = { testo_estratto: r.descrizione, quantita: r.quantita, prezzo_riga: r.prezzoTotale, pagina_indice: 0, riquadro: null, aliquota_iva: r.aliquota }
              const id = e.righe[i]?.catalogo_articolo_id
              return id ? { ...base, catalogo_articolo_id: id } : { ...base, nuovo_articolo: { nome_articolo: r.descrizione, tipologia: 'food', unita_misura: r.unita?.toLowerCase() || undefined } }
            }),
            verifiche_sospette: e.verifiche,
          }),
        })
        if (res.ok) { ok++; if (e.verifiche.length) dv++ }
        setProgresso(p => p + 1)
      }
    } catch (err) {
      toast({ title: `Importazione interrotta: ${err instanceof Error ? err.message : 'errore'}`, variant: 'destructive' })
    }
    if (ok < importabili.length) toast({ title: `${importabili.length - ok} ${importabili.length - ok === 1 ? 'fattura non importata' : 'fatture non importate'}: riprova`, variant: 'destructive' })
    if (ok) onImportate(ok, dv)
    else setFase('sum')
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
          {locali.length > 1 && (
            <div className="flex flex-col gap-2"><span className="text-[13px] font-medium">Locale</span>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${tel ? 2 : 4},1fr)` }}>
                {locali.map(l => (
                  <button key={l.id} type="button" onClick={() => setLi(l.id)} className={cn('flex h-11 items-center justify-center gap-2 rounded-[8px] border text-sm font-medium transition-colors active:scale-[0.97]', l.id === li ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-card dark:border-line-strong')}>
                    <span className="h-2 w-2 rounded-full" style={{ background: l.id === li ? '#fff' : l.colore }} /><span className="truncate">{l.nome}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
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
          <div className="grid grid-cols-3 gap-2">
            {[{ v: fatture.length, l: 'Trovate', c: '' }, { v: nPres, l: 'Già presenti', c: 'text-muted-foreground' }, { v: nVer, l: 'Da verificare', c: 'text-warn' }].map(k => (
              <div key={k.l} className="flex flex-col gap-0.5 rounded-[8px] border border-border px-3 py-2.5"><span className={cn('font-mono text-[22px] font-semibold', k.c)}>{k.v}</span><span className="text-xs text-muted-foreground">{k.l}</span></div>
            ))}
          </div>
          <div className="flex flex-col overflow-hidden rounded-[8px] border border-border">
            <div className="flex justify-between border-b border-border px-3.5 py-2.5"><span className="text-[15px] font-semibold">Fatture trovate</span><span className="font-mono text-[13px] font-medium text-muted-foreground">{eu(fatture.reduce((t, f) => t + lordoDi(f), 0), 0)}</span></div>
            {fatture.map(f => {
              const st = stato(f), open = aperta === f.chiave, n = nota(f), rie = riepilogo(f)
              const e = esiti.get(f.chiave)
              return (
                <div key={f.chiave} className={cn('border-b border-[oklch(0.93_0.01_250)] last:border-b-0 dark:border-border', st === 'verifica' && 'bg-[oklch(0.985_0.01_75)] dark:bg-warn-tint/30')}>
                  <button type="button" onClick={() => { chiudiKp(); setEdit(null); setAperta(open ? null : f.chiave) }}
                    className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto_18px] items-center gap-x-2.5 gap-y-0.5 px-3.5 py-2.5 text-left active:scale-[0.99]', (st === 'presente' || st === 'esclusa') && 'opacity-55')}>
                    <span className="truncate text-sm font-medium">{e?.fornitore.nome ?? f.fornitore}</span>
                    <span className="text-right font-mono text-sm font-medium">{eu(lordoDi(f))}</span>
                    <span className="col-start-3 row-span-2 row-start-1 flex items-center justify-center text-muted-foreground"><IcoGiu className="transition-transform duration-300" style={{ transform: `rotate(${open ? 180 : 0}deg)` }} /></span>
                    <span className="truncate text-xs text-muted-foreground">N. {f.numero} · {f.data ? dataBreve(f.data) : '—'}{n ? ` · ${n}` : ''}</span>
                    <span className="justify-self-end"><Badge tono={STATO[st].tono} className="px-2 py-0.5">{STATO[st].l}</Badge></span>
                  </button>
                  {open && (
                    <div className="anim-swapin flex flex-col gap-2 px-3.5 pb-3">
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
                                <span className="truncate font-sans">{r.descrizione}</span><span className="text-right">{nf(r.quantita)}</span>
                                <span className={cn('text-right', rincaro && 'text-neg')}>{n2(r.prezzoUnitario)}</span><span className="text-right text-muted-foreground">{nf(r.aliquota)}%</span>
                                <span className="text-right font-medium">{n2(r.prezzoTotale)}</span>
                              </button>
                              {ed && (
                                <div data-xkf="1" className="anim-swapin flex flex-col gap-2.5 px-2.5 pb-3 pt-0.5">
                                  <span className="break-words text-sm font-semibold text-pretty">{r.descrizione}</span>
                                  <div className="grid grid-cols-2 gap-2">{campo('q', 'Quantità', nf(r.quantita))}{campo('p', 'Prezzo unitario', n2(r.prezzoUnitario))}</div>
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
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-[1fr_1.6fr] gap-2.5">
            <button type="button" onClick={onChiudi} disabled={fase === 'import'} className="flex h-[52px] items-center justify-center rounded-[8px] border border-line-strong text-[15px] font-medium active:scale-[0.98] disabled:opacity-50">Annulla</button>
            <button type="button" onClick={importa} disabled={!importabili.length || fase === 'import'} className="flex h-[52px] items-center justify-center rounded-[8px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-50">
              {fase === 'import' ? `Importazione ${Math.min(progresso + 1, importabili.length)} di ${importabili.length}…` : `Importa ${importabili.length} ${importabili.length === 1 ? 'fattura' : 'fatture'}`}
            </button>
          </div>
          {(nPres > 0 || nVer > 0) && (
            <span className="text-center text-xs text-muted-foreground">
              {nPres > 0 && `${nPres === 1 ? 'Quella già presente viene saltata' : `Le ${nPres} già presenti vengono saltate`}. `}
              {nVer > 0 && `${nVer === 1 ? 'Quella da verificare entra' : `Le ${nVer} da verificare entrano`} con il badge "Da verificare".`}
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
