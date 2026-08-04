'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/compressImage'
import { DocumentScanner } from '@/components/cassa/DocumentScanner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Camera, Upload, X, Loader2, AlertTriangle, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ArticoloTipologia, VerificaSospetta } from '@/types'

const TIPOLOGIA_LABELS: Record<ArticoloTipologia, string> = {
  food: 'Food',
  beverage: 'Beverage',
  detergenza: 'Detergenza',
  altro_no_food: 'Altro no-food',
}

interface AliquotaEstratta {
  aliquota: number
  imponibile: number
  iva: number
}

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
}

interface EstraiResponse {
  duplicato: boolean
  fattura_esistente_id?: string
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
}

interface DatiNuovoArticolo {
  nome_articolo: string
  tipologia: ArticoloTipologia
  unita_misura?: string
}

export interface FatturaRisolta {
  foto_paths: string[]
  fornitore: { id: string; nome: string; partita_iva: string | null }
  data: string
  numero_documento: string
  ha_articoli: boolean
  categoria_spesa_diretta_id: string | null
  iva_dettaglio: AliquotaEstratta[]
  totale_netto: number
  totale_iva: number
  totale_lordo: number
  // Un articolo 'nuovo' mai confermato esplicitamente (non più
  // obbligatorio) arriva con nuovo_articolo invece di
  // catalogo_articolo_id: il chiamante crea la riga di catalogo al
  // momento del salvataggio, non prima.
  articoli: Array<
    { testo_estratto: string; quantita: number; prezzo_riga: number } & (
      | { catalogo_articolo_id: string; nuovo_articolo?: undefined }
      | { catalogo_articolo_id?: undefined; nuovo_articolo: DatiNuovoArticolo }
    )
  >
  // Tutti i campi segnalati come sospetti (Task 2) — fattura + articoli —
  // da mostrare in sola lettura nella conferma finale (Task 3) e salvare
  // così com'è su fatture.verifiche_sospette, senza ricalcolarli.
  verifiche_sospette: VerificaSospetta[]
}

interface Props {
  restaurantId: string
  categorieDirette: Array<{ id: string; nome: string }>
  // 'scan' = fotocamera + ritaglio prospettico (DocumentScanner), per un
  // documento cartaceo davanti all'utente. 'file' = selezione diretta da
  // file/galleria, multipla: si presume già un'immagine del documento
  // (foto precedente, scansione, screenshot), quindi salta il ritaglio.
  initialMode: 'file' | 'scan'
  // Chiamato una volta per OGNI fattura confermata dall'utente (un
  // caricamento può contenerne più di una — vedi results/currentIndex
  // sotto). Deve lanciare in caso di errore: FatturaCapture resta sulla
  // fattura corrente e mostra l'errore invece di considerarla comunque
  // conclusa e passare oltre.
  onComplete: (fattura: FatturaRisolta) => Promise<void>
  // Chiamato una sola volta, quando TUTTE le fatture del batch sono
  // state salvate (o, per un doppione, riconosciute come tali).
  onFinished: () => void
  onCancel: () => void
}

// Cattura multi-pagina + pipeline di estrazione/matching (Task 1). Non
// salva la fattura — restituisce i dati risolti a onComplete perché il
// chiamante (Task 3) la persista dopo la conferma finale dell'utente.
// Un caricamento può contenere più fatture distinte insieme (anche di
// fornitori diversi): l'estrazione le separa già, qui si rivedono e
// salvano una alla volta con uno stepper "Fattura N di M".
export function FatturaCapture({ restaurantId, categorieDirette, initialMode, onComplete, onFinished, onCancel }: Props) {
  const [pages, setPages] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [status, setStatus] = useState<'capturing' | 'processing' | 'review'>('capturing')
  // Solo per il messaggio mostrato durante 'processing' — il caricamento
  // foto è rapido, la lettura AI no, distinguerli evita che un'attesa
  // lunga sembri bloccata sul passo sbagliato.
  const [faseElaborazione, setFaseElaborazione] = useState<'upload' | 'lettura'>('upload')
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<EstraiResponse[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const current = results[currentIndex] as EstraiResponse | undefined
  const [resolved, setResolved] = useState<Map<string, { catalogoArticoloId: string; sospetto: VerificaSospetta | null }>>(new Map())
  // Articoli 'nuovo' (o 'ambiguo' risolto come nuovo) con dati modificati
  // dall'utente tramite "Modifica" — chiave testo_estratto. La riga di
  // catalogo non si crea qui: solo al salvataggio della fattura (vedi
  // handleConferma), altrimenti annullare lascerebbe un articolo orfano.
  const [nuoviModificati, setNuoviModificati] = useState<Map<string, DatiNuovoArticolo>>(new Map())
  // Prezzo riga corretto a mano in revisione — a differenza di
  // resolved/nuoviModificati va tenuto per indice, non per
  // testo_estratto: due righe con lo stesso testo estratto (raro ma
  // possibile) non devono correggersi a vicenda.
  const [prezziModificati, setPrezziModificati] = useState<Map<number, number>>(new Map())
  const [confirmingIndex, setConfirmingIndex] = useState<number | null>(null)
  const [categoriaDiretta, setCategoriaDiretta] = useState('')
  // Salvataggio (o presa visione di un doppione) della fattura corrente
  // in corso — passa da una richiesta di rete, senza questo stato il
  // tasto "Salva fattura" non darebbe nessun segnale durante l'attesa.
  const [saving, setSaving] = useState(false)
  // Foto appena scattata, in attesa del ritaglio prospettico: finché è
  // valorizzata lo scanner prende il posto della griglia delle pagine.
  const [daRitagliare, setDaRitagliare] = useState<File | null>(null)

  async function handleAddPage(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    e.target.value = ''
    if (initialMode === 'scan') {
      setDaRitagliare(files[0])
      return
    }
    // Da file: niente ritaglio prospettico, si accodano direttamente
    // (in sequenza, non in parallelo, per mantenere l'ordine di
    // selezione anche se la compressione impiega tempi diversi).
    for (const file of files) await aggiungiPagina(file)
  }

  async function aggiungiPagina(file: File) {
    setDaRitagliare(null)
    // Larghezza/qualità molto più alte del default (800/0.7): l'OCR deve
    // leggere numeri e testo piccoli su una fattura, non solo riconoscere
    // un volto come nel fallback timbrature. Stesso limite di
    // MAX_LATO_LAVORO/warpProspettiva — coerente sia che la pagina sia
    // passata dallo scanner sia che l'utente scelga la foto originale.
    // I PDF non passano da qui: compressImage lavora su un <canvas>,
    // inapplicabile a un file che non è un'immagine.
    let compressed = file
    if (file.type.startsWith('image/')) {
      try { compressed = await compressImage(file, 2200, 0.9) } catch { /* usa l'originale */ }
    }
    setPages(prev => [...prev, compressed])
    setPreviews(prev => [...prev, URL.createObjectURL(compressed)])
  }

  function removePage(i: number) {
    setPages(prev => prev.filter((_, idx) => idx !== i))
    setPreviews(prev => {
      URL.revokeObjectURL(prev[i])
      return prev.filter((_, idx) => idx !== i)
    })
  }

  async function handleElabora() {
    setStatus('processing')
    setFaseElaborazione('upload')
    setError(null)

    // Le foto le carica il client direttamente sullo storage, non la API
    // route: il corpo di una richiesta a una funzione serverless Vercel
    // è limitato a 4.5 MB, e con più pagine ad alta risoluzione (l'OCR
    // deve leggere testo piccolo) si supera facilmente — il rifiuto a
    // livello di piattaforma arriva al browser come connessione
    // interrotta, non come un errore applicativo pulito. Qui invece la
    // route riceve solo i percorsi, un payload minuscolo qualunque sia
    // la dimensione delle foto.
    const supabase = createClient()
    const fotoPaths: string[] = []
    try {
      for (let i = 0; i < pages.length; i++) {
        const ext = pages[i].name.split('.').pop() ?? 'jpg'
        const path = `${restaurantId}/${Date.now()}-${i}.${ext}`
        const { error: uploadErr } = await supabase.storage.from('fatture_foto').upload(path, pages[i], {
          contentType: pages[i].type || 'image/jpeg',
          upsert: false,
        })
        if (uploadErr) throw uploadErr
        fotoPaths.push(path)
      }
    } catch (err) {
      if (fotoPaths.length > 0) await supabase.storage.from('fatture_foto').remove(fotoPaths)
      setError(err instanceof Error ? `Errore nel caricamento delle foto: ${err.message}` : 'Errore nel caricamento delle foto')
      setStatus('capturing')
      return
    }

    setFaseElaborazione('lettura')
    try {
      const res = await fetch('/api/cassa/fatture/estrai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId, foto_paths: fotoPaths }),
      })

      // Una funzione terminata dalla piattaforma (timeout) risponde con
      // una pagina di errore, non con JSON: senza questa guardia il
      // res.json() esplode e l'utente vede un generico "Errore di rete"
      // che non dice nulla su cosa è andato storto davvero.
      const data = await res.json().catch(() => null)

      if (!res.ok || !data) {
        setError(
          data?.error ??
          (res.status === 504
            ? 'La lettura ha superato il tempo massimo. Riprova con meno pagine per volta, oppure compila i dati a mano.'
            : `Errore nella lettura della fattura (codice ${res.status}). Riprova o compila i dati a mano.`)
        )
        setStatus('capturing')
        return
      }

      setResults(data.fatture ?? [])
      setCurrentIndex(0)
      setStatus('review')
    } catch {
      setError('Errore di rete, riprova')
      setStatus('capturing')
    }
  }

  // Solo per la decisione 'stesso': l'id catalogo è già noto (il
  // candidato suggerito), qui si registra solo la mappatura testo→id e si
  // controlla lo scostamento prezzo — nessun rischio di lasciare un
  // articolo orfano, quindi resta immediato (rete) invece che rimandato.
  async function confermaStesso(articolo: ArticoloEstratto) {
    if (!current) return
    try {
      const res = await fetch('/api/cassa/fatture/conferma-articolo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          fornitore_id: current.fornitore.id,
          testo_estratto: articolo.testo_estratto,
          decisione: 'stesso',
          catalogo_articolo_id: articolo.catalogo_articolo_id,
          prezzo_unitario: articolo.quantita !== 0 ? articolo.prezzo_riga / articolo.quantita : articolo.prezzo_riga,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Errore nel salvataggio della scelta'); return }
      setResolved(prev => new Map(prev).set(articolo.testo_estratto, { catalogoArticoloId: data.catalogo_articolo_id, sospetto: data.sospetto ?? null }))
      setConfirmingIndex(null)
    } catch {
      setError('Errore di rete, riprova')
    }
  }

  function risoltoInfo(a: ArticoloEstratto): { catalogoArticoloId: string; sospetto: VerificaSospetta | null } | null {
    if (a.esito === 'auto_mappato' || a.esito === 'chiaro') {
      return a.catalogo_articolo_id ? { catalogoArticoloId: a.catalogo_articolo_id, sospetto: a.sospetto } : null
    }
    return resolved.get(a.testo_estratto) ?? null
  }

  // Dati con cui un articolo 'nuovo' (o 'ambiguo' risolto come nuovo)
  // verrà creato al salvataggio: quelli eventualmente modificati
  // dall'utente, altrimenti il suggerimento dell'OCR di default — non è
  // più obbligatorio che l'utente li tocchi.
  function datiNuovoArticolo(a: ArticoloEstratto): DatiNuovoArticolo {
    return nuoviModificati.get(a.testo_estratto) ?? {
      nome_articolo: a.testo_estratto,
      tipologia: a.tipologia_suggerita,
      unita_misura: a.unita_misura ?? undefined,
    }
  }

  const articoli = current?.articoli ?? []
  const richiedeCategoriaDiretta = current?.fattura?.ha_articoli === false
  // Nessun articolo blocca più il salvataggio in attesa di una decisione:
  // un 'ambiguo' non confermato si salva come nuovo articolo (i default
  // sono già pronti in datiNuovoArticolo), esattamente come un 'nuovo' —
  // confermare che è lo stesso di un candidato a catalogo resta possibile
  // ma opzionale, mai obbligatorio.
  const tuttiRisolti = !richiedeCategoriaDiretta || !!categoriaDiretta
  const ultimaDelBatch = currentIndex >= results.length - 1

  // Passa alla fattura successiva del batch resettando lo stato di
  // revisione (è per forza tutto relativo alla fattura appena
  // conclusa: fornitore, articoli e testo_estratto possono essere
  // completamente diversi sulla prossima), oppure chiude se era l'ultima.
  function avanti() {
    if (ultimaDelBatch) { onFinished(); return }
    setCurrentIndex(i => i + 1)
    setResolved(new Map())
    setNuoviModificati(new Map())
    setPrezziModificati(new Map())
    setConfirmingIndex(null)
    setCategoriaDiretta('')
    setError(null)
  }

  async function handleConferma() {
    if (!current) return

    if (current.duplicato) {
      avanti()
      return
    }
    if (!current.fattura || !tuttiRisolti) return

    const verificheArticoli = articoli
      .map(a => risoltoInfo(a)?.sospetto)
      .filter((v): v is VerificaSospetta => !!v)

    setSaving(true)
    setError(null)
    try {
      await onComplete({
        foto_paths: current.foto_paths,
        fornitore: current.fornitore,
        data: current.fattura.data,
        numero_documento: current.fattura.numero_documento,
        ha_articoli: current.fattura.ha_articoli,
        categoria_spesa_diretta_id: richiedeCategoriaDiretta ? categoriaDiretta : null,
        iva_dettaglio: current.fattura.iva_dettaglio,
        totale_netto: current.fattura.totale_netto,
        totale_iva: current.fattura.totale_iva,
        totale_lordo: current.fattura.totale_lordo,
        articoli: articoli.map((a, i) => {
          const info = risoltoInfo(a)
          const prezzoRiga = prezziModificati.get(i) ?? a.prezzo_riga
          return info
            ? { testo_estratto: a.testo_estratto, quantita: a.quantita, prezzo_riga: prezzoRiga, catalogo_articolo_id: info.catalogoArticoloId }
            : { testo_estratto: a.testo_estratto, quantita: a.quantita, prezzo_riga: prezzoRiga, nuovo_articolo: datiNuovoArticolo(a) }
        }),
        verifiche_sospette: [...current.fattura.verifiche_sospette, ...verificheArticoli],
      })
      avanti()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nel salvataggio della fattura')
    } finally {
      setSaving(false)
    }
  }

  if (status === 'review' && current) {
    if (current.duplicato) {
      return (
        <div className="space-y-4">
          {results.length > 1 && <p className="text-xs font-medium text-muted-foreground">Fattura {currentIndex + 1} di {results.length}</p>}
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-destructive">Possibile doppione</p>
              <p className="text-muted-foreground">
                Una fattura di <strong>{current.fornitore.nome}</strong> con lo stesso numero documento è già presente a sistema. Non è stata salvata.
              </p>
            </div>
          </div>
          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={onCancel}>Annulla</Button>
            <Button type="button" onClick={avanti}>{ultimaDelBatch ? 'Chiudi' : 'Fattura successiva'}</Button>
          </div>
        </div>
      )
    }

    if (!current.fattura) return null
    const verificheFattura = current.fattura.verifiche_sospette
    return (
      <div className="space-y-4">
        {results.length > 1 && <p className="text-xs font-medium text-muted-foreground">Fattura {currentIndex + 1} di {results.length}</p>}
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 space-y-1 text-sm">
          <div><span className="text-muted-foreground">Fornitore</span> <strong>{current.fornitore.nome}</strong>{current.fornitore.nuovo && <Badge variant="secondary" className="ml-2">nuovo</Badge>}</div>
          <p>
            <span className={cn('text-muted-foreground', verificheFattura.some(v => v.campo === 'data') && 'text-amber-600 dark:text-amber-400 font-medium')}>Data</span>{' '}
            <span className="cassa-numeric">{current.fattura.data}</span> · <span className="text-muted-foreground">Documento</span> <span className="cassa-numeric">{current.fattura.numero_documento}</span>
          </p>
          <p className="cassa-numeric">
            <span className="text-muted-foreground font-sans">Netto</span> € {current.fattura.totale_netto.toFixed(2)} · <span className="text-muted-foreground font-sans">IVA</span> € {current.fattura.totale_iva.toFixed(2)} ·{' '}
            <span className={cn('font-sans', verificheFattura.some(v => v.campo === 'totale_lordo') ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground')}>Lordo</span> € {current.fattura.totale_lordo.toFixed(2)}
          </p>
          {verificheFattura.map((v, i) => (
            <p key={i} className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 pt-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {v.messaggio}
            </p>
          ))}
        </div>

        {richiedeCategoriaDiretta && (
          <div className="space-y-1.5">
            <Label>Categoria spesa diretta <span className="text-cassa-copper">*</span></Label>
            <Select value={categoriaDiretta} onValueChange={setCategoriaDiretta}>
              <SelectTrigger><SelectValue placeholder="Seleziona una categoria" /></SelectTrigger>
              <SelectContent>
                {categorieDirette.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {articoli.length > 0 && (
          <div className="space-y-2">
            <Label>Articoli ({articoli.length})</Label>
            {articoli.map((a, i) => {
              const prezzoRiga = prezziModificati.get(i) ?? a.prezzo_riga
              const prezzoModificato = prezziModificati.has(i)
              // Con il prezzo corretto a mano: stesso oggetto ma con
              // prezzo_riga aggiornato, così sia la conferma "è lo
              // stesso" (verifica scostamento lato server) sia il nuovo
              // articolo usano il valore corretto, non quello originale
              // dell'OCR.
              const aEffettivo = prezzoModificato ? { ...a, prezzo_riga: prezzoRiga } : a
              const info = risoltoInfo(a)
              const nuovoInfo = nuoviModificati.get(a.testo_estratto)
              const prezzoUnitario = a.quantita !== 0 ? prezzoRiga / a.quantita : prezzoRiga
              return (
                <div key={`${a.testo_estratto}-${i}`} className="rounded-md border border-border px-3 py-2 text-sm space-y-2">
                  <p className="truncate">{a.testo_estratto}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="cassa-numeric text-xs text-muted-foreground whitespace-nowrap">
                      {a.quantita}{a.unita_misura ? ` ${a.unita_misura}` : ''} ×
                    </span>
                    <div className="w-24">
                      <CurrencyInput
                        value={prezzoRiga}
                        onChange={v => setPrezziModificati(prev => new Map(prev).set(i, v))}
                        hideStepper
                        className="h-7 text-sm cassa-numeric"
                      />
                    </div>
                    <span className="cassa-numeric text-xs text-muted-foreground whitespace-nowrap">
                      € {prezzoUnitario.toFixed(2)} cad.{prezzoModificato && ' · corretto'}
                    </span>
                  </div>
                  {confirmingIndex === i ? (
                    <ArticoloConfirmForm
                      articolo={aEffettivo}
                      onStesso={() => confermaStesso(aEffettivo)}
                      onNuovo={payload => { setNuoviModificati(prev => new Map(prev).set(a.testo_estratto, payload)); setConfirmingIndex(null) }}
                      onAnnulla={() => setConfirmingIndex(null)}
                    />
                  ) : info ? (
                    <div className="space-y-1.5">
                      <Badge variant="secondary">
                        {a.esito === 'auto_mappato' ? 'già noto' : a.esito === 'chiaro' ? 'abbinato' : 'confermato'}
                      </Badge>
                      {info.sospetto && !prezzoModificato && (
                        <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {info.sospetto.messaggio}
                        </p>
                      )}
                    </div>
                  ) : (
                    // Non blocca mai: verrà salvato come nuovo articolo con
                    // questi dati (di default il suggerimento dell'OCR),
                    // la modifica resta possibile ma non obbligatoria. Vale
                    // anche per un 'ambiguo' non confermato: non rispondere
                    // al suggerimento equivale a dire che è un prodotto
                    // diverso, coerente col default "nuovo articolo" — la
                    // conferma del match resta un'azione facoltativa.
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Verrà salvato come nuovo articolo ({TIPOLOGIA_LABELS[nuovoInfo?.tipologia ?? a.tipologia_suggerita]}
                          {(nuovoInfo?.unita_misura ?? a.unita_misura) ? `, ${nuovoInfo?.unita_misura ?? a.unita_misura}` : ''})
                        </span>
                        <Button type="button" size="sm" variant="outline" onClick={() => setConfirmingIndex(i)}>Modifica</Button>
                      </div>
                      {a.esito === 'ambiguo' && !nuovoInfo && a.candidato_nome && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-amber-600 dark:text-amber-400">
                            È lo stesso articolo di &quot;{a.candidato_nome}&quot;?
                          </span>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingIndex(i)}>Conferma</Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Annulla</Button>
          <Button type="button" onClick={handleConferma} disabled={!tuttiRisolti || saving}>
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvataggio…</>
              : ultimaDelBatch ? 'Salva fattura' : 'Salva e continua'}
          </Button>
        </div>
      </div>
    )
  }

  if (daRitagliare) {
    return (
      <DocumentScanner
        file={daRitagliare}
        onConfirm={aggiungiPagina}
        onCancel={() => setDaRitagliare(null)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {previews.map((src, i) => {
          const isPdf = pages[i]?.type === 'application/pdf'
          return (
            <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-md border border-border">
              {isPdf ? (
                <a
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-muted p-2 text-center hover:bg-accent"
                >
                  <FileText className="h-6 w-6 text-muted-foreground" />
                  <span className="line-clamp-2 break-all text-[10px] text-muted-foreground">{pages[i].name}</span>
                </a>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- anteprima locale da blob URL, next/image non si applica
                <img src={src} alt={`Pagina ${i + 1}`} className="h-full w-full object-cover" />
              )}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{i + 1}</span>
              <button
                type="button"
                onClick={() => removePage(i)}
                className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}

        <label className={cn(
          'flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent',
        )}>
          {initialMode === 'scan' ? <Camera className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
          <span className="text-xs">{initialMode === 'scan' ? 'Aggiungi pagina' : 'Aggiungi da file'}</span>
          {initialMode === 'scan' ? (
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleAddPage} />
          ) : (
            <input type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={handleAddPage} />
          )}
        </label>
      </div>

      {status === 'processing' && (
        <p className="text-xs text-muted-foreground">
          {faseElaborazione === 'upload'
            ? 'Caricamento foto in corso…'
            : 'Lettura accurata in corso, può richiedere qualche decina di secondi — non chiudere la pagina.'}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Annulla</Button>
        <Button type="button" onClick={handleElabora} disabled={pages.length === 0 || status === 'processing'}>
          {status === 'processing' ? <><Loader2 className="h-4 w-4 animate-spin" /> Elaborazione…</> : `Elabora (${pages.length} ${pages.length === 1 ? 'pagina' : 'pagine'})`}
        </Button>
      </div>
    </div>
  )
}

// Form inline per confermare un match ambiguo ("è lo stesso di X? Sì/No, è
// nuovo") o, se non c'è un candidato suggerito (esito 'nuovo'), per
// registrare direttamente il nuovo articolo con la sua tipologia.
function ArticoloConfirmForm({
  articolo, onStesso, onNuovo, onAnnulla,
}: {
  articolo: ArticoloEstratto
  onStesso: () => Promise<void>
  // A differenza di onStesso, non è più una chiamata di rete: i dati si
  // limitano a essere ricordati localmente, la riga di catalogo si crea
  // solo al salvataggio della fattura (vedi handleConferma) — quindi
  // nessun bisogno di stato di caricamento per questo tasto.
  onNuovo: (payload: { nome_articolo: string; tipologia: ArticoloTipologia; unita_misura?: string }) => void
  onAnnulla: () => void
}) {
  const haCandidato = articolo.esito === 'ambiguo' && !!articolo.catalogo_articolo_id
  const [creaNuovo, setCreaNuovo] = useState(!haCandidato)
  const [nome, setNome] = useState(articolo.testo_estratto)
  // Precompilati dal suggerimento dell'OCR — l'utente conferma con un
  // tocco invece di ricompilare tipologia/unità da zero per ogni
  // articolo nuovo, che è quasi sempre già scritto in fattura.
  const [tipologia, setTipologia] = useState<ArticoloTipologia | ''>(articolo.tipologia_suggerita)
  const [unita, setUnita] = useState(articolo.unita_misura ?? '')
  // Solo per "Sì, è lo stesso": passa da una chiamata di rete
  // (match/verifica prezzo lato server), senza questo stato il tasto non
  // darebbe nessun segnale durante l'attesa.
  const [salvando, setSalvando] = useState(false)

  async function handleStesso() {
    setSalvando(true)
    try { await onStesso() } finally { setSalvando(false) }
  }

  function handleNuovo() {
    onNuovo({ nome_articolo: nome.trim(), tipologia: tipologia as ArticoloTipologia, unita_misura: unita.trim() || undefined })
  }

  if (!creaNuovo) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2">
        <span className="text-xs text-muted-foreground">Stesso articolo di &quot;{articolo.candidato_nome}&quot;?</span>
        <Button type="button" size="sm" onClick={handleStesso} disabled={salvando}>
          {salvando ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Salvo…</> : 'Sì, è lo stesso'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setCreaNuovo(true)} disabled={salvando}>No, è nuovo</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onAnnulla} disabled={salvando}>Annulla</Button>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-2">
      <div className="space-y-1">
        <Label className="text-xs">Nome articolo</Label>
        <Input value={nome} onChange={e => setNome(e.target.value)} className="h-8" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Tipologia</Label>
          <Select value={tipologia} onValueChange={v => setTipologia(v as ArticoloTipologia)}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Seleziona" /></SelectTrigger>
            <SelectContent>
              {(Object.keys(TIPOLOGIA_LABELS) as ArticoloTipologia[]).map(t => (
                <SelectItem key={t} value={t}>{TIPOLOGIA_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Unità misura (opz.)</Label>
          <Input value={unita} onChange={e => setUnita(e.target.value)} className="h-8" placeholder="kg, L, pz…" />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        {haCandidato && <Button type="button" size="sm" variant="ghost" onClick={() => setCreaNuovo(false)}>Indietro</Button>}
        <Button type="button" size="sm" variant="ghost" onClick={onAnnulla}>Annulla</Button>
        <Button type="button" size="sm" disabled={!nome.trim() || !tipologia} onClick={handleNuovo}>
          Conferma dati
        </Button>
      </div>
    </div>
  )
}
