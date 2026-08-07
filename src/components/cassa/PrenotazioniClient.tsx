'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatInTimeZone } from 'date-fns-tz'
import { addDays, format, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import {
  ChevronDown, ChevronLeft, ChevronRight, Plus, RefreshCw, Upload,
  Armchair, Phone, Eye, Loader2, CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatoIcona } from '@/components/cassa/PrenotazioneIcona'
import { PrenotazioneStatoDialog } from '@/components/cassa/PrenotazioneStatoDialog'
import { PrenotazioneFormDialog } from '@/components/cassa/PrenotazioneFormDialog'
import { PrenotazioniImportDialog } from '@/components/cassa/PrenotazioniImportDialog'
import {
  costruisciFasce, contaCoperti, formatPax, nomeCompleto, normalizzaOrario, FASCE,
} from '@/lib/cassa/prenotazioniAgenda'
import { cn } from '@/lib/utils'
import type { Prenotazione, PrenotazioneServizio, PrenotazioneStato } from '@/types'

const TZ = 'Europe/Rome'

interface RestaurantOption { id: string; name: string }
interface InsegnaOption { id: string; restaurant_id: string; codice: string; etichetta: string }

interface Props {
  restaurants: RestaurantOption[]
  insegne:     InsegnaOption[]
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
  p, etichettaInsegna, espansa, onEspandi, onStato, onAzioneRapida, onDettagli,
}: {
  p:                Prenotazione
  etichettaInsegna: string | null
  espansa:          boolean
  onEspandi:        () => void
  onStato:          () => void
  onAzioneRapida:   () => void
  onDettagli:       () => void
}) {
  // Da confermata l'azione ovvia è far sedere il cliente; da seduta
  // l'unica utile è tornare indietro (tavolo liberato per sbaglio).
  const azione = p.stato === 'seduta'
    ? { label: 'Confermata', icona: <CheckCircle2 className="h-4 w-4" /> }
    : { label: 'Seduta',     icona: <Armchair className="h-4 w-4" /> }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-start gap-3 p-3">
        <button type="button" onClick={onStato} aria-label={`Cambia stato di ${nomeCompleto(p)}`}>
          <StatoIcona stato={p.stato} origine={p.origine} />
        </button>

        <button type="button" onClick={onEspandi} className="min-w-0 flex-1 text-left">
          <div className="break-words font-medium leading-tight">{nomeCompleto(p)}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="cassa-numeric">{normalizzaOrario(p.orario)}</span>
            {etichettaInsegna && <span>· {etichettaInsegna}</span>}
            {p.sconto_percentuale != null && (
              <span className="text-[hsl(var(--cassa-copper))]">· −{p.sconto_percentuale}%</span>
            )}
            {p.note && <span className="break-words">· {p.note}</span>}
          </div>
        </button>

        <div className="cassa-numeric shrink-0 text-lg font-semibold">{formatPax(p)}</div>
      </div>

      {espansa && (
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
      )}
    </div>
  )
}

export function PrenotazioniClient({ restaurants, insegne }: Props) {
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? '')
  const [data, setData] = useState(oggiRoma)
  const [servizio, setServizio] = useState<PrenotazioneServizio>(servizioCorrente)

  const [prenotazioni, setPrenotazioni] = useState<Prenotazione[]>([])
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState<string | null>(null)

  const [aperte, setAperte] = useState({ confermate: true, sedute: true, noShow: false })
  const [espansa, setEspansa] = useState<string | null>(null)

  const [statoTarget, setStatoTarget] = useState<Prenotazione | null>(null)
  const [formAperto, setFormAperto] = useState(false)
  const [formIniziale, setFormIniziale] = useState<{ data: string; orario: string } | null>(null)
  const [formPrenotazione, setFormPrenotazione] = useState<Prenotazione | null>(null)
  // Cresce a ogni apertura e fa da key al dialog: il form riparte sempre
  // dai dati giusti senza doverli risincronizzare con un effetto.
  const [formSeq, setFormSeq] = useState(0)
  const [importAperto, setImportAperto] = useState(false)

  const [sincronizzando, setSincronizzando] = useState(false)
  const [avviso, setAvviso] = useState<string | null>(null)

  const insegneLocale = useMemo(
    () => insegne.filter(i => i.restaurant_id === restaurantId),
    [insegne, restaurantId]
  )
  const etichettaInsegna = useCallback(
    (codice: string | null) => {
      if (!codice) return null
      // Con una sola insegna il nome non aggiunge nulla: è già il locale
      // che si sta guardando.
      if (insegneLocale.length < 2) return null
      return insegneLocale.find(i => i.codice === codice)?.etichetta ?? codice
    },
    [insegneLocale]
  )

  const carica = useCallback(async () => {
    if (!restaurantId) { setPrenotazioni([]); setCaricamento(false); return }
    const supabase = createClient()
    const { data: righe, error } = await supabase
      .from('prenotazioni')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('data', data)
      .eq('servizio', servizio)
      .neq('stato', 'eliminata')
      .order('orario')
    setErrore(error?.message ?? null)
    setPrenotazioni((righe ?? []) as Prenotazione[])
    setCaricamento(false)
  }, [restaurantId, data, servizio])

  useEffect(() => { setCaricamento(true); carica() }, [carica])

  // Le prenotazioni arrivano anche da fuori app (il cron che legge la
  // casella): senza realtime l'agenda resterebbe ferma sullo stato del
  // momento in cui è stata aperta, proprio durante il servizio.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('prenotazioni_agenda')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prenotazioni' }, () => carica())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [carica])

  const confermate = useMemo(() => prenotazioni.filter(p => p.stato === 'confermata'), [prenotazioni])
  const sedute     = useMemo(() => prenotazioni.filter(p => p.stato === 'seduta'), [prenotazioni])
  const noShow     = useMemo(() => prenotazioni.filter(p => p.stato === 'no_show'), [prenotazioni])
  const fasce      = useMemo(() => costruisciFasce(servizio, confermate), [servizio, confermate])

  async function cambiaStato(p: Prenotazione, stato: PrenotazioneStato) {
    const supabase = createClient()
    const { error } = await supabase
      .from('prenotazioni')
      .update({ stato, seduta_at: stato === 'seduta' ? new Date().toISOString() : null })
      .eq('id', p.id)
    if (error) throw new Error(error.message)
    // Aggiornamento ottimistico: il realtime arriva comunque, ma dopo un
    // giro di rete — durante il servizio il riscontro deve essere subito.
    setPrenotazioni(prev =>
      stato === 'eliminata'
        ? prev.filter(x => x.id !== p.id)
        : prev.map(x => (x.id === p.id ? { ...x, stato } : x))
    )
    setEspansa(null)
  }

  async function sincronizza() {
    setSincronizzando(true)
    setAvviso(null)
    try {
      const res = await fetch('/api/cassa/prenotazioni/sync', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Sincronizzazione non riuscita')
      setAvviso(
        json.importate > 0
          ? `${json.importate} prenotazioni aggiornate dalla casella.`
          : 'Nessuna nuova prenotazione nella casella.'
      )
      await carica()
    } catch (err) {
      setAvviso(err instanceof Error ? err.message : 'Sincronizzazione non riuscita')
    } finally {
      setSincronizzando(false)
    }
  }

  function apriNuova(orario: string) {
    setFormPrenotazione(null)
    setFormIniziale({ data, orario })
    setFormSeq(n => n + 1)
    setFormAperto(true)
  }

  function apriDettagli(p: Prenotazione) {
    setFormIniziale(null)
    setFormPrenotazione(p)
    setFormSeq(n => n + 1)
    setFormAperto(true)
  }

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
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => apriNuova(FASCE[servizio].inizio)}>
          <Plus className="h-4 w-4" /> Prenotazione
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setImportAperto(true)}>
          <Upload className="h-4 w-4" /> Importa
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={sincronizza} disabled={sincronizzando}>
          {sincronizzando
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Aggiorno…</>
            : <><RefreshCw className="h-4 w-4" /> Aggiorna</>}
        </Button>
        {data !== oggiRoma() && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setData(oggiRoma())}>
            Oggi
          </Button>
        )}
      </div>

      {avviso && <p className="text-sm text-muted-foreground">{avviso}</p>}
      {errore && <p className="text-sm text-destructive">Errore nel caricamento: {errore}</p>}

      {caricamento ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      ) : (
        <div className="space-y-4">
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
                  />
                ))}
          </Sezione>

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
        onSalvata={carica}
      />

      <PrenotazioniImportDialog
        open={importAperto}
        onOpenChange={setImportAperto}
        restaurantId={restaurantId}
        onImportate={n => { setAvviso(`${n} prenotazioni importate.`); carica() }}
      />
    </div>
  )
}
