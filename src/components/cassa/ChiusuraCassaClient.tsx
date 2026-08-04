'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CurrencyInput } from '@/components/ui/currency-input'
import { CountInput } from '@/components/ui/count-input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { X, Loader2 } from 'lucide-react'
import { SpeseFase } from '@/components/cassa/SpeseFase'
import { QuadraturaFase } from '@/components/cassa/QuadraturaFase'
import type { CassaChiusura } from '@/types'

const TZ = 'Europe/Rome'

interface RestaurantOption {
  id: string
  name: string
}

interface Bozza {
  id: string
  restaurant_id: string
  data: string
}

interface Props {
  role: 'manager' | 'cassiere'
  restaurants: RestaurantOption[]
  fixedRestaurantId: string | null
  userId: string
}

const emptyFields = () => ({
  fondoCassaIniziale: 0,
  entrateContanti: 0,
  entratePos: 0,
  entrateBonifico: 0,
  coperti: 0,
  incassoAsporto: 0,
  fondoCassaFinale: 0,
  contantiPerBanca: 0,
})

// Campi "obbligatori": zero è un valore legittimo per molti di questi (es.
// Entrate Bonifico, Incasso Asporto), quindi "obbligatorio" non vuol dire
// "diverso da zero" — vuol dire che l'operatore deve averlo digitato
// esplicitamente (anche uno 0), non lasciato al default mai toccato. Gli
// onChange di CurrencyInput/CountInput scattano solo dopo un parsing
// riuscito in blur (mai su un blur senza digitazione), quindi sono già il
// segnale giusto per marcare un campo come compilato.
const FASE1_FIELDS = ['entrateContanti', 'entratePos', 'entrateBonifico', 'coperti', 'incassoAsporto', 'fondoCassaFinale'] as const
const FASE3_FIELDS = ['contantiPerBanca'] as const
const ALL_FIELDS = [...FASE1_FIELDS, 'fondoCassaIniziale', ...FASE3_FIELDS] as const

// Chi chiude cassa dopo mezzanotte (fino alle 3 circa) sta quasi sempre
// ancora completando il servizio del giorno PRIMA — il locale resta
// aperto oltre la mezzanotte — non quello appena scattato per
// calendario. Precompilare con la data "di oggi" in quella fascia
// porterebbe la chiusura sulla data sbagliata di default.
function dataChiusuraDiDefault(): string {
  const ora = new Date()
  const oraLocale = Number(formatInTimeZone(ora, TZ, 'H'))
  const giorno = oraLocale < 3 ? new Date(ora.getTime() - 24 * 60 * 60 * 1000) : ora
  return formatInTimeZone(giorno, TZ, 'yyyy-MM-dd')
}

function formatDataBreve(data: string): string {
  const label = formatInTimeZone(`${data}T12:00:00Z`, TZ, 'd MMM', { locale: it })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function ChiusuraCassaClient({ role, restaurants, fixedRestaurantId, userId }: Props) {
  // "Modifica" da Lista Chiusure arriva qui con ?restaurant_id=&data= per
  // riaprire il wizard precompilato sulla chiusura esistente (Fase 1 la
  // carica normalmente, come per una data qualunque).
  const searchParams = useSearchParams()
  const editRestaurantId = searchParams.get('restaurant_id')
  const editDate = searchParams.get('data')

  const [fase, setFase] = useState<1 | 2 | 3>(1)
  const [restaurantId, setRestaurantIdRaw] = useState(
    editRestaurantId ?? fixedRestaurantId ?? (restaurants.length === 1 ? restaurants[0].id : '')
  )
  const [date, setDate] = useState(() => editDate ?? dataChiusuraDiDefault())

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [existing, setExisting] = useState<CassaChiusura | null>(null)
  const [fields, setFields] = useState(emptyFields())
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [bozzeInSospeso, setBozzeInSospeso] = useState<Bozza[]>([])

  // Cambiare ristorante è sempre "vai a un'altra chiusura" — a differenza
  // di cambiare solo la data (vedi sotto), qui è corretto azzerare la
  // chiusura eventualmente già caricata e farne cercare una nuova.
  function selectRestaurant(id: string) {
    setRestaurantIdRaw(id)
    setExisting(null)
  }

  // Bozze (stato 'in_verifica') su uno qualsiasi dei ristoranti visibili a
  // questo utente — restaurants è già scoped correttamente lato server
  // (un solo ristorante per il cassiere, tutti i gestiti per il manager),
  // qui basta filtrare per quegli id senza dover ricalcolare i permessi.
  const restaurantIds = useMemo(() => restaurants.map(r => r.id), [restaurants])
  const loadBozze = useCallback(async () => {
    if (restaurantIds.length === 0) { setBozzeInSospeso([]); return }
    const supabase = createClient()
    const { data } = await supabase
      .from('cassa_chiusure')
      .select('id, restaurant_id, data')
      .in('restaurant_id', restaurantIds)
      .eq('stato', 'in_verifica')
      .order('data', { ascending: false })
    setBozzeInSospeso((data ?? []) as Bozza[])
  }, [restaurantIds])

  useEffect(() => { loadBozze() }, [loadBozze])

  // Una bozza può cambiare da un'altra sessione (un altro cassiere, o lo
  // stesso su un altro dispositivo) — tiene l'elenco aggiornato senza bisogno
  // di ricaricare la pagina.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('cassa_chiusure_bozze_sospese')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cassa_chiusure' }, () => loadBozze())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadBozze])

  // Riapre il wizard esattamente da dove si era rimasti: stessi
  // ristorante+data della bozza, così loadChiusura (sotto) ritrova il
  // record esistente e ripopola i campi già inseriti — non un semplice
  // collegamento, la stessa identica logica usata quando si cambiano
  // manualmente ristorante/data.
  function apriBozza(b: Bozza) {
    setRestaurantIdRaw(b.restaurant_id)
    setDate(b.data)
    setExisting(null)
    setFase(1)
  }

  // Dialog di conferma in-app invece di window.confirm() — stesso motivo
  // di ListaChiusureClient: alcuni browser mobile/PWA sopprimono i dialog
  // nativi sincroni.
  const [bozzaDaEliminare, setBozzaDaEliminare] = useState<Bozza | null>(null)
  const [eliminandoBozza, setEliminandoBozza] = useState(false)
  const [deleteBozzaError, setDeleteBozzaError] = useState<string | null>(null)

  async function confermaEliminaBozza() {
    if (!bozzaDaEliminare) return
    const id = bozzaDaEliminare.id
    setEliminandoBozza(true)
    setDeleteBozzaError(null)
    const supabase = createClient()
    const { error } = await supabase.from('cassa_chiusure').delete().eq('id', id)
    setEliminandoBozza(false)
    if (error) { setDeleteBozzaError(error.message); return }
    setBozzeInSospeso(prev => prev.filter(b => b.id !== id))
    // Se si stava eliminando la bozza attualmente aperta a schermo, il
    // wizard non deve restare a mostrare dati appena cancellati.
    if (existing?.id === id) {
      setExisting(null)
      setFields(emptyFields())
      setTouched(new Set())
      setFase(1)
    }
    setBozzaDaEliminare(null)
  }

  useEffect(() => {
    if (editRestaurantId) { setRestaurantIdRaw(editRestaurantId); setExisting(null) }
    if (editDate) { setDate(editDate); setExisting(null) }
  }, [editRestaurantId, editDate])

  function markTouched(name: string) {
    setTouched(prev => (prev.has(name) ? prev : new Set(prev).add(name)))
  }

  const loadChiusura = useCallback(async () => {
    if (!restaurantId || !date) return
    setLoading(true)
    const supabase = createClient()

    const { data: row } = await supabase
      .from('cassa_chiusure')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('data', date)
      .maybeSingle()

    if (row) {
      setExisting(row)
      setFields({
        fondoCassaIniziale: row.fondo_cassa_iniziale,
        entrateContanti: row.entrate_contanti,
        entratePos: row.entrate_pos,
        entrateBonifico: row.entrate_bonifico,
        coperti: row.coperti,
        incassoAsporto: row.incasso_asporto,
        fondoCassaFinale: row.fondo_cassa_finale,
        contantiPerBanca: row.contanti_per_banca,
      })
      // Chiusura già esistente: i valori arrivano dal database, non da
      // digitazione dell'operatore in questa sessione — contano già come
      // compilati (altrimenti riaprire una chiusura per modificarla
      // bloccherebbe "Avanti" finché non si ritoccano tutti i campi).
      setTouched(new Set(ALL_FIELDS))
      setLoading(false)
      return
    }

    setExisting(null)
    setTouched(new Set())

    // Nessuna chiusura per questa data: replica lato client la stessa
    // logica del trigger precompila_fondo, cosi' il valore corretto e'
    // gia' visibile prima ancora del primo salvataggio.
    const { data: prev } = await supabase
      .from('cassa_chiusure')
      .select('fondo_cassa_finale')
      .eq('restaurant_id', restaurantId)
      .lt('data', date)
      .order('data', { ascending: false })
      .limit(1)
      .maybeSingle()

    setFields({ ...emptyFields(), fondoCassaIniziale: prev?.fondo_cassa_finale ?? 0 })
    setLoading(false)
  }, [restaurantId, date])

  // Cerca/precompila SOLO finché non c'è già una chiusura caricata: una
  // volta che existing è valorizzato (bozza in corso, o chiusura aperta
  // per modificarla), toccare qui il campo Data serve a CORREGGERLA su
  // quel record al prossimo salvataggio (vedi handleAvanti) — non a
  // spostarsi a cercarne/crearne un'altra, altrimenti i dati già
  // caricati (spese comprese) sparirebbero dal form come se non
  // fossero mai stati salvati.
  useEffect(() => {
    if (existing) return
    loadChiusura()
  }, [loadChiusura, existing])

  useEffect(() => {
    if (!restaurantId) { setOwnerId(null); return }
    const supabase = createClient()
    supabase.from('restaurants').select('owner_id').eq('id', restaurantId).single()
      .then(({ data }) => setOwnerId(data?.owner_id ?? null))
  }, [restaurantId])

  // Aggiorna in tempo reale i campi calcolati dal trigger (totale spese,
  // banca teorica, differenza) quando cambiano le spese collegate.
  useEffect(() => {
    if (!existing?.id) return
    const supabase = createClient()
    const channel = supabase
      .channel(`cassa_chiusura_${existing.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cassa_chiusure', filter: `id=eq.${existing.id}` },
        (payload) => setExisting(payload.new as CassaChiusura)
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [existing?.id])

  const totaleEntrate = fields.entrateContanti + fields.entratePos + fields.entrateBonifico
  const mediaScontrino = fields.coperti === 0
    ? null
    : (totaleEntrate - fields.incassoAsporto) / fields.coperti

  const fondoIniziale_editabile = fields.fondoCassaIniziale === 0
  const fase1RequiredFields = fondoIniziale_editabile ? [...FASE1_FIELDS, 'fondoCassaIniziale'] : FASE1_FIELDS
  const fase1Complete = fase1RequiredFields.every(f => touched.has(f))
  const isConfermata = existing?.stato === 'confermata'
  // Bozza (nuova o non ancora confermata): Fase 1 salva incrementalmente.
  // Chiusura già confermata: Fase 1 è solo navigazione, il salvataggio
  // (diretto o via richiesta di approvazione) avviene in Fase 3.
  const isDraftFlow = !isConfermata

  const dataCorretta = !!existing && date !== existing.data

  async function handleAvanti() {
    if (!restaurantId || !date || !fase1Complete) return

    // Una chiusura già confermata è un record "ufficiale": correggerne
    // la data (a differenza delle altre correzioni Fase 1, che passano
    // dall'approvazione in Fase 3) resta riservata al manager — il
    // campo è comunque disabilitato per il cassiere in quel caso, qui è
    // solo una seconda barriera.
    if (dataCorretta && isConfermata && role !== 'manager') {
      alert('Solo un manager può correggere la data di una chiusura già confermata.')
      return
    }

    if (!isDraftFlow) {
      if (dataCorretta) {
        setSaving(true)
        const supabase = createClient()
        const { data, error } = await supabase
          .from('cassa_chiusure')
          .update({ data: date, updated_by: userId })
          .eq('id', existing!.id)
          .select()
          .single()
        setSaving(false)
        if (error || !data) {
          alert(error?.code === '23505' ? 'Esiste già una chiusura per questa data.' : `Errore nel salvataggio: ${error?.message ?? 'sconosciuto'}`)
          return
        }
        setExisting(data)
      }
      setFase(2)
      return
    }

    setSaving(true)
    const supabase = createClient()

    const basePayload = {
      restaurant_id: restaurantId,
      data: date,
      fondo_cassa_iniziale: fields.fondoCassaIniziale,
      entrate_contanti: fields.entrateContanti,
      entrate_pos: fields.entratePos,
      entrate_bonifico: fields.entrateBonifico,
      coperti: fields.coperti,
      incasso_asporto: fields.incassoAsporto,
      fondo_cassa_finale: fields.fondoCassaFinale,
      contanti_per_banca: fields.contantiPerBanca,
      updated_by: userId,
    }

    // Se un record è già caricato (bozza in corso, o una chiusura
    // aperta per correggerne la data) si aggiorna SEMPRE per id, mai
    // tramite upsert sulla chiave naturale (restaurant_id, data): se la
    // data è stata corretta, un upsert per chiave naturale cercherebbe
    // o creerebbe un'altra riga invece di correggere quella su cui si
    // sta lavorando, lasciando indietro un doppione con i dati vecchi.
    const { data, error } = existing
      ? await supabase.from('cassa_chiusure').update(basePayload).eq('id', existing.id).select().single()
      : await supabase.from('cassa_chiusure').upsert({ ...basePayload, stato: 'in_verifica' as const, created_by: userId }, { onConflict: 'restaurant_id,data' }).select().single()

    setSaving(false)
    if (error || !data) {
      alert(error?.code === '23505' ? 'Esiste già una chiusura per questa data.' : `Errore nel salvataggio: ${error?.message ?? 'sconosciuto'}`)
      return
    }
    setExisting(data)
    setFase(2)
  }

  const selectedRestaurantName = restaurants.find(r => r.id === restaurantId)?.name

  // Non ha senso proporre come "bozza da riprendere" quella già aperta a
  // schermo in questo momento.
  const altreBozze = bozzeInSospeso.filter(b => !(b.restaurant_id === restaurantId && b.data === date))

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      {altreBozze.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {altreBozze.map(b => (
            <div key={b.id} className="inline-flex h-8 items-center rounded-full border border-border bg-background pl-3.5 pr-1.5 text-sm font-medium">
              <button
                type="button"
                onClick={() => apriBozza(b)}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
              >
                {restaurants.find(r => r.id === b.restaurant_id)?.name ?? '—'} · {formatDataBreve(b.data)}
              </button>
              <button
                type="button"
                onClick={() => setBozzaDaEliminare(b)}
                aria-label="Elimina bozza"
                className="ml-1 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="cassa-display text-2xl">Chiusura Cassa</h1>
          <p className="text-muted-foreground text-sm mt-1">Fase {fase} di 3</p>
        </div>
        {existing && (
          <Badge
            variant={isConfermata ? undefined : 'secondary'}
            className={isConfermata ? 'border-transparent bg-cassa-copper text-cassa-copper-foreground hover:bg-cassa-copper/90' : undefined}
          >
            {isConfermata ? '✓ Confermata' : 'Bozza'}
          </Badge>
        )}
      </div>

      <Card className="cassa-perforated-top mb-4">
        <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Ristorante</Label>
            {role === 'cassiere' ? (
              <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                {selectedRestaurantName ?? 'Nessun ristorante assegnato'}
              </div>
            ) : (
              <Select value={restaurantId} onValueChange={selectRestaurant}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona un ristorante" />
                </SelectTrigger>
                <SelectContent>
                  {restaurants.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Data</Label>
            <Input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              disabled={isConfermata && role !== 'manager'}
            />
            {isConfermata && role !== 'manager' && (
              <p className="text-xs text-muted-foreground">Solo un manager può correggere la data di una chiusura già confermata.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {!restaurantId && (
        <p className="text-sm text-muted-foreground">Seleziona un ristorante per continuare.</p>
      )}

      {restaurantId && loading && (
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-20" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-9 w-full" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-9 w-full" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-9 w-full" />
            </div>

            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-9 w-full" />
            </div>

            <div className="pt-2 flex justify-end">
              <Skeleton className="h-9 w-20" />
            </div>
          </CardContent>
        </Card>
      )}

      {restaurantId && !loading && fase === 1 && (
        <Card className="cassa-perforated-top">
          <CardHeader>
            <CardTitle className="cassa-display text-lg">Entrate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isConfermata && (
              <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-3 py-2">
                Questa chiusura è già stata confermata. Il salvataggio delle modifiche avviene in Fase 3
                {dataCorretta && ' — la correzione della data invece si salva subito, proseguendo con "Avanti"'}.
              </p>
            )}

            <div className="space-y-1.5">
              <Label>Fondo Cassa Iniziale</Label>
              <CurrencyInput
                value={fields.fondoCassaIniziale}
                onChange={v => { setFields(f => ({ ...f, fondoCassaIniziale: v })); markTouched('fondoCassaIniziale') }}
                readOnly={!fondoIniziale_editabile}
                className="cassa-numeric"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Entrate Contanti <span className="text-cassa-copper">*</span></Label>
                <CurrencyInput
                  value={fields.entrateContanti}
                  onChange={v => { setFields(f => ({ ...f, entrateContanti: v })); markTouched('entrateContanti') }}
                  className="cassa-numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Entrate POS <span className="text-cassa-copper">*</span></Label>
                <CurrencyInput
                  value={fields.entratePos}
                  onChange={v => { setFields(f => ({ ...f, entratePos: v })); markTouched('entratePos') }}
                  className="cassa-numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Entrate Bonifico <span className="text-cassa-copper">*</span></Label>
                <CurrencyInput
                  value={fields.entrateBonifico}
                  onChange={v => { setFields(f => ({ ...f, entrateBonifico: v })); markTouched('entrateBonifico') }}
                  className="cassa-numeric"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Totale Entrate</Label>
              <CurrencyInput value={totaleEntrate} readOnly className="cassa-numeric" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Coperti <span className="text-cassa-copper">*</span></Label>
                <CountInput
                  value={fields.coperti}
                  onChange={v => { setFields(f => ({ ...f, coperti: v })); markTouched('coperti') }}
                  className="cassa-numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Incasso Asporto <span className="text-cassa-copper">*</span></Label>
                <CurrencyInput
                  value={fields.incassoAsporto}
                  onChange={v => { setFields(f => ({ ...f, incassoAsporto: v })); markTouched('incassoAsporto') }}
                  className="cassa-numeric"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Media Scontrino</Label>
              <CurrencyInput value={mediaScontrino} readOnly className="cassa-numeric" />
            </div>

            <div className="space-y-1.5">
              <Label>Fondo Cassa Finale <span className="text-cassa-copper">*</span></Label>
              <CurrencyInput
                value={fields.fondoCassaFinale}
                onChange={v => { setFields(f => ({ ...f, fondoCassaFinale: v })); markTouched('fondoCassaFinale') }}
                className="cassa-numeric"
              />
            </div>

            {!fase1Complete && (
              <p className="text-xs text-muted-foreground">
                Compila tutti i campi contrassegnati con <span className="text-cassa-copper">*</span> per continuare (anche con valore 0, se corretto).
              </p>
            )}

            <div className="pt-2 flex justify-end">
              <Button onClick={handleAvanti} disabled={saving || !fase1Complete}>
                {saving ? 'Salvataggio…' : 'Avanti'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {restaurantId && !loading && fase === 2 && existing && ownerId && (
        <SpeseFase
          chiusura={existing}
          ownerId={ownerId}
          role={role}
          userId={userId}
          onBack={() => setFase(1)}
          onNext={() => setFase(3)}
        />
      )}

      {restaurantId && !loading && fase === 3 && existing && (
        <QuadraturaFase
          chiusura={existing}
          fields={fields}
          onFieldsChange={setFields}
          role={role}
          userId={userId}
          onBack={() => setFase(2)}
          onSaved={row => setExisting(row)}
          onRequestSent={() => loadChiusura()}
          contantiPerBancaTouched={touched.has('contantiPerBanca')}
          onContantiPerBancaTouched={() => markTouched('contantiPerBanca')}
        />
      )}

      <Dialog open={!!bozzaDaEliminare} onOpenChange={open => { if (!open) { setBozzaDaEliminare(null); setDeleteBozzaError(null) } }}>
        <DialogContent className="cassa-perforated-top">
          <DialogHeader>
            <DialogTitle className="cassa-display text-lg">Eliminare questa bozza?</DialogTitle>
          </DialogHeader>
          {bozzaDaEliminare && (
            <p className="text-sm text-muted-foreground">
              {restaurants.find(r => r.id === bozzaDaEliminare.restaurant_id)?.name ?? '—'} · {formatDataBreve(bozzaDaEliminare.data)}
              {' '}— tutti i dati inseriti finora andranno persi. L&apos;operazione non è reversibile.
            </p>
          )}
          {deleteBozzaError && <p className="text-sm text-destructive">Errore nell&apos;eliminazione: {deleteBozzaError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setBozzaDaEliminare(null); setDeleteBozzaError(null) }} disabled={eliminandoBozza}>
              Annulla
            </Button>
            <Button type="button" variant="destructive" onClick={confermaEliminaBozza} disabled={eliminandoBozza}>
              {eliminandoBozza ? <><Loader2 className="w-4 h-4 animate-spin" /> Eliminazione…</> : 'Elimina'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
