'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatInTimeZone } from 'date-fns-tz'
import { addDays, format, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import {
  ChevronDown, ChevronLeft, ChevronRight, Plus, RefreshCw, Upload,
  Armchair, Phone, Eye, CheckCircle2, Info, Clock, StickyNote, RotateCcw, User, UserPlus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatoIcona } from '@/components/cassa/PrenotazioneIcona'
import { PrenotazioneStatoDialog } from '@/components/cassa/PrenotazioneStatoDialog'
import { PrenotazioneFormDialog, type BozzaCoda } from '@/components/cassa/PrenotazioneFormDialog'
import { PrenotazioniImportDialog } from '@/components/cassa/PrenotazioniImportDialog'
import { PrenotazioniRiepilogoCodaDialog, type VoceCoda } from '@/components/cassa/PrenotazioniRiepilogoCodaDialog'
import { PassanteDialog } from '@/components/cassa/PassanteDialog'
import {
  costruisciFasce, contaCoperti, formatPax, nomeCompleto, normalizzaOrario,
  dettaglioBambini, FASCE,
} from '@/lib/cassa/prenotazioniAgenda'
import { chiaveCliente } from '@/lib/cassa/prenotazioniImport'
import { cn } from '@/lib/utils'
import { ROLE_LABELS, type Prenotazione, type PrenotazioneServizio, type PrenotazioneStato, type Role } from '@/types'

const TZ = 'Europe/Rome'

// Colore stabile per insegna: due locali (es. Crunch!/Benthos) condividono
// la stessa agenda e durante il servizio bisogna distinguerli a colpo
// d'occhio, non leggendo la sigla. Non dipende dal nome specifico — un
// hash sulla sigla, così qualunque locale futuro ottiene comunque un
// colore diverso da quelli già in uso sullo stesso giorno.
const PALETTE_INSEGNA = [
  { pillola: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300', punto: 'bg-indigo-500' },
  { pillola: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300',         punto: 'bg-rose-500' },
  { pillola: 'bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300',         punto: 'bg-teal-500' },
  { pillola: 'bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300', punto: 'bg-violet-500' },
]

function indiceInsegna(codice: string): number {
  let h = 0
  for (let i = 0; i < codice.length; i++) h = (h * 31 + codice.charCodeAt(i)) >>> 0
  return h % PALETTE_INSEGNA.length
}

function coloreInsegna(codice: string): string {
  return PALETTE_INSEGNA[indiceInsegna(codice)].pillola
}

function puntoInsegna(codice: string): string {
  return PALETTE_INSEGNA[indiceInsegna(codice)].punto
}

interface RestaurantOption { id: string; name: string }
interface InsegnaOption { id: string; restaurant_id: string; codice: string; etichetta: string }

interface Props {
  restaurants:    RestaurantOption[]
  insegne:        InsegnaOption[]
  // Risolta lato server dalla pagina quando l'URL porta ?completa=<id
  // log> (il link della notifica push per una voce in coda): arriva già
  // pronta, non richiede una query dal client dopo l'idratazione.
  bozzaIniziale?: BozzaCoda | null
  // Chi sta guardando l'agenda in questo momento: serve a scrivere "chi"
  // ha segnato l'ultimo cambio stato (seduta/no show/cancellata) sulla
  // prenotazione stessa — nome e ruolo, non solo l'id, perché un join su
  // profiles non sarebbe leggibile da entrambi i ruoli che possono farlo
  // (manager e hostess non si vedono a vicenda via RLS).
  currentUser:    { fullName: string; role: string }
}

function oggiRoma(): string {
  return formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
}

// All'apertura si mostra il servizio in corso: a metà pomeriggio
// interessa già la cena, non il pranzo appena finito.
function servizioCorrente(): PrenotazioneServizio {
  return formatInTimeZone(new Date(), TZ, 'HH:mm') < '17:00' ? 'pranzo' : 'cena'
}

function etichettaGiorno(data: string): string {
  const label = format(parseISO(data), 'EEE, d MMM', { locale: it })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// ── Intestazione di sezione (Confermate / Sedute / No show) ──────────
function Sezione({
  titolo, prenotazioni, aperta, onToggle, children,
}: {
  titolo:       string
  prenotazioni: Prenotazione[]
  aperta:       boolean
  onToggle:     () => void
  children:     React.ReactNode
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aperta}
        className="flex w-full items-center gap-2 rounded-md bg-secondary px-3 py-2 text-left text-secondary-foreground"
      >
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', !aperta && '-rotate-90')} />
        <span className="cassa-display flex-1 text-base">{titolo}</span>
        <span className="cassa-numeric text-sm text-muted-foreground">
          {prenotazioni.length} / {contaCoperti(prenotazioni)}
        </span>
      </button>
      {aperta && <div className="mt-2 space-y-2">{children}</div>}
    </section>
  )
}

// ── Riga prenotazione ────────────────────────────────────────────────
function RigaPrenotazione({
  p, etichettaInsegna, espansa, onEspandi, onStato, onAzioneRapida, onDettagli, onEliminaPassante,
}: {
  p:                  Prenotazione
  etichettaInsegna:   string | null
  espansa:            boolean
  onEspandi:          () => void
  onStato:            () => void
  onAzioneRapida:     () => void
  onDettagli:         () => void
  // Solo per un passante (p.passante === true): l'unica interazione che
  // ha, al posto di tutto il resto — non è una prenotazione, non si
  // espande, non torna "confermata".
  onEliminaPassante?: () => void
}) {
  // Un passante non è una prenotazione vera: niente orario, insegna,
  // sconto o note da mostrare, niente scheda da aprire. L'icona a
  // sinistra dice comunque lo stato (seduto/cancellato, stessi colori di
  // sempre) ma il tocco fa un'unica cosa — cancellarlo — finché non lo è
  // già.
  if (p.passante) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3 p-3">
          <button
            type="button"
            onClick={p.stato === 'eliminata' ? undefined : onEliminaPassante}
            disabled={p.stato === 'eliminata'}
            aria-label={p.stato === 'eliminata' ? 'Passante cancellato' : 'Elimina passante'}
            className="disabled:cursor-default"
          >
            <StatoIcona stato={p.stato} origine={p.origine} scontoPercentuale={null} />
          </button>
          <div className="min-w-0 flex-1 font-medium leading-tight">Passante</div>
          <div className="shrink-0 text-right leading-none">
            <span className="cassa-numeric text-lg font-semibold">{formatPax(p)}</span>
            <span className="ml-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">pax</span>
          </div>
        </div>
      </div>
    )
  }

  // Da confermata l'azione ovvia è far sedere il cliente; da seduta
  // l'unica utile è tornare indietro (tavolo liberato per sbaglio); da
  // cancellata l'unica sensata è ripristinarla — "Seduta" sarebbe
  // fuorviante lì, l'etichetta deve dire cosa fa davvero il tasto.
  const azione =
    p.stato === 'seduta'    ? { label: 'Confermata', icona: <CheckCircle2 className="h-4 w-4" /> } :
    p.stato === 'eliminata' ? { label: 'Ripristina',  icona: <RotateCcw className="h-4 w-4" /> } :
                               { label: 'Seduta',      icona: <Armchair className="h-4 w-4" /> }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-start gap-3 p-3">
        <button type="button" onClick={onStato} aria-label={`Cambia stato di ${nomeCompleto(p)}`}>
          <StatoIcona stato={p.stato} origine={p.origine} scontoPercentuale={p.sconto_percentuale} />
        </button>

        <button type="button" onClick={onEspandi} className="min-w-0 flex-1 text-left">
          <div className="break-words font-medium leading-tight">{nomeCompleto(p)}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="cassa-numeric">{normalizzaOrario(p.orario)}</span>
            {etichettaInsegna && (
              <span className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                p.insegna ? coloreInsegna(p.insegna) : 'bg-secondary text-secondary-foreground'
              )}>
                {etichettaInsegna}
              </span>
            )}
            {dettaglioBambini(p) && <span>· {dettaglioBambini(p)}</span>}
            {p.sconto_percentuale != null && (
              <span className="font-medium text-[hsl(var(--cassa-copper))]">
                −{p.sconto_percentuale}% di sconto
              </span>
            )}
          </div>
        </button>

        <div className="shrink-0 text-right leading-none">
          <span className="cassa-numeric text-lg font-semibold">{formatPax(p)}</span>
          <span className="ml-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">pax</span>
        </div>
      </div>

      {espansa && (
        <div>
          {/* La nota del cliente non sta nella riga compatta: si vede
              solo qui, ad espansione avvenuta, e solo quando c'è
              davvero — è quello che fa crescere il riquadro di poco
              invece che di una riga fissa per tutti. */}
          {p.note && (
            <div className="flex items-start gap-2 border-t border-border bg-secondary/50 px-3 py-2 text-sm text-secondary-foreground">
              <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="break-words">{p.note}</span>
            </div>
          )}

          {/* Chi ha fatto l'ultimo cambio stato (seduta/no show/cancellata)
              e con quale ruolo — assente sulle prenotazioni mai toccate a
              mano (es. ancora "confermata" da quando è arrivata via mail). */}
          {p.stato_modificato_da_nome && (
            <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <User className="h-3.5 w-3.5 shrink-0" />
              <span>
                {p.stato_modificato_da_nome}
                {p.stato_modificato_da_ruolo && (
                  <> · {ROLE_LABELS[p.stato_modificato_da_ruolo as Role] ?? p.stato_modificato_da_ruolo}</>
                )}
              </span>
            </div>
          )}

          <div className="grid grid-cols-3 divide-x divide-primary-foreground/20 bg-primary text-primary-foreground">
            <button
              type="button"
              onClick={onAzioneRapida}
              className="flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium hover:bg-primary/90"
            >
              {azione.icona} {azione.label}
            </button>

            {p.telefono ? (
              <a
                href={`tel:${p.telefono.replace(/\s/g, '')}`}
                className="flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium hover:bg-primary/90"
              >
                <Phone className="h-4 w-4" /> Contattare
              </a>
            ) : (
              <span
                className="flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium opacity-50"
                title="Nessun recapito nella prenotazione"
              >
                <Phone className="h-4 w-4" /> Contattare
              </span>
            )}

            <button
              type="button"
              onClick={onDettagli}
              className="flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium hover:bg-primary/90"
            >
              <Eye className="h-4 w-4" /> Dettagli
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function PrenotazioniClient({ restaurants, insegne, bozzaIniziale, currentUser }: Props) {
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? '')
  const [data, setData] = useState(oggiRoma)
  const [servizio, setServizio] = useState<PrenotazioneServizio>(servizioCorrente)

  const [giornata, setGiornata] = useState<Prenotazione[]>([])
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState<string | null>(null)

  const [aperte, setAperte] = useState({ confermate: true, sedute: true, cancellate: false, noShow: false })
  const [espansa, setEspansa] = useState<string | null>(null)

  const [statoTarget, setStatoTarget] = useState<Prenotazione | null>(null)
  const [formAperto, setFormAperto] = useState(false)
  const [formIniziale, setFormIniziale] = useState<{ data: string; orario: string } | null>(null)
  const [formPrenotazione, setFormPrenotazione] = useState<Prenotazione | null>(null)
  const [formBozza, setFormBozza] = useState<BozzaCoda | null>(null)
  // Cresce a ogni apertura e fa da key al dialog: il form riparte sempre
  // dai dati giusti senza doverli risincronizzare con un effetto.
  const [formSeq, setFormSeq] = useState(0)
  const [importAperto, setImportAperto] = useState(false)
  const [riepilogoAperto, setRiepilogoAperto] = useState(false)
  const [passanteAperto, setPassanteAperto] = useState(false)
  const [codaVoci, setCodaVoci] = useState<VoceCoda[]>([])

  const [sincronizzando, setSincronizzando] = useState(false)
  const [avviso, setAvviso] = useState<string | null>(null)

  const insegneLocale = useMemo(
    () => insegne.filter(i => i.restaurant_id === restaurantId),
    [insegne, restaurantId]
  )
  // Sempre visibile quando c'è: Crunch! e Benthos condividono la stessa
  // agenda, quindi da quale delle due arriva il cliente è informazione di
  // servizio, non un dettaglio.
  const etichettaInsegna = useCallback(
    (codice: string | null) => {
      if (!codice) return null
      return insegneLocale.find(i => i.codice === codice)?.etichetta ?? codice
    },
    [insegneLocale]
  )

  // Si carica l'intera giornata, non il solo servizio selezionato: serve
  // per poter dire "a pranzo non c'è nulla, ma a cena ci sono 7
  // prenotazioni" invece di mostrare una pagina vuota che sembra un
  // guasto. In più cambiare servizio non richiede una nuova query.
  const carica = useCallback(async () => {
    if (!restaurantId) { setGiornata([]); setCaricamento(false); return }
    const supabase = createClient()
    const { data: righe, error } = await supabase
      .from('prenotazioni')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('data', data)
      .order('orario')
    setErrore(error?.message ?? null)
    setGiornata((righe ?? []) as Prenotazione[])
    setCaricamento(false)
  }, [restaurantId, data])

  useEffect(() => { setCaricamento(true); carica() }, [carica])

  // Tutte le prenotazioni "in coda" (nome e data noti, manca solo
  // l'orario) su TUTTI i locali gestiti, comprese le date future — non
  // solo quella aperta in agenda in questo momento. Alimenta sia la
  // stringa sopra il titolo sia, quando aperto, il riepilogo sfogliabile
  // per giorno.
  //
  // Una voce può risultare già risolta senza che il log lo sappia: un
  // completamento fatto ricreando la prenotazione a mano invece che dal
  // tasto "Completa", o un aggiornamento del log che per qualche motivo
  // non è andato a buon fine dopo l'inserimento. Se esiste già una
  // prenotazione confermata con lo stesso giorno e cliente è un
  // doppione, non va mostrata — e si chiude anche il log, così non
  // ricompare al giro successivo e non serve rifare questo controllo
  // ogni volta.
  const caricaCoda = useCallback(async () => {
    if (restaurants.length === 0) { setCodaVoci([]); return }
    const supabase = createClient()
    const { data: righe } = await supabase
      .from('prenotazioni_email_log')
      .select('id, payload')
      .eq('esito', 'incompleta')
      .in('payload->parziale->>restaurant_id', restaurants.map(r => r.id))
    const voci = ((righe ?? []) as { id: string; payload: { parziale?: BozzaCoda | null } | null }[])
      .map(r => (r.payload?.parziale ? { logId: r.id, voce: { ...r.payload.parziale, logId: r.id } } : null))
      .filter((x): x is VoceCoda => x !== null)

    if (voci.length === 0) { setCodaVoci([]); return }

    const giorni = [...new Set(voci.map(v => v.voce.data))]
    const { data: esistenti } = await supabase
      .from('prenotazioni')
      .select('id, restaurant_id, data, nome, cognome, persone')
      .in('restaurant_id', restaurants.map(r => r.id))
      .in('data', giorni)
      .neq('stato', 'eliminata')

    // Stesso giorno e stesso cliente ma PAX diversi non è un doppione: è
    // una modifica coperti arrivata dopo che la prenotazione era già
    // stata completata — chiuderla in automatico perderebbe quel dato,
    // quindi resta visibile in coda perché il manager la controlli.
    const mappaEsistenti = new Map<string, { id: string; persone: number }>()
    for (const e of (esistenti ?? []) as { id: string; restaurant_id: string; data: string; nome: string; cognome: string | null; persone: number }[]) {
      mappaEsistenti.set(`${e.restaurant_id}|${e.data}|${chiaveCliente(e.nome, e.cognome)}`, { id: e.id, persone: e.persone })
    }

    const risolte: { logId: string; prenotazioneId: string }[] = []
    const daMostrare = voci.filter(v => {
      const trovata = mappaEsistenti.get(
        `${v.voce.restaurant_id}|${v.voce.data}|${chiaveCliente(v.voce.nome, v.voce.cognome)}`
      )
      if (trovata && trovata.persone === v.voce.persone) {
        risolte.push({ logId: v.logId, prenotazioneId: trovata.id })
        return false
      }
      return true
    })

    setCodaVoci(daMostrare)

    if (risolte.length > 0) {
      await Promise.all(
        risolte.map(({ logId, prenotazioneId }) =>
          supabase
            .from('prenotazioni_email_log')
            .update({ esito: 'importata', prenotazione_id: prenotazioneId })
            .eq('id', logId)
        )
      )
    }
  }, [restaurants])

  useEffect(() => { caricaCoda() }, [caricaCoda])

  // Le prenotazioni arrivano anche da fuori app (il cron che legge la
  // casella): senza realtime l'agenda resterebbe ferma sullo stato del
  // momento in cui è stata aperta, proprio durante il servizio. La coda
  // si riallinea alla stessa notifica: una nuova prenotazione confermata
  // può risolvere un doppione ancora in coda.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('prenotazioni_agenda')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prenotazioni' }, () => { carica(); caricaCoda() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [carica, caricaCoda])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('prenotazioni_coda')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prenotazioni_email_log' }, () => caricaCoda())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [caricaCoda])

  const prenotazioni = useMemo(() => giornata.filter(p => p.servizio === servizio), [giornata, servizio])
  // Quante ne ha l'altro servizio dello stesso giorno: è l'informazione
  // che trasforma "non vedo niente" in "stai guardando il servizio
  // sbagliato".
  const altroServizio: PrenotazioneServizio = servizio === 'cena' ? 'pranzo' : 'cena'
  const nAltroServizio = useMemo(
    () => giornata.filter(p => p.servizio === altroServizio).length,
    [giornata, altroServizio]
  )

  const confermate = useMemo(() => prenotazioni.filter(p => p.stato === 'confermata'), [prenotazioni])
  const sedute     = useMemo(() => prenotazioni.filter(p => p.stato === 'seduta'), [prenotazioni])
  const cancellate = useMemo(() => prenotazioni.filter(p => p.stato === 'eliminata'), [prenotazioni])
  const noShow     = useMemo(() => prenotazioni.filter(p => p.stato === 'no_show'), [prenotazioni])

  // Quanti PAX per ciascuna insegna e quanti diretti (Restoo) — coperti,
  // non numero di prenotazioni: un tavolo da 8 pesa come 8 da 1, non come
  // una singola voce nell'elenco. Comprende sia le confermate che le già
  // sedute: far sedere un cliente non lo fa sparire dal servizio, quindi
  // non deve scalare il totale — resta lì finché non se ne va (no show o
  // cancellata). "Dirette" prende Restoo E le prenotazioni inserite a
  // mano (qualunque insegna abbiano — un manuale non passa da TheFork
  // solo perché gli si è assegnata un'insegna, e ci finiscono anche i
  // passanti); Benthos/Crunch! prendono tutto il resto — comprese le
  // importate dal libro visite — diviso per insegna. Così le tre voci
  // sommano sempre esattamente ai coperti totali attivi del servizio,
  // senza una categoria residua per ciò che non trova posto.
  const paxServizio = useMemo(() => {
    let benthos = 0
    let crunch = 0
    let restoo = 0
    for (const p of prenotazioni) {
      if (p.stato !== 'confermata' && p.stato !== 'seduta') continue
      if (p.origine === 'restoo' || p.origine === 'manuale') restoo += p.persone
      else if (p.insegna === 'benthos') benthos += p.persone
      else if (p.insegna === 'crunch') crunch += p.persone
    }
    return { benthos, crunch, restoo }
  }, [prenotazioni])
  const fasce      = useMemo(() => costruisciFasce(servizio, confermate), [servizio, confermate])

  async function cambiaStato(p: Prenotazione, stato: PrenotazioneStato) {
    const supabase = createClient()
    const campi = {
      stato,
      seduta_at: stato === 'seduta' ? new Date().toISOString() : null,
      // Chi ha fatto QUESTO cambio, non chi ha creato la prenotazione —
      // sovrascritto a ogni cambio stato, apposta: conta solo l'ultimo.
      stato_modificato_da_nome:  currentUser.fullName,
      stato_modificato_da_ruolo: currentUser.role,
    }
    const { error } = await supabase
      .from('prenotazioni')
      .update(campi)
      .eq('id', p.id)
    if (error) throw new Error(error.message)
    // Aggiornamento ottimistico: il realtime arriva comunque, ma dopo un
    // giro di rete — durante il servizio il riscontro deve essere subito.
    // Le cancellate restano visibili (sezione dedicata), non vanno più
    // tolte dall'elenco.
    setGiornata(prev => prev.map(x => (x.id === p.id ? { ...x, ...campi } : x)))
    setEspansa(null)
  }

  // Il tavolo entra già seduto: un passante non prenota, arriva e basta.
  // Nessun nome, nessun orario da scegliere — quello scritto è solo
  // "adesso", non organizza nulla (la sezione Sedute non è divisa per
  // fasce come Confermate).
  async function aggiungiPassante(persone: number) {
    const supabase = createClient()
    const { error } = await supabase.from('prenotazioni').insert({
      restaurant_id: restaurantId,
      insegna: insegneLocale[0]?.codice ?? null,
      origine: 'manuale',
      data,
      orario: formatInTimeZone(new Date(), TZ, 'HH:mm'),
      servizio,
      nome: 'Passante',
      cognome: null,
      persone,
      bambini: 0,
      sconto_percentuale: null,
      telefono: null,
      email: null,
      note: null,
      stato: 'seduta',
      seduta_at: new Date().toISOString(),
      passante: true,
      stato_modificato_da_nome:  currentUser.fullName,
      stato_modificato_da_ruolo: currentUser.role,
    })
    if (error) throw new Error(error.message)
    await carica()
  }

  // Unica azione possibile su un passante: cancellarlo (stesso percorso
  // delle altre prenotazioni — stato 'eliminata', non una riga cancellata
  // dal database — così resta comunque nella sezione Cancellate).
  function eliminaPassante(p: Prenotazione) {
    if (!window.confirm(`Eliminare il tavolo da ${p.persone} passanti?`)) return
    cambiaStato(p, 'eliminata').catch(err => setAvviso(err instanceof Error ? err.message : 'Eliminazione non riuscita'))
  }

  async function sincronizza() {
    setSincronizzando(true)
    setAvviso(null)
    try {
      const res = await fetch('/api/cassa/prenotazioni/sync', { method: 'POST' })
      const json = await res.json()
      // La casella Gmail è un ripiego che qui non è mai stato configurato
      // — l'ingresso vero è il webhook in tempo reale — quindi risponde
      // sempre 503 "Casella mail non configurata". Non è un errore da
      // mostrare: il tasto deve comunque fare il suo lavoro, ricaricando
      // agenda e coda da quanto già arrivato. Un problema vero (es. chiave
      // AI mancante) resta segnalato come prima.
      if (res.ok) {
        const parti = [
          json.importate > 0 && `${json.importate} aggiornate`,
          json.incomplete > 0 && `${json.incomplete} da completare (manca l'orario)`,
        ].filter(Boolean)
        setAvviso(parti.length > 0 ? `${parti.join(', ')}.` : 'Nessuna nuova prenotazione nella casella.')
      } else if (json.error !== 'Casella mail non configurata') {
        throw new Error(json.error ?? 'Sincronizzazione non riuscita')
      } else {
        setAvviso('Aggiornato.')
      }
      await Promise.all([carica(), caricaCoda()])
    } catch (err) {
      setAvviso(err instanceof Error ? err.message : 'Sincronizzazione non riuscita')
    } finally {
      setSincronizzando(false)
    }
  }

  function apriNuova(orario: string) {
    setFormPrenotazione(null)
    setFormBozza(null)
    setFormIniziale({ data, orario })
    setFormSeq(n => n + 1)
    setFormAperto(true)
  }

  function apriDettagli(p: Prenotazione) {
    setFormIniziale(null)
    setFormBozza(null)
    setFormPrenotazione(p)
    setFormSeq(n => n + 1)
    setFormAperto(true)
  }

  function completaDaCoda(voce: BozzaCoda) {
    setRiepilogoAperto(false)
    // Il riepilogo raccoglie la coda su tutti i locali: una
    // voce può appartenere a un locale diverso da quello aperto in
    // agenda in questo momento. Si passa a quello giusto prima di aprire
    // il modulo, altrimenti il selettore insegna mostrerebbe le opzioni
    // del locale sbagliato.
    if (voce.restaurant_id !== restaurantId) setRestaurantId(voce.restaurant_id)
    setFormIniziale(null)
    setFormPrenotazione(null)
    setFormBozza(voce)
    setFormSeq(n => n + 1)
    setFormAperto(true)
  }

  // Safari/iOS non mostra pulsanti azione sulle notifiche push (tenerle
  // premute o tirarle giù non offre nulla oltre "Visualizza": limite
  // della piattaforma). Il modo più vicino a "scegli l'orario dalla
  // notifica" è che il link della notifica porti già dritto qui — la
  // route /api/cassa/prenotazioni/webhook e /sync lo costruiscono come
  // ?completa=<id log> — e apra subito il modulo di completamento di
  // QUELLA prenotazione, pronto per scrivere l'orario (il servizio si
  // deduce da solo, non va scelto a parte).
  //
  // La voce arriva già risolta da bozzaIniziale (letta dalla pagina lato
  // server, nella STESSA richiesta che carica la pagina): niente query
  // in più da fare qui dopo l'idratazione, che è quanto rendeva lenta
  // l'apertura toccando la notifica — specialmente aprendo l'app da
  // fredda, con un giro di rete client→server evitato del tutto.
  useEffect(() => {
    if (!bozzaIniziale) return
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.delete('completa')
      window.history.replaceState({}, '', url)
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    completaDaCoda(bozzaIniziale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bozzaIniziale])

  if (restaurants.length === 0) {
    return (
      <div className="mx-auto max-w-3xl p-4 lg:p-8">
        <h1 className="cassa-display text-2xl">Prenotazioni</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Nessun locale ha ancora un libro visite collegato.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 lg:p-8">
      <div>
        {/* Sempre visibile, indipendentemente dal giorno aperto in
            agenda in questo momento: la coda non è legata a "oggi". */}
        {codaVoci.length > 0 && (
          <button
            type="button"
            onClick={() => setRiepilogoAperto(true)}
            className="mb-1 flex items-center gap-1.5 text-sm font-medium text-[hsl(var(--cassa-copper))] hover:underline"
          >
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="cassa-numeric">{codaVoci.length}</span> prenotazion{codaVoci.length === 1 ? 'e' : 'i'}{' '}da confermare l&apos;orario
          </button>
        )}
        <h1 className="cassa-display text-2xl">Prenotazioni</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          TheFork e Restoo in un&apos;unica agenda di servizio.
        </p>
      </div>

      {restaurants.length > 1 && (
        <Select value={restaurantId} onValueChange={setRestaurantId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {restaurants.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {/* Barra giorno + servizio: frecce per scorrere i giorni, il tasto
          centrale apre il calendario di sistema, quello a destra alterna
          pranzo e cena. */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Giorno precedente"
          onClick={() => setData(format(addDays(parseISO(data), -1), 'yyyy-MM-dd'))}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <div className="relative min-w-0 flex-1">
          <div className="flex h-9 items-center justify-center rounded-md bg-primary px-2 text-sm font-medium text-primary-foreground">
            {etichettaGiorno(data)}
          </div>
          {/* Input nativo sovrapposto e trasparente: è il modo che apre il
              calendario su tutti i browser, showPicker() incluso iOS. */}
          <input
            type="date"
            aria-label="Scegli il giorno"
            value={data}
            onChange={e => { if (e.target.value) setData(e.target.value) }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>

        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => setServizio(s => (s === 'cena' ? 'pranzo' : 'cena'))}
          title={`${FASCE[servizio].inizio}–${FASCE[servizio].fine} · tocca per cambiare servizio`}
        >
          {servizio === 'cena' ? 'Cena' : 'Pranzo'}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Giorno successivo"
          onClick={() => setData(format(addDays(parseISO(data), 1), 'yyyy-MM-dd'))}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>

        {/* Aggiorna: rilegge la casella dei libri visite e ricarica
            l'agenda. Sta qui, dopo la freccia del giorno successivo,
            perché è il gesto che si fa durante il servizio — non fra le
            azioni di gestione più in basso. */}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label="Aggiorna prenotazioni"
          title="Aggiorna le prenotazioni"
          onClick={sincronizza}
          disabled={sincronizzando}
        >
          <RefreshCw className={cn('h-4 w-4', sincronizzando && 'animate-spin')} />
        </Button>
      </div>

      {/* Stesso peso visivo della barra del calendario sopra: due tasti
          pari invece di una fila di pulsanti di larghezza diversa. */}
      <div className="flex items-center gap-2">
        <Button type="button" className="flex-1" onClick={() => apriNuova(FASCE[servizio].inizio)}>
          <Plus className="h-4 w-4" /> Prenotazione
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={() => setImportAperto(true)}>
          <Upload className="h-4 w-4" /> Importa
        </Button>
        {data !== oggiRoma() && (
          <Button type="button" variant="outline" className="flex-1" onClick={() => setData(oggiRoma())}>
            Oggi
          </Button>
        )}
      </div>

      {avviso && <p className="text-sm text-muted-foreground">{avviso}</p>}
      {errore && <p className="text-sm text-destructive">Errore nel caricamento: {errore}</p>}

      {!caricamento && prenotazioni.length === 0 && nAltroServizio > 0 && (
        <button
          type="button"
          onClick={() => setServizio(altroServizio)}
          className="flex w-full items-center gap-2 rounded-md border border-[hsl(var(--cassa-copper))]/40 bg-[hsl(var(--cassa-copper))]/10 px-3 py-2.5 text-left text-sm"
        >
          <Info className="h-4 w-4 shrink-0 text-[hsl(var(--cassa-copper))]" />
          <span className="flex-1">
            Nessuna prenotazione a {servizio}. Ce ne sono{' '}
            <span className="cassa-numeric font-medium">{nAltroServizio}</span> a {altroServizio}.
          </span>
          <span className="shrink-0 font-medium text-[hsl(var(--cassa-copper))]">
            Vai a {altroServizio}
          </span>
        </button>
      )}

      {caricamento ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {(confermate.length > 0 || sedute.length > 0) && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', puntoInsegna('benthos'))} />
                <span className="cassa-numeric font-medium text-foreground">{paxServizio.benthos}</span> pax {etichettaInsegna('benthos') ?? 'Benthos'}
              </span>
              <span className="flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', puntoInsegna('crunch'))} />
                <span className="cassa-numeric font-medium text-foreground">{paxServizio.crunch}</span> pax {etichettaInsegna('crunch') ?? 'Crunch!'}
              </span>
              <span>
                <span className="cassa-numeric font-medium text-foreground">{paxServizio.restoo}</span> pax dirette (Restoo)
              </span>
            </p>
          )}

          <Sezione
            titolo="Confermate"
            prenotazioni={confermate}
            aperta={aperte.confermate}
            onToggle={() => setAperte(a => ({ ...a, confermate: !a.confermate }))}
          >
            <div>
              {fasce.map(f => (
                <div key={f.orario}>
                  <div className="flex items-center gap-2 border-b border-border/60 py-1.5">
                    <span className={cn('cassa-numeric w-14 text-sm', f.prenotazioni.length === 0 && 'text-muted-foreground')}>
                      {f.orario}
                    </span>
                    {f.fuoriFascia && (
                      <span className="text-[11px] text-muted-foreground">fuori fascia</span>
                    )}
                    <span className="flex-1" />
                    <span className="cassa-numeric text-sm text-muted-foreground">
                      {f.prenotazioni.length} / {f.coperti}
                    </span>
                    <button
                      type="button"
                      onClick={() => apriNuova(f.orario)}
                      aria-label={`Aggiungi prenotazione alle ${f.orario}`}
                      className="-m-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>

                  {f.prenotazioni.length > 0 && (
                    <div className="space-y-2 py-2">
                      {f.prenotazioni.map(p => (
                        <RigaPrenotazione
                          key={p.id}
                          p={p}
                          etichettaInsegna={etichettaInsegna(p.insegna)}
                          espansa={espansa === p.id}
                          onEspandi={() => setEspansa(e => (e === p.id ? null : p.id))}
                          onStato={() => setStatoTarget(p)}
                          onAzioneRapida={() => cambiaStato(p, 'seduta')}
                          onDettagli={() => apriDettagli(p)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Sezione>

          <Sezione
            titolo="Sedute"
            prenotazioni={sedute}
            aperta={aperte.sedute}
            onToggle={() => setAperte(a => ({ ...a, sedute: !a.sedute }))}
          >
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full border-dashed"
              onClick={() => setPassanteAperto(true)}
            >
              <UserPlus className="h-4 w-4" /> Passante
            </Button>

            {sedute.length === 0
              ? <p className="px-1 text-sm text-muted-foreground">Nessun tavolo seduto.</p>
              : sedute.map(p => (
                  <RigaPrenotazione
                    key={p.id}
                    p={p}
                    etichettaInsegna={etichettaInsegna(p.insegna)}
                    espansa={espansa === p.id}
                    onEspandi={() => setEspansa(e => (e === p.id ? null : p.id))}
                    onStato={() => setStatoTarget(p)}
                    onAzioneRapida={() => cambiaStato(p, 'confermata')}
                    onDettagli={() => apriDettagli(p)}
                    onEliminaPassante={() => eliminaPassante(p)}
                  />
                ))}
          </Sezione>

          {cancellate.length > 0 && (
            <Sezione
              titolo="Cancellate"
              prenotazioni={cancellate}
              aperta={aperte.cancellate}
              onToggle={() => setAperte(a => ({ ...a, cancellate: !a.cancellate }))}
            >
              {cancellate.map(p => (
                <RigaPrenotazione
                  key={p.id}
                  p={p}
                  etichettaInsegna={etichettaInsegna(p.insegna)}
                  espansa={espansa === p.id}
                  onEspandi={() => setEspansa(e => (e === p.id ? null : p.id))}
                  onStato={() => setStatoTarget(p)}
                  onAzioneRapida={() => cambiaStato(p, 'confermata')}
                  onDettagli={() => apriDettagli(p)}
                />
              ))}
            </Sezione>
          )}

          {noShow.length > 0 && (
            <Sezione
              titolo="No show"
              prenotazioni={noShow}
              aperta={aperte.noShow}
              onToggle={() => setAperte(a => ({ ...a, noShow: !a.noShow }))}
            >
              {noShow.map(p => (
                <RigaPrenotazione
                  key={p.id}
                  p={p}
                  etichettaInsegna={etichettaInsegna(p.insegna)}
                  espansa={espansa === p.id}
                  onEspandi={() => setEspansa(e => (e === p.id ? null : p.id))}
                  onStato={() => setStatoTarget(p)}
                  onAzioneRapida={() => cambiaStato(p, 'seduta')}
                  onDettagli={() => apriDettagli(p)}
                />
              ))}
            </Sezione>
          )}
        </div>
      )}

      <PrenotazioneStatoDialog
        prenotazione={statoTarget}
        onOpenChange={open => { if (!open) setStatoTarget(null) }}
        onCambiaStato={cambiaStato}
      />

      <PrenotazioneFormDialog
        key={formSeq}
        open={formAperto}
        onOpenChange={setFormAperto}
        restaurantId={restaurantId}
        insegne={insegneLocale}
        iniziale={formIniziale}
        prenotazione={formPrenotazione}
        bozza={formBozza}
        onSalvata={carica}
      />

      <PrenotazioniImportDialog
        open={importAperto}
        onOpenChange={setImportAperto}
        restaurantId={restaurantId}
        onImportate={n => { setAvviso(`${n} prenotazioni importate.`); carica() }}
      />

      <PrenotazioniRiepilogoCodaDialog
        open={riepilogoAperto}
        onOpenChange={setRiepilogoAperto}
        voci={codaVoci}
        restaurants={restaurants}
        insegne={insegne}
        onCompleta={completaDaCoda}
        onCambiato={caricaCoda}
      />

      <PassanteDialog open={passanteAperto} onOpenChange={setPassanteAperto} onConferma={aggiungiPassante} />
    </div>
  )
}
