'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/compressImage'
import { DocumentScanner } from '@/components/acquisti/DocumentScanner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Camera, Upload, X, Loader2, AlertTriangle, FileText, Crop } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ArticoloTipologia, VerificaSospetta, RiquadroArticolo } from '@/types'

const TIPOLOGIA_LABELS: Record<ArticoloTipologia, string> = {
  food: 'Food',
  beverage: 'Beverage',
  detergenza: 'Detergenza',
  altro_no_food: 'Altro no-food',
}

// data è una colonna DATE (yyyy-mm-dd), senza componente ora/timezone:
// un semplice riordino delle parti basta, non serve date-fns-tz.
function formatDataIt(data: string): string {
  const [y, m, d] = data.split('-')
  return y && m && d ? `${d}/${m}/${y}` : data
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
  pagina_indice: number
  riquadro: RiquadroArticolo | null
}

// Rispecchia PaginaEstratta in fattureExtraction.ts (fase 1: solo
// lettura, prima ancora del raggruppamento in fatture — vedi
// handleElabora). Articolo qui è il dato grezzo letto dalla pagina,
// prima di qualunque abbinamento al catalogo (a differenza di
// ArticoloEstratto sotto, che è il risultato della fase 2).
interface PaginaLetta {
  data: string | null
  fornitore_nome: string | null
  fornitore_partita_iva: string | null
  numero_documento: string | null
  iva_dettaglio: AliquotaEstratta[]
  articoli: Array<{
    nome: string
    quantita: number
    prezzo_riga: number
    unita_misura: string | null
    tipologia_suggerita: ArticoloTipologia
    riquadro: RiquadroArticolo | null
    aliquota_iva: number
  }>
  totale_documento: number | null
}

interface EstraiResponse {
  duplicato: boolean
  fattura_esistente_id?: string
  fattura_esistente_data?: string
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
  // Presente solo quando l'utente ha scelto "Sostituisci quella
  // esistente" da uno schermo di doppione: il chiamante deve aggiornare
  // questa fattura già a sistema (route /sostituisci) invece di crearne
  // una nuova (route /salva) — vedi sostituisciDoppione più sotto.
  overwrite_fattura_id?: string
  ha_articoli: boolean
  categoria_spesa_diretta_id: string | null
  iva_dettaglio: AliquotaEstratta[]
  totale_netto: number
  totale_iva: number
  totale_lordo: number
  // Corretti a mano in revisione quando l'OCR ha letto male il totale
  // stampato — null se l'utente non li ha toccati (il caso comune): il
  // server allora non applica nessuno scavalco, il totale resta quello
  // calcolato dalla somma di articoli/IVA come sempre.
  totale_lordo_manuale: number | null
  totale_netto_manuale: number | null
  // Cauzione su vuoti (fusti/casse) da scalare al ritiro — opzionale.
  vuoti_ritirati: number | null
  // Un articolo 'nuovo' mai confermato esplicitamente (non più
  // obbligatorio) arriva con nuovo_articolo invece di
  // catalogo_articolo_id: il chiamante crea la riga di catalogo al
  // momento del salvataggio, non prima.
  articoli: Array<
    { testo_estratto: string; quantita: number; prezzo_riga: number; pagina_indice: number; riquadro: RiquadroArticolo | null } & (
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
  // Per poter correggere il fornitore in revisione quando l'OCR l'ha
  // letto male — stesso problema che rende utile la Ri-scansione.
  fornitori: Array<{ id: string; nome: string }>
  // 'scan' = input con capture="environment", per un documento cartaceo
  // davanti all'utente. 'file' = selezione diretta da file/galleria,
  // multipla. La differenza reale è solo l'attributo dell'input: il
  // browser decide se aprire la fotocamera direttamente o un selettore
  // di sistema che offre comunque "Scatta foto" — quindi anche da 'file'
  // il risultato può essere una singola foto appena scattata, non solo
  // un file esistente. Il ritaglio prospettico (vedi handleAddPage) si
  // applica per questo a QUALSIASI singola immagine, indipendentemente
  // da initialMode, e salta solo su un PDF o una selezione multipla.
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
  // Ri-scansione di una fattura già salvata (Fatture → Visualizza →
  // Ri-scansiona): precompila la griglia pagine scaricando le foto già
  // su storage di quella fattura, invece di partire vuota — i
  // collaboratori non sempre le ritagliano bene, quindi restano
  // modificabili come una normale cattura (rimuovi, ri-ritaglia,
  // aggiungine di nuove) prima di rileggerle. Da qui in poi il
  // componente si comporta esattamente come il flusso normale: le foto
  // mostrate sono copie scaricate in memoria, non ancora ricaricate su
  // storage, quindi le stesse regole di pulizia (doppione, annulla)
  // restano valide invariate. Solo /estrai riceve in più l'id della
  // fattura da escludere dal controllo doppioni (altrimenti risulterebbe
  // sempre duplicata di se stessa).
  rescan?: { fatturaId: string; fotoPaths: string[] }
}

// Cattura multi-pagina + pipeline di estrazione/matching (Task 1). Non
// salva la fattura — restituisce i dati risolti a onComplete perché il
// chiamante (Task 3) la persista dopo la conferma finale dell'utente.
// Un caricamento può contenere più fatture distinte insieme (anche di
// fornitori diversi): l'estrazione le separa già, qui si rivedono e
// salvano una alla volta con uno stepper "Fattura N di M".
export function FatturaCapture({ restaurantId, categorieDirette, fornitori, initialMode, onComplete, onFinished, onCancel, rescan }: Props) {
  const [pages, setPages] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [status, setStatus] = useState<'capturing' | 'processing' | 'review'>(rescan ? 'processing' : 'capturing')
  // Solo per il messaggio mostrato durante 'processing' — il caricamento
  // foto è rapido, la lettura AI no, distinguerli evita che un'attesa
  // lunga sembri bloccata sul passo sbagliato.
  const [faseElaborazione, setFaseElaborazione] = useState<'upload' | 'lettura'>('upload')
  // Quale gruppo di pagine si sta leggendo — vedi handleElabora: la
  // lettura è spezzata in più chiamate invece di una sola con tutte le
  // pagine insieme, per non superare il tempo massimo della funzione.
  const [progressoLettura, setProgressoLettura] = useState<{ corrente: number; totale: number } | null>(null)
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
  // Quantità e prezzo unitario corretti a mano in revisione — tenuti per
  // indice, non per testo_estratto: due righe con lo stesso testo
  // estratto (raro ma possibile) non devono correggersi a vicenda.
  // L'importo di riga è sempre DERIVATO dai due (mai memorizzato a
  // parte), così Netto/Lordo in testata possono ricalcolarsi dal vivo
  // sulla somma reale delle righe invece di restare fermi al valore
  // letto dall'OCR quando si corregge un articolo.
  const [quantitaModificate, setQuantitaModificate] = useState<Map<number, number>>(new Map())
  const [prezzoUnitarioModificato, setPrezzoUnitarioModificato] = useState<Map<number, number>>(new Map())
  const [confirmingIndex, setConfirmingIndex] = useState<number | null>(null)
  const [categoriaDiretta, setCategoriaDiretta] = useState('')
  // Fornitore corretto a mano in revisione — l'OCR può leggerlo sbagliato
  // tanto quanto data/numero documento. null finché l'utente non lo
  // tocca: si parte dal fornitore risolto dal server.
  const [fornitoreEditato, setFornitoreEditato] = useState<{ id: string; nome: string } | null>(null)
  // Data/numero documento corretti a mano in revisione — l'OCR può non
  // leggerli affatto (es. un DDT compilato a mano), e senza un modo di
  // inserirli qui la fattura non sarebbe più salvabile (salva/route.ts
  // li richiede entrambi). null finché l'utente non tocca il campo: si
  // parte dal valore letto dall'AI.
  const [dataEditata, setDataEditata] = useState<string | null>(null)
  const [numeroDocEditato, setNumeroDocEditato] = useState<string | null>(null)
  // Totale corretto a mano in revisione — null finché l'utente non
  // tocca il campo: si parte dal valore letto dall'AI, nessuno scavalco
  // inviato al salvataggio. Correggere il Lordo aggiorna anche il Netto
  // (stessa IVA, vedi onChange sotto); il Netto resta comunque
  // modificabile per conto suo.
  const [totaleLordoEditato, setTotaleLordoEditato] = useState<number | null>(null)
  const [totaleNettoEditato, setTotaleNettoEditato] = useState<number | null>(null)
  // Cauzione su vuoti da scalare — facoltativo, non tocca il totale.
  const [vuotiRitirati, setVuotiRitirati] = useState<number | null>(null)
  // Testo_estratto degli articoli 'chiaro'/'auto_mappato' che l'utente ha
  // smentito in revisione ("Non è questo") — riportati allo stato non
  // risolto, verranno salvati come nuovo articolo invece dell'abbinamento
  // sbagliato dell'AI (vedi risoltoInfo).
  const [rifiutati, setRifiutati] = useState<Set<string>>(new Set())
  // Salvataggio (o presa visione di un doppione) della fattura corrente
  // in corso — passa da una richiesta di rete, senza questo stato il
  // tasto "Salva fattura" non darebbe nessun segnale durante l'attesa.
  const [saving, setSaving] = useState(false)
  // Foto appena scattata, in attesa del ritaglio prospettico: finché è
  // valorizzata lo scanner prende il posto della griglia delle pagine.
  const [daRitagliare, setDaRitagliare] = useState<File | null>(null)
  // Non null quando lo scanner sta ri-ritagliando una pagina GIÀ in
  // griglia (invece di aggiungerne una nuova): l'indice dice a
  // confermaRitaglio se sostituire quella pagina o accodarne una.
  const [ritagliaIndice, setRitagliaIndice] = useState<number | null>(null)
  // Indice del batch → id della fattura esistente che sta sostituendo,
  // valorizzata solo scegliendo "Sostituisci quella esistente" su un
  // doppione (vedi sostituisciDoppione). Letta da handleConferma per
  // passare overwrite_fattura_id a onComplete.
  const [overwriteTargets, setOverwriteTargets] = useState<Map<number, string>>(new Map())
  const [risolvendoDoppione, setRisolvendoDoppione] = useState(false)

  const rescanCaricato = useRef(false)
  useEffect(() => {
    if (!rescan || rescanCaricato.current) return
    rescanCaricato.current = true
    caricaFotoEsistenti(rescan.fotoPaths)
  }, [rescan])

  // Precompila la griglia scaricando le foto già su storage della
  // fattura — da qui in poi sono normalissime pagine locali, non ancora
  // ricaricate: possono essere rimosse, ri-ritagliate o affiancate da
  // altre prima di "Elabora", esattamente come una cattura da zero.
  async function caricaFotoEsistenti(fotoPaths: string[]) {
    const supabase = createClient()
    try {
      for (const path of fotoPaths) {
        const { data: blob, error: downloadErr } = await supabase.storage.from('fatture_foto').download(path)
        if (downloadErr || !blob) throw downloadErr ?? new Error('Foto non trovata')
        const ext = path.split('.').pop() ?? 'jpg'
        const file = new File([blob], `pagina-esistente.${ext}`, { type: blob.type || 'image/jpeg' })
        setPages(prev => [...prev, file])
        setPreviews(prev => [...prev, URL.createObjectURL(file)])
      }
      setStatus('capturing')
    } catch (err) {
      setError(err instanceof Error ? `Errore nel recupero delle foto esistenti: ${err.message}` : 'Errore nel recupero delle foto esistenti')
      setStatus('capturing')
    }
  }

  async function handleAddPage(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    e.target.value = ''
    // Una singola immagine passa sempre dal ritaglio, indipendentemente
    // da initialMode: sul telefono è il browser a decidere se l'input di
    // "Carica da file" apre direttamente la fotocamera o un selettore di
    // sistema che offre comunque "Scatta foto" fra le opzioni — quindi
    // anche da quel tasto il risultato può essere una foto appena
    // scattata, non solo un file esistente, e l'utente non ha modo di
    // sapere in anticipo quale dei due tasti "garantisce" il ritaglio:
    // deve funzionare allo stesso modo da entrambi.
    if (files.length === 1 && files[0].type.startsWith('image/')) {
      setDaRitagliare(files[0])
      return
    }
    // Più file, o un PDF: niente ritaglio prospettico, si accodano
    // direttamente (in sequenza, non in parallelo, per mantenere
    // l'ordine di selezione anche se la compressione impiega tempi
    // diversi) — tipico di un caricamento in blocco di file già esistenti.
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

  // Ri-ritaglia una pagina già in griglia (tipicamente una foto esistente
  // di una ri-scansione, mal ritagliata dal collaboratore) invece di
  // accodarne una nuova: stessa posizione, stesso indice, solo l'immagine
  // cambia.
  function ricroppaPagina(i: number) {
    setRitagliaIndice(i)
    setDaRitagliare(pages[i])
  }

  async function sostituisciPagina(i: number, file: File) {
    setDaRitagliare(null)
    setRitagliaIndice(null)
    let compressed = file
    if (file.type.startsWith('image/')) {
      try { compressed = await compressImage(file, 2200, 0.9) } catch { /* usa l'originale */ }
    }
    setPages(prev => prev.map((p, idx) => idx === i ? compressed : p))
    setPreviews(prev => prev.map((src, idx) => {
      if (idx !== i) return src
      URL.revokeObjectURL(src)
      return URL.createObjectURL(compressed)
    }))
  }

  function removePage(i: number) {
    setPages(prev => prev.filter((_, idx) => idx !== i))
    setPreviews(prev => {
      URL.revokeObjectURL(prev[i])
      return prev.filter((_, idx) => idx !== i)
    })
  }

  // Quante pagine al massimo per chiamata a /estrai — vedi il commento
  // nel corpo di handleElabora sotto per il perché.
  const MAX_PAGINE_PER_LETTURA = 4

  // Fase 2 (vedi handleElabora): compone le fatture da un elenco di
  // pagine già lette, in un'unica chiamata — mai fatta gruppo per
  // gruppo, altrimenti una fattura le cui pagine cadono in due gruppi
  // diversi verrebbe spezzata in due (vedi il commento su componiFatture
  // in fattureExtraction.ts).
  async function chiamaComponi(
    pagine: PaginaLetta[],
    paths: string[],
    excludeFatturaId?: string
  ): Promise<{ fatture: EstraiResponse[] } | { error: string }> {
    try {
      const res = await fetch('/api/cassa/fatture/componi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId, foto_paths: paths, pagine, exclude_fattura_id: excludeFatturaId }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        return {
          error: data?.error ?? (res.status === 504
            ? 'La composizione ha superato il tempo massimo.'
            : `Errore nella composizione della fattura (codice ${res.status}).`),
        }
      }
      return { fatture: (data.fatture ?? []) as EstraiResponse[] }
    } catch {
      return { error: 'Errore di rete durante la composizione.' }
    }
  }

  async function handleElabora() {
    setStatus('processing')
    setFaseElaborazione('upload')
    setProgressoLettura(null)
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

    // Letta in gruppi piccoli invece che tutte le pagine in un'unica
    // chiamata: la lettura di ogni pagina è già in parallelo e limitata
    // singolarmente (vedi BUDGET_ESTRAZIONE_MS in fattureExtraction.ts),
    // ma più pagine insieme — specie di fatture diverse — vanno spesso
    // in timeout comunque, verosimilmente per la concorrenza verso il
    // modello AI più che per il tempo di lettura in sé. Gruppi piccoli
    // riducono il rischio; un gruppo di più di MAX_PAGINE_PER_LETTURA
    // pagine (documento lungo) resta un unico gruppo, quindi un
    // documento così lungo non trae vantaggio da questa suddivisione —
    // solo dallo scaglionare fatture diverse tra loro.
    //
    // Fase 1 (qui sotto): solo lettura, gruppo per gruppo. Il
    // raggruppamento in fatture è deliberatamente rimandato a un'unica
    // chiamata finale (chiamaComponi, fase 2) su TUTTE le pagine lette —
    // farlo già qui, gruppo per gruppo, spezzerebbe in due una fattura
    // le cui pagine cadono a cavallo di due gruppi consecutivi.
    setFaseElaborazione('lettura')
    const gruppi: string[][] = []
    for (let i = 0; i < fotoPaths.length; i += MAX_PAGINE_PER_LETTURA) gruppi.push(fotoPaths.slice(i, i + MAX_PAGINE_PER_LETTURA))

    const pagineAccumulate: PaginaLetta[] = []
    for (let g = 0; g < gruppi.length; g++) {
      setProgressoLettura({ corrente: g + 1, totale: gruppi.length })
      let pagineGruppo: PaginaLetta[] | null = null
      let messaggioErrore: string | null = null
      try {
        const res = await fetch('/api/cassa/fatture/estrai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ restaurant_id: restaurantId, foto_paths: gruppi[g], exclude_fattura_id: rescan?.fatturaId }),
        })

        // Una funzione terminata dalla piattaforma (timeout) risponde con
        // una pagina di errore, non con JSON: senza questa guardia il
        // res.json() esplode e l'utente vede un generico "Errore di rete"
        // che non dice nulla su cosa è andato storto davvero.
        const data = await res.json().catch(() => null)
        if (!res.ok || !data) {
          messaggioErrore = data?.error ?? (res.status === 504
            ? 'La lettura ha superato il tempo massimo.'
            : `Errore nella lettura della fattura (codice ${res.status}).`)
        } else {
          pagineGruppo = data.pagine ?? []
        }
      } catch {
        messaggioErrore = 'Errore di rete durante la lettura.'
      }

      if (messaggioErrore) {
        // Le pagine dei gruppi già letti restano ripulite dalla griglia
        // (le loro pagine sono già in pagineAccumulate); quelle del
        // gruppo fallito e dei successivi, mai tentate, restano invece
        // in coda per un nuovo tentativo.
        const paginePassate = gruppi.slice(0, g).reduce((tot, gr) => tot + gr.length, 0)
        setPreviews(prev => { prev.slice(0, paginePassate).forEach(URL.revokeObjectURL); return prev.slice(paginePassate) })
        setPages(prev => prev.slice(paginePassate))

        if (pagineAccumulate.length > 0) {
          // Almeno le pagine già lette possono comunque essere composte
          // in fatture, per non perdere il lavoro fatto finora.
          const composizione = await chiamaComponi(pagineAccumulate, fotoPaths.slice(0, paginePassate), rescan?.fatturaId)
          if ('fatture' in composizione && composizione.fatture.length > 0) {
            setResults(composizione.fatture)
            setCurrentIndex(0)
            setStatus('review')
            setError(`${messaggioErrore} Le fatture già lette sono pronte per la revisione; le pagine restanti sono rimaste in coda, riprova dopo aver salvato queste.`)
            return
          }
        }
        setError(`${messaggioErrore} Riprova con meno pagine per volta, oppure compila i dati a mano.`)
        setStatus('capturing')
        return
      }

      pagineAccumulate.push(...(pagineGruppo ?? []))
    }

    // Fase 2: un'unica composizione su tutte le pagine lette.
    const composizione = await chiamaComponi(pagineAccumulate, fotoPaths, rescan?.fatturaId)
    if ('error' in composizione) {
      setError(`${composizione.error} Riprova, oppure compila i dati a mano.`)
      setStatus('capturing')
      return
    }
    setResults(composizione.fatture)
    setCurrentIndex(0)
    setStatus('review')
  }

  // Fornitore effettivamente in uso per la fattura corrente: quello
  // corretto a mano se l'utente l'ha cambiato, altrimenti quello risolto
  // dal server.
  const fornitoreEffettivo = fornitoreEditato ?? current?.fornitore ?? null

  // Solo per la decisione 'stesso': l'id catalogo è già noto (il
  // candidato suggerito), qui si registra solo la mappatura testo→id e si
  // controlla lo scostamento prezzo — nessun rischio di lasciare un
  // articolo orfano, quindi resta immediato (rete) invece che rimandato.
  async function confermaStesso(articolo: ArticoloEstratto) {
    if (!current || !fornitoreEffettivo) return
    try {
      const res = await fetch('/api/cassa/fatture/conferma-articolo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          fornitore_id: fornitoreEffettivo.id,
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
    // L'abbinamento 'auto_mappato'/'chiaro' che arriva da current.articoli
    // è stato risolto dal server contro il catalogo del fornitore
    // ORIGINALE: se l'utente lo corregge in revisione, quell'abbinamento
    // punterebbe a un articolo del fornitore sbagliato — va ignorato,
    // l'articolo torna "nuovo" finché non viene confermato di nuovo (col
    // fornitore giusto, tramite confermaStesso qui sopra).
    if (current && fornitoreEditato && fornitoreEditato.id !== current.fornitore.id) return null
    if (a.esito === 'auto_mappato' || a.esito === 'chiaro') {
      if (rifiutati.has(a.testo_estratto)) return null
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

  // Quantità/prezzo unitario effettivi di una riga (originali o corretti
  // a mano) e il conseguente importo di riga — usata sia per il
  // salvataggio sia per il ricalcolo dal vivo di Netto/Lordo sotto.
  function quantitaEffettiva(i: number, a: ArticoloEstratto): number {
    return quantitaModificate.get(i) ?? a.quantita
  }
  function prezzoUnitarioEffettivo(i: number, a: ArticoloEstratto): number {
    const originale = a.quantita !== 0 ? a.prezzo_riga / a.quantita : a.prezzo_riga
    return prezzoUnitarioModificato.get(i) ?? originale
  }
  function prezzoRigaEffettivo(i: number, a: ArticoloEstratto): number {
    return quantitaEffettiva(i, a) * prezzoUnitarioEffettivo(i, a)
  }

  const dataEffettiva = (dataEditata ?? current?.fattura?.data ?? '').trim()
  const numeroDocEffettivo = (numeroDocEditato ?? current?.fattura?.numero_documento ?? '').trim()
  // Netto dalla somma REALE delle righe (quando la fattura ne ha) invece
  // che dal valore letto dall'OCR: è anche esattamente il criterio che il
  // trigger di salvataggio (fatture_recompute_totali) usa per calcolare
  // il netto quando ha_articoli è vero, quindi qui la testata mostra
  // sempre ciò che verrà davvero salvato — e si aggiorna subito quando si
  // corregge quantità o prezzo di una riga, invece di restare ferma al
  // valore originale. L'IVA non dipende dalle righe (resta quella letta/
  // stimata in fattura, invariata da queste correzioni — coerente con la
  // stessa separazione già presente nel trigger).
  const nettoDaArticoli = current?.fattura?.ha_articoli
    ? articoli.reduce((tot, a, i) => tot + prezzoRigaEffettivo(i, a), 0)
    : null
  const totaleNettoEffettivo = totaleNettoEditato ?? nettoDaArticoli ?? current?.fattura?.totale_netto ?? 0
  const totaleLordoEffettivo = totaleLordoEditato ?? (nettoDaArticoli != null ? nettoDaArticoli + (current?.fattura?.totale_iva ?? 0) : current?.fattura?.totale_lordo ?? 0)
  function onChangeTotaleLordo(v: number) {
    setTotaleLordoEditato(v)
    // L'IVA non è modificabile qui: corretto il totale, l'imponibile si
    // aggiusta di conseguenza (stessa IVA), restando comunque
    // modificabile per conto suo subito dopo.
    setTotaleNettoEditato(v - (current?.fattura?.totale_iva ?? 0))
  }
  const testataCompleta = !!dataEffettiva && !!numeroDocEffettivo
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
    // Un doppione non ha (né avrà mai) una riga fatture che referenzi
    // queste foto: senza pulirle qui restano per sempre nel bucket, non
    // raggiungibili da nessun'altra parte dell'app. Vale anche in
    // ri-scansione: current.foto_paths qui sono SEMPRE quelle appena
    // ricaricate da handleElabora, mai le originali della fattura (che
    // restano intoccate finché il salvataggio non le sostituisce).
    if (current?.duplicato && current.foto_paths.length > 0) {
      createClient().storage.from('fatture_foto').remove(current.foto_paths).catch(() => {})
    }
    if (ultimaDelBatch) { onFinished(); return }
    setCurrentIndex(i => i + 1)
    setResolved(new Map())
    setNuoviModificati(new Map())
    setQuantitaModificate(new Map())
    setPrezzoUnitarioModificato(new Map())
    setConfirmingIndex(null)
    setCategoriaDiretta('')
    setDataEditata(null)
    setNumeroDocEditato(null)
    setFornitoreEditato(null)
    setRifiutati(new Set())
    setTotaleLordoEditato(null)
    setTotaleNettoEditato(null)
    setVuotiRitirati(null)
    setError(null)
  }

  // Annulla dalla revisione (fattura corrente o doppione): le foto di
  // questa fattura e di quelle non ancora raggiunte nel batch sono già
  // su storage ma non verranno mai salvate — le fatture precedenti del
  // batch sono già state gestite (salvate, o ripulite se doppioni) da
  // avanti(), quindi non rientrano qui. Vale anche in ri-scansione, per
  // lo stesso motivo di avanti() sopra.
  function annullaRevisione() {
    const daRimuovere = results.slice(currentIndex).flatMap(r => r.foto_paths)
    if (daRimuovere.length > 0) {
      createClient().storage.from('fatture_foto').remove(daRimuovere).catch(() => {})
    }
    onCancel()
  }

  // "Sostituisci quella esistente" sullo schermo di doppione: le foto
  // sono già su storage (current.foto_paths), basta rilanciare la
  // lettura escludendo la fattura già a sistema dal controllo doppioni
  // — esattamente come una ri-scansione, solo che l'id da escludere
  // arriva dal doppione appena trovato invece che dal prop rescan. Se
  // la nuova lettura conferma di nuovo un doppione (es. un terzo
  // documento con lo stesso numero) lo schermo resta identico, stavolta
  // sul nuovo fattura_esistente_id.
  async function sostituisciDoppione() {
    if (!current?.fattura_esistente_id) return
    setRisolvendoDoppione(true)
    setError(null)
    try {
      const resPagine = await fetch('/api/cassa/fatture/estrai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId, foto_paths: current.foto_paths, exclude_fattura_id: current.fattura_esistente_id }),
      })
      const dataPagine = await resPagine.json().catch(() => null)
      if (!resPagine.ok || !dataPagine?.pagine) {
        setError(dataPagine?.error ?? 'Errore nella rilettura della fattura, riprova.')
        return
      }
      const composizione = await chiamaComponi(dataPagine.pagine, current.foto_paths, current.fattura_esistente_id)
      if ('error' in composizione || !composizione.fatture[0]) {
        setError('error' in composizione ? composizione.error : 'Errore nella rilettura della fattura, riprova.')
        return
      }
      const nuovo = composizione.fatture[0]
      if (!nuovo.duplicato) {
        setOverwriteTargets(prev => new Map(prev).set(currentIndex, current.fattura_esistente_id as string))
      }
      setResults(prev => prev.map((r, i) => (i === currentIndex ? nuovo : r)))
    } catch {
      setError('Errore di rete, riprova')
    } finally {
      setRisolvendoDoppione(false)
    }
  }

  async function handleConferma() {
    if (!current || !fornitoreEffettivo) return

    if (current.duplicato) {
      avanti()
      return
    }
    if (!current.fattura || !tuttiRisolti || !testataCompleta) return

    const verificheArticoli = articoli
      .map(a => risoltoInfo(a)?.sospetto)
      .filter((v): v is VerificaSospetta => !!v)

    setSaving(true)
    setError(null)
    try {
      await onComplete({
        foto_paths: current.foto_paths,
        overwrite_fattura_id: overwriteTargets.get(currentIndex),
        fornitore: { ...fornitoreEffettivo, partita_iva: fornitoreEditato ? null : current.fornitore.partita_iva },
        data: dataEffettiva,
        numero_documento: numeroDocEffettivo,
        ha_articoli: current.fattura.ha_articoli,
        categoria_spesa_diretta_id: richiedeCategoriaDiretta ? categoriaDiretta : null,
        iva_dettaglio: current.fattura.iva_dettaglio,
        totale_netto: current.fattura.totale_netto,
        totale_iva: current.fattura.totale_iva,
        totale_lordo: current.fattura.totale_lordo,
        totale_lordo_manuale: totaleLordoEditato,
        totale_netto_manuale: totaleNettoEditato,
        vuoti_ritirati: vuotiRitirati,
        articoli: articoli.map((a, i) => {
          const info = risoltoInfo(a)
          const quantita = quantitaEffettiva(i, a)
          const prezzoRiga = prezzoRigaEffettivo(i, a)
          return info
            ? { testo_estratto: a.testo_estratto, quantita, prezzo_riga: prezzoRiga, catalogo_articolo_id: info.catalogoArticoloId, pagina_indice: a.pagina_indice, riquadro: a.riquadro }
            : { testo_estratto: a.testo_estratto, quantita, prezzo_riga: prezzoRiga, nuovo_articolo: datiNuovoArticolo(a), pagina_indice: a.pagina_indice, riquadro: a.riquadro }
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
                Una fattura di <strong>{current.fornitore.nome}</strong> con lo stesso numero documento è già presente a sistema
                {current.fattura_esistente_data && (
                  <> (data <strong>{formatDataIt(current.fattura_esistente_data)}</strong> — se non la trovi in elenco, controlla di essere su quel mese)</>
                )}
                . Non è stata salvata.
              </p>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2 pt-2">
            <Button type="button" variant="outline" onClick={annullaRevisione} disabled={risolvendoDoppione}>Annulla</Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={sostituisciDoppione} disabled={risolvendoDoppione}>
                {risolvendoDoppione ? <><Loader2 className="h-4 w-4 animate-spin" /> Rilettura…</> : 'Sostituisci quella esistente'}
              </Button>
              <Button type="button" onClick={avanti} disabled={risolvendoDoppione}>{ultimaDelBatch ? 'Chiudi' : 'Fattura successiva'}</Button>
            </div>
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
          <div className="space-y-1">
            <Label className="text-xs font-normal">Fornitore</Label>
            <div className="flex items-center gap-2">
              <Select
                value={fornitoreEffettivo?.id ?? ''}
                onValueChange={id => {
                  const f = fornitori.find(x => x.id === id)
                  if (!f) return
                  setFornitoreEditato({ id: f.id, nome: f.nome })
                  setResolved(new Map())
                  setNuoviModificati(new Map())
                  setRifiutati(new Set())
                  setConfirmingIndex(null)
                }}
              >
                <SelectTrigger className="h-8 w-auto min-w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {!fornitori.some(f => f.id === current.fornitore.id) && (
                    <SelectItem value={current.fornitore.id}>{current.fornitore.nome} (nuovo)</SelectItem>
                  )}
                  {fornitori.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              {!fornitoreEditato && current.fornitore.nuovo && <Badge variant="secondary">nuovo</Badge>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="space-y-1">
              <Label className={cn('text-xs font-normal', (verificheFattura.some(v => v.campo === 'data') || !dataEffettiva) && 'text-amber-600 dark:text-amber-400 font-medium')}>Data</Label>
              <Input type="date" value={dataEffettiva} onChange={e => setDataEditata(e.target.value)} className="h-8 cassa-numeric" />
            </div>
            <div className="space-y-1">
              <Label className={cn('text-xs font-normal', !numeroDocEffettivo && 'text-amber-600 dark:text-amber-400 font-medium')}>Documento</Label>
              <Input value={numeroDocEffettivo} onChange={e => setNumeroDocEditato(e.target.value)} className="h-8 cassa-numeric" placeholder="Numero documento" />
            </div>
          </div>
          {!testataCompleta && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 pt-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {!dataEffettiva && !numeroDocEffettivo ? 'Inserisci data e numero documento per poter salvare.' : !dataEffettiva ? 'Inserisci la data per poter salvare.' : 'Inserisci il numero documento per poter salvare.'}
            </p>
          )}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="space-y-1">
              <Label className="text-xs font-normal">Netto</Label>
              <CurrencyInput value={totaleNettoEffettivo} onChange={setTotaleNettoEditato} hideStepper className="h-8 cassa-numeric" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-normal text-muted-foreground">IVA</Label>
              <p className="cassa-numeric flex h-8 items-center text-sm text-muted-foreground">€ {current.fattura.totale_iva.toFixed(2)}</p>
            </div>
            <div className="space-y-1">
              <Label className={cn('text-xs font-normal', verificheFattura.some(v => v.campo === 'totale_lordo') && 'text-amber-600 dark:text-amber-400 font-medium')}>Lordo</Label>
              <CurrencyInput value={totaleLordoEffettivo} onChange={onChangeTotaleLordo} hideStepper className="h-8 cassa-numeric" />
            </div>
          </div>
          <div className="space-y-1 pt-1">
            <Label className="text-xs font-normal">Vuoti ritirati (facoltativo)</Label>
            <CurrencyInput value={vuotiRitirati} onChange={setVuotiRitirati} hideStepper className="h-8 cassa-numeric max-w-32" />
            {!!vuotiRitirati && (
              <p className="text-xs text-muted-foreground">Da pagare € {(totaleLordoEffettivo - vuotiRitirati).toFixed(2)}</p>
            )}
          </div>
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
              const quantita = quantitaEffettiva(i, a)
              const prezzoUnitario = prezzoUnitarioEffettivo(i, a)
              const prezzoRiga = prezzoRigaEffettivo(i, a)
              const modificato = quantitaModificate.has(i) || prezzoUnitarioModificato.has(i)
              // Con quantità/prezzo corretti a mano: stesso oggetto ma con
              // i valori aggiornati, così sia la conferma "è lo stesso"
              // (verifica scostamento lato server) sia il nuovo articolo
              // usano i valori corretti, non quelli originali dell'OCR.
              const aEffettivo = modificato ? { ...a, quantita, prezzo_riga: prezzoRiga } : a
              const info = risoltoInfo(a)
              const nuovoInfo = nuoviModificati.get(a.testo_estratto)
              return (
                <div key={`${a.testo_estratto}-${i}`} className="rounded-md border border-border px-3 py-2 text-sm space-y-2">
                  <p className="truncate">{a.testo_estratto}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <div className="w-16">
                      <CurrencyInput
                        value={quantita}
                        onChange={v => setQuantitaModificate(prev => new Map(prev).set(i, v))}
                        hideStepper
                        className="h-7 text-sm cassa-numeric text-center"
                      />
                    </div>
                    <span className="cassa-numeric text-xs text-muted-foreground whitespace-nowrap">{a.unita_misura ?? ''} ×</span>
                    <div className="w-24">
                      <CurrencyInput
                        value={prezzoUnitario}
                        onChange={v => setPrezzoUnitarioModificato(prev => new Map(prev).set(i, v))}
                        hideStepper
                        className="h-7 text-sm cassa-numeric"
                      />
                    </div>
                    <span className="cassa-numeric text-xs text-muted-foreground whitespace-nowrap">
                      = € {prezzoRiga.toFixed(2)}{modificato && ' · corretto'}
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
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">
                          {a.esito === 'auto_mappato' ? 'già noto' : a.esito === 'chiaro' ? 'abbinato' : 'confermato'}
                        </Badge>
                        {a.candidato_nome && <span className="text-xs text-muted-foreground truncate">{a.candidato_nome}</span>}
                        {(a.esito === 'auto_mappato' || a.esito === 'chiaro') && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setRifiutati(prev => new Set(prev).add(a.testo_estratto))}
                          >
                            Non è questo
                          </Button>
                        )}
                      </div>
                      {info.sospetto && !modificato && (
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
          <Button type="button" variant="outline" onClick={annullaRevisione} disabled={saving}>Annulla</Button>
          <Button type="button" onClick={handleConferma} disabled={!tuttiRisolti || !testataCompleta || saving}>
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
        onConfirm={file => ritagliaIndice !== null ? sostituisciPagina(ritagliaIndice, file) : aggiungiPagina(file)}
        onCancel={() => { setDaRitagliare(null); setRitagliaIndice(null) }}
      />
    )
  }

  return (
    <div className="space-y-4">
      {rescan && (
        <p className="text-xs text-muted-foreground">
          Foto già caricate — ritagliale di nuovo (icona di ritaglio su ogni foto) o sostituiscile prima di rileggere il documento.
        </p>
      )}
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
              {!isPdf && (
                <button
                  type="button"
                  onClick={() => ricroppaPagina(i)}
                  title="Ritaglia di nuovo"
                  className="absolute bottom-1 right-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                >
                  <Crop className="h-3 w-3" />
                </button>
              )}
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
            : `Lettura accurata in corso${progressoLettura && progressoLettura.totale > 1 ? ` (gruppo ${progressoLettura.corrente} di ${progressoLettura.totale})` : ''}, può richiedere qualche decina di secondi — non chiudere la pagina.`}
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
