'use client'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAccountStatus } from '@/contexts/AccountStatusContext'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { ScheletroForma } from '@/components/shared/ScheletroForma'
import { useScheletro } from '@/components/shared/useScheletro'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import { CampoNumerico } from '@/components/ui/tastierino'
import { CampoOrario } from '@/components/ui/rotella'
import { DEPARTMENTS, WEEK_DAYS_SHORT } from '@/types'
import type { Department, Restaurant, ShiftSlot } from '@/types'
import {
  BarraAltro, ElencoAltro, PannelloDettaglio, GrigliaAltro, FoglioAltro, TestataFoglio, CorpoFoglio, Campo, Testo,
  GruppoPillole, Nota, PulsantiSalva, PilloleSenzaTutti, useUscita, useDoppioTocco, ICONA_MIRINO, ICONA_PIU,
  type RigaAltro, type DatiDettaglio,
} from '@/components/altro/comuni'
import { FoglioQr } from '@/components/altro/QrLocale'

// Ristoranti (MTAltro.dc.html, sec "ristoranti"): un locale alla volta
// dalle pillole; elenco delle fasce di servizio (orario, persone minime,
// notturna); dettaglio del locale con coordinate GPS e raggio di
// timbratura, giorni di chiusura da toccare, QR timbratura, Modifica ed
// Elimina a due tocchi; foglio Nuovo/Modifica ristorante con "Usa la mia
// posizione". Sul telefono elenco e dettaglio scorrono insieme.
//
// Codice destinatario SDI e "riferimenti per le fatture" servono allo
// smistamento delle fatture XML (Acquisti › Importa XML): più locali
// possono avere lo stesso codice, e allora decidono i riferimenti
// (nome, via, parole che compaiono nelle fatture di quel locale).

const RAGGIO_TIMBRATURA = '100 m' // stesso valore di /api/scan (RAGGIO_MAX)
const GIORNI = [1, 2, 3, 4, 5, 6, 0] // Lun → Dom (0 = domenica)
const RE_GPS = /^\s*-?\d{1,2}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?\s*$/

const hhmm = (t: string) => t.slice(0, 5)
const minuti = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const notturna = (s: { start_time: string; end_time: string }) => minuti(s.end_time) <= minuti(s.start_time)

// Colonne della migrazione xml-smistamento (assenti prima di applicarla).
type Rist = Restaurant & { codice_destinatario?: string | null; riferimenti_fatture?: string[] | null }
interface Props { initialRestaurants: Restaurant[]; initialFasce: ShiftSlot[] }
interface StatoRist { id: string | null; t: string; a: string; g: string; rilevo: boolean; c: string; rif: string[]; nr: string }
const RE_CODICE = /^[A-Z0-9]{7}$/
const pulisciCodice = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)
interface StatoFascia { id: string | null; rep: Department | null; nome: string; a: string; b: string; n: number; gg: number[] }

export function RestaurantsClient({ initialRestaurants, initialFasce }: Props) {
  const { isPending } = useAccountStatus()
  const [rist, setRist] = useState<Rist[]>(initialRestaurants)
  const [fasce, setFasce] = useState(initialFasce)
  const [loc, setLoc] = useState<string | null>(initialRestaurants[0]?.id ?? null)
  const [sel, setSel] = useState<string | null>(null)
  const [nuove, setNuove] = useState<string[]>([])
  const doppio = useDoppioTocco()
  const { stato: sk, avvia, pronto } = useScheletro(false)

  const locali = useMemo(() => rist.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) })), [rist])
  const R = rist.find(r => r.id === loc) ?? rist[0] ?? null
  const colore = locali.find(l => l.id === R?.id)?.colore ?? 'var(--line-strong)'
  const FA = R ? fasce.filter(s => s.restaurant_id === R.id).sort((x, y) => DEPARTMENTS.indexOf(x.department) - DEPARTMENTS.indexOf(y.department) || x.start_time.localeCompare(y.start_time)) : []

  const righe: RigaAltro[] = FA.map(s => ({
    key: s.id, a: `${s.department} · ${s.name}`, as: R?.name ?? '', lc: colore,
    b: `${hhmm(s.start_time)}–${hhmm(s.end_time)}`, c: `${s.required_count} ${s.required_count === 1 ? 'persona' : 'persone'}`,
    t: notturna(s) ? 'Notturno (+1)' : 'Standard', tono: notturna(s) ? 'warn' : 'neu', nuova: nuove.includes(s.id),
  }))
  const chiusi = R?.closing_days ?? []
  const kpis = [{ l: 'Fasce', v: String(FA.length) }, { l: 'Chiuso', v: chiusi.length ? GIORNI.filter(g => chiusi.includes(g)).map(g => WEEK_DAYS_SHORT[g]).join(', ') : 'Mai' }]

  function scegliLoc(id: string) { setLoc(id); setSel(null); doppio.reset(); avvia(); pronto() }

  // ── Giorni di chiusura: si salvano al tocco ────────────────────────────
  async function toccaGiorno(g: number) {
    if (!R) return
    const prima = R.closing_days ?? [], dopo = prima.includes(g) ? prima.filter(x => x !== g) : [...prima, g]
    setRist(rs => rs.map(r => (r.id === R.id ? { ...r, closing_days: dopo } : r)))
    const { error } = await createClient().from('restaurants').update({ closing_days: dopo }).eq('id', R.id)
    if (error) {
      setRist(rs => rs.map(r => (r.id === R.id ? { ...r, closing_days: prima } : r)))
      toast({ title: 'Giorni di chiusura non salvati', description: error.message, variant: 'destructive' })
    } else toast({ title: dopo.includes(g) ? `Chiuso il ${WEEK_DAYS_SHORT[g].toLowerCase()}` : `Aperto il ${WEEK_DAYS_SHORT[g].toLowerCase()}` })
  }

  // ── Ristorante: nuovo / modifica / elimina ─────────────────────────────
  const fr = useUscita<StatoRist>()
  const [salvando, setSalvando] = useState(false)
  const NR = fr.dati
  const setR = (x: Partial<StatoRist>) => fr.setDati(d => (d ? { ...d, ...x } : d))
  const gpsOk = !!NR && RE_GPS.test(NR.g)
  const codiceOk = !!NR && (NR.c === '' || RE_CODICE.test(NR.c))
  const okR = !!NR && !!NR.t.trim() && !!NR.a.trim() && gpsOk && codiceOk
  const apriForm = (r: Rist | null) => fr.apri(r
    ? { id: r.id, t: r.name, a: r.address ?? '', g: coord(r), rilevo: false, c: r.codice_destinatario ?? '', rif: r.riferimenti_fatture ?? [], nr: '' }
    : { id: null, t: '', a: '', g: '', rilevo: false, c: '', rif: [], nr: '' })
  const aggiungiRif = () => {
    if (!NR) return
    const v = NR.nr.trim().replace(/\s+/g, ' ')
    if (!v) return
    // Doppioni ignorati senza distinzione di maiuscole, come nel confronto.
    setR({ nr: '', rif: NR.rif.some(x => x.toLowerCase() === v.toLowerCase()) ? NR.rif : [...NR.rif, v] })
  }
  const coord = (r: Restaurant) => (r.latitude != null && r.longitude != null ? `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}` : '')

  function posizione() {
    if (!navigator.geolocation) { toast({ title: 'Posizione non disponibile su questo dispositivo', variant: 'destructive' }); return }
    setR({ rilevo: true })
    navigator.geolocation.getCurrentPosition(
      p => fr.setDati(d => (d ? { ...d, g: `${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`, rilevo: false } : d)),
      () => { setR({ rilevo: false }); toast({ title: 'Posizione non rilevata', description: 'Inserisci le coordinate a mano.', variant: 'destructive' }) },
      { enableHighAccuracy: true, timeout: 6000 },
    )
  }

  async function salvaRist() {
    if (!NR || !okR) return
    const [lat, lng] = NR.g.split(',').map(v => +(+v.trim()).toFixed(6))
    const base = { name: NR.t.trim(), address: NR.a.trim(), latitude: lat, longitude: lng }
    // Un riferimento scritto ma non ancora aggiunto si salva comunque.
    const extra = NR.nr.trim() && !NR.rif.some(x => x.toLowerCase() === NR.nr.trim().toLowerCase()) ? [NR.nr.trim()] : []
    const fatture = { codice_destinatario: NR.c || null, riferimenti_fatture: [...NR.rif, ...extra] }
    const conFatture = !!(NR.c || fatture.riferimenti_fatture.length || NR.id)
    const supabase = createClient()
    setSalvando(true)
    // Senza la migrazione le due colonne non esistono: si salva il resto e
    // lo si dice.
    const manca = (e: { code?: string } | null) => !!e && (e.code === '42703' || e.code === 'PGRST204')
    let senzaCodice = false
    try {
      if (NR.id) {
        let { data, error } = await supabase.from('restaurants').update(conFatture ? { ...base, ...fatture } : base).eq('id', NR.id).select().single()
        if (conFatture && manca(error)) { senzaCodice = !!(NR.c || fatture.riferimenti_fatture.length); ({ data, error } = await supabase.from('restaurants').update(base).eq('id', NR.id).select().single()) }
        if (error || !data) throw new Error(error?.message)
        setRist(rs => rs.map(r => (r.id === data.id ? (data as Rist) : r)))
        fr.chiudi()
        toast(senzaCodice ? { title: 'Ristorante aggiornato, codice destinatario non salvato', description: 'Serve l\'aggiornamento del database per le fatture XML.', variant: 'destructive' } : { title: 'Ristorante aggiornato' })
      } else {
        const { data: { user } } = await supabase.auth.getUser()
        const nuovo = { ...base, closing_days: [], owner_id: user?.id ?? null }
        let { data, error } = await supabase.from('restaurants').insert(conFatture ? { ...nuovo, ...fatture } : nuovo).select().single()
        if (conFatture && manca(error)) { senzaCodice = true; ({ data, error } = await supabase.from('restaurants').insert(nuovo).select().single()) }
        if (error || !data) throw new Error(error?.message)
        // Un manager con perimetro limitato deve poter gestire subito il
        // locale appena creato: lo si aggiunge ai suoi locali (il
        // proprietario della piattaforma, null, vede già tutto).
        const { data: io } = await supabase.from('profiles').select('managed_restaurant_ids').eq('id', user!.id).single()
        const managed = io?.managed_restaurant_ids as string[] | null
        if (managed !== null) await supabase.from('profiles').update({ managed_restaurant_ids: [...(managed ?? []), data.id] }).eq('id', user!.id)
        setRist(rs => [...rs, data as Rist])
        fr.chiudi()
        setLoc(data.id); setSel(null)
        toast(senzaCodice ? { title: 'Ristorante creato, codice destinatario non salvato', description: 'Serve l\'aggiornamento del database per le fatture XML.', variant: 'destructive' } : { title: 'Ristorante creato' })
      }
    } catch (e) {
      toast({ title: NR.id ? 'Modifica non riuscita' : 'Ristorante non creato', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSalvando(false)
    }
  }

  async function eliminaRist(r: Rist) {
    const { error } = await createClient().from('restaurants').delete().eq('id', r.id)
    if (error) { toast({ title: 'Eliminazione non riuscita', description: error.message, variant: 'destructive' }); return }
    const resto = rist.filter(x => x.id !== r.id)
    setRist(resto)
    setLoc(resto[0]?.id ?? null); setSel(null)
    toast({ title: `Ristorante ${r.name} eliminato` })
  }

  // ── Fasce di servizio ──────────────────────────────────────────────────
  const ff = useUscita<StatoFascia>()
  const NF = ff.dati
  const setF = (x: Partial<StatoFascia>) => ff.setDati(d => (d ? { ...d, ...x } : d))
  const okF = !!NF && !!NF.rep && !!NF.nome.trim() && !!NF.a && !!NF.b && NF.n >= 1
  async function salvaFascia() {
    if (!NF || !okF || !R) return
    const campi = { department: NF.rep, name: NF.nome.trim(), start_time: NF.a, end_time: NF.b, required_count: NF.n, days_of_week: NF.gg }
    const supabase = createClient()
    setSalvando(true)
    const { data, error } = NF.id
      ? await supabase.from('shift_slots').update(campi).eq('id', NF.id).select().single()
      : await supabase.from('shift_slots').insert({ ...campi, restaurant_id: R.id }).select().single()
    setSalvando(false)
    if (error || !data) { toast({ title: 'Fascia non salvata', description: error?.message, variant: 'destructive' }); return }
    const s = data as ShiftSlot
    setFasce(xs => (NF.id ? xs.map(x => (x.id === s.id ? s : x)) : [...xs, s]))
    if (!NF.id) { setNuove(n => [...n, s.id]); setSel(s.id) }
    ff.chiudi()
    toast({ title: NF.id ? 'Fascia aggiornata' : 'Fascia aggiunta' })
  }
  async function eliminaFascia(s: ShiftSlot) {
    const { error } = await createClient().from('shift_slots').delete().eq('id', s.id)
    if (error) { toast({ title: 'Eliminazione non riuscita', description: error.message, variant: 'destructive' }); return }
    setFasce(xs => xs.filter(x => x.id !== s.id))
    setSel(null)
    toast({ title: 'Fascia eliminata' })
  }

  const qr = useUscita<Restaurant>()

  // Locali con lo stesso codice destinatario: lo smistamento li distingue
  // solo con i riferimenti.
  const condivisoCon = (r: Rist) => (r.codice_destinatario ? rist.filter(x => x.id !== r.id && x.codice_destinatario === r.codice_destinatario).map(x => x.name) : [])

  // ── Dettaglio del locale ───────────────────────────────────────────────
  let d: DatiDettaglio | null = null
  if (R) {
    const s = FA.find(x => x.id === sel)
    const giorni = s?.days_of_week?.length ? GIORNI.filter(g => s.days_of_week.includes(g)).map(g => WEEK_DAYS_SHORT[g]).join(', ') : 'Tutti'
    const btn = 'flex h-11 items-center justify-center rounded-[8px] border text-sm font-semibold active:scale-[0.98]'
    d = {
      titolo: R.name, sotto: R.address || 'Indirizzo non impostato', tag: R.is_demo ? 'Demo' : 'Attivo', tono: R.is_demo ? 'warn' : 'ok',
      stats: [{ l: 'Coordinate GPS', v: coord(R) || '—' }, { l: 'Raggio timbratura', v: RAGGIO_TIMBRATURA }],
      sezioni: [
        ...(s ? [{
          h: `Fascia selezionata · ${s.department} ${s.name.toLowerCase()}`,
          righe: [
            { l: 'Orario', v: `${hhmm(s.start_time)}–${hhmm(s.end_time)}${notturna(s) ? ' (+1)' : ''}` },
            { l: 'Persone minime', v: String(s.required_count) },
            { l: 'Giorni', v: giorni },
            { l: 'Usata da', v: 'generazione turni e coperture' },
          ],
          coda: (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" className={`${btn} border-line-strong`}
                onClick={() => ff.apri({ id: s.id, rep: s.department, nome: s.name, a: hhmm(s.start_time), b: hhmm(s.end_time), n: s.required_count, gg: s.days_of_week ?? [] })}>Modifica fascia</button>
              <button type="button" onClick={() => doppio.tocca('f' + s.id, () => eliminaFascia(s))}
                className={doppio.armato === 'f' + s.id ? `${btn} border-[oklch(0.45_0.1_25)] bg-[oklch(0.45_0.1_25)] text-white` : `${btn} border-[oklch(0.85_0.05_25)] text-neg dark:border-[oklch(0.45_0.08_25)]`}>
                {doppio.armato === 'f' + s.id ? 'Conferma' : 'Elimina fascia'}
              </button>
            </div>
          ),
        }] : []),
        {
          h: 'Fatture elettroniche',
          righe: [
            { l: 'Codice destinatario SDI', v: R.codice_destinatario || '—' },
            ...(condivisoCon(R).length ? [{ l: `Condiviso con ${condivisoCon(R).join(', ')}`, v: '' }] : []),
            ...(R.riferimenti_fatture?.length
              ? R.riferimenti_fatture.map((x, i) => ({ l: `«${x}»`, v: i === 0 ? 'Riferimento' : '' }))
              : [{ l: 'Riferimenti per le fatture', v: 'Nessuno' }]),
          ],
        },
        { h: 'Giorni di chiusura · tocca per cambiare', righe: [] },
      ],
      giorni: GIORNI.map(g => ({ l: WEEK_DAYS_SHORT[g], on: chiusi.includes(g), onClick: () => toccaGiorno(g) })),
      azioni: [
        { l: 'QR timbratura', stile: 'contorno', onClick: () => qr.apri(R) },
        { l: 'Modifica', stile: 'contorno', onClick: () => apriForm(R) },
        doppio.armato === 'r' + R.id
          ? { l: 'Conferma', stile: 'negPieno', onClick: () => doppio.tocca('r' + R.id, () => eliminaRist(R)) }
          : { l: 'Elimina', stile: 'neg', onClick: () => doppio.tocca('r' + R.id, () => {}) },
      ],
    }
  }

  return (
    <div data-sk-root="" data-sk-on={sk === 'on' ? '1' : undefined} className="relative box-border flex h-full flex-col gap-3 px-4 sm:px-8">
      <BarraAltro
        locali={locali.length ? <PilloleSenzaTutti locali={locali} scelto={R?.id ?? null} onScegli={scegliLoc} /> : undefined}
        kpis={R ? kpis : []} nuovo={{ l: 'Nuovo ristorante', onClick: () => apriForm(null), disabilitato: isPending }}
      />
      {R ? (
        <GrigliaAltro inLinea>
          <ElencoAltro inLinea
            testate={[{ l: 'Fascia di servizio', a: 'left' }, { l: 'Orario', a: 'right' }, { l: 'Minimo', a: 'right' }, { l: 'Tipo', a: 'right' }]}
            colonne="minmax(0,1.2fr) 110px 110px 110px" righe={righe} scelta={sel} onScegli={k => setSel(s => (s === k ? null : k))}
            vuoto={{ t: 'Nessuna fascia di servizio', s: 'Le fasce dicono quante persone servono per reparto: le usa la generazione dei turni.' }}
            coda={
              <div className="p-3">
                <button type="button" onClick={() => ff.apri({ id: null, rep: null, nome: '', a: '', b: '', n: 1, gg: [] })}
                  className="flex h-12 w-full items-center justify-center rounded-[12px] border border-dashed border-line-strong text-[15px] font-medium text-muted-foreground active:scale-[0.98]">
                  + Aggiungi fascia
                </button>
              </div>
            }
          />
          <PannelloDettaglio inLinea d={d} chiave={`rist|${R.id}`} esce={false} onChiudi={() => setSel(null)} />
        </GrigliaAltro>
      ) : (
        <div className="anim-swapin flex flex-1 flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-line-strong px-6 text-center">
          <span className="text-[17px] font-semibold">Nessun ristorante</span>
          <span className="text-sm text-muted-foreground">Aggiungine uno con Nuovo ristorante per iniziare.</span>
        </div>
      )}
      {sk !== 'no' && <ScheletroForma esce={sk === 'out'} />}

      <FoglioAltro aperto={!!NR} esce={fr.esce} onChiudi={() => fr.chiudi()} testata={<TestataFoglio titolo={NR?.id ? 'Modifica ristorante' : 'Nuovo ristorante'} onChiudi={() => fr.chiudi()} />}>
        {NR && (
          <CorpoFoglio>
            <Campo etichetta="Nome del locale"><Testo value={NR.t} onChange={v => setR({ t: v })} placeholder="Es. Chiaia" /></Campo>
            <Campo etichetta="Indirizzo"><Testo value={NR.a} onChange={v => setR({ a: v })} placeholder="Es. Via Chiaia 45, Napoli" /></Campo>
            <Campo etichetta="Coordinate GPS">
              <div className="flex flex-wrap gap-2">
                <Testo mono inputMode="decimal" value={NR.g} onChange={v => setR({ g: v.replace(/[^0-9.,\s-]/g, '') })} placeholder="40.8390, 14.2440" className="flex-[1_1_220px]" />
                <button type="button" onClick={posizione} disabled={NR.rilevo}
                  className="box-border flex h-[52px] flex-[1_0_auto] items-center justify-center gap-2 whitespace-nowrap rounded-[6px] border border-line-strong px-3.5 text-sm font-medium active:scale-[0.98]">
                  {ICONA_MIRINO}{NR.rilevo ? 'Rilevo…' : 'Usa la mia posizione'}
                </button>
              </div>
            </Campo>
            <Nota>Usa la tua posizione se sei nel locale, altrimenti inserisci le coordinate a mano. Il QR di timbratura viene generato subito; fasce e giorni di chiusura li imposti dopo.</Nota>
            <Campo etichetta="Codice destinatario SDI (facoltativo)">
              <Testo mono autoCapitalize="characters" value={NR.c} onChange={v => setR({ c: pulisciCodice(v) })} placeholder="Es. M5UXCR1" className={cn('tracking-[.12em]', NR.c && !codiceOk && 'border-neg')} />
            </Campo>
            <Campo etichetta="Riferimenti per le fatture (facoltativo)">
              <div className="flex flex-col gap-2">
                {NR.rif.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {NR.rif.map(x => (
                      <span key={x} className="anim-swapin inline-flex h-9 max-w-full items-center gap-1 rounded-full border border-[oklch(0.88_0.01_250)] bg-background pl-3.5 pr-1 text-sm font-medium dark:border-line-strong">
                        <span className="truncate">{x}</span>
                        <button type="button" aria-label={`Togli ${x}`} onClick={() => setR({ rif: NR.rif.filter(y => y !== x) })} className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-muted-foreground active:scale-[0.94]">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <form className="flex gap-2" onSubmit={e => { e.preventDefault(); aggiungiRif() }}>
                  <Testo value={NR.nr} onChange={v => setR({ nr: v })} placeholder="Es. Dazio, Via Roma 12" className="min-w-0 flex-1" />
                  <button type="submit" disabled={!NR.nr.trim()} aria-label="Aggiungi riferimento"
                    className="box-border flex h-[52px] w-[52px] flex-none items-center justify-center rounded-[6px] border border-line-strong active:scale-[0.98] disabled:opacity-40">{ICONA_PIU}</button>
                </form>
              </div>
            </Campo>
            <Nota>{NR.c && !codiceOk
              ? 'Il codice destinatario ha 7 caratteri, lettere e numeri.'
              : 'Le fatture XML si assegnano da sole al locale con questo codice. Se il codice manca o è condiviso con altri locali, decidono il nome del locale, la via dell\'indirizzo (es. «Nomentana») e i riferimenti: altre parole che compaiono nelle fatture di questo locale. Se le ricevete via PEC, aggiungi anche l\'indirizzo PEC.'}</Nota>
            <PulsantiSalva onAnnulla={() => fr.chiudi()} onSalva={salvaRist} etichetta={NR.id ? 'Salva modifiche' : 'Crea ristorante'} attivo={okR} occupato={salvando} />
          </CorpoFoglio>
        )}
      </FoglioAltro>

      <FoglioAltro aperto={!!NF} esce={ff.esce} onChiudi={() => ff.chiudi()} testata={<TestataFoglio titolo={NF?.id ? 'Modifica fascia' : 'Nuova fascia'} onChiudi={() => ff.chiudi()} />}>
        {NF && (
          <CorpoFoglio>
            <GruppoPillole etichetta="Reparto" opzioni={DEPARTMENTS.map(v => ({ v, l: v }))} scelte={NF.rep ? [NF.rep] : []} onTocca={v => setF({ rep: v })} />
            <Campo etichetta="Nome della fascia"><Testo value={NF.nome} onChange={v => setF({ nome: v })} placeholder="Es. Pranzo, Cena, Apertura" /></Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo etichetta="Inizio"><CampoOrario value={NF.a} onChange={v => setF({ a: v })} className="h-[52px] rounded-[6px] border-line-strong text-xl" /></Campo>
              <Campo etichetta="Fine"><CampoOrario value={NF.b} onChange={v => setF({ b: v })} className="h-[52px] rounded-[6px] border-line-strong text-xl" /></Campo>
            </div>
            <Campo etichetta="Persone minime">
              <CampoNumerico value={NF.n} onChange={v => setF({ n: v })} decimali={0} min={1} max={30} className="h-[52px] rounded-[6px] border-line-strong" />
            </Campo>
            <GruppoPillole etichetta="Giorni (vuoto = tutti)" griglia7 opzioni={GIORNI.map(g => ({ v: String(g), l: WEEK_DAYS_SHORT[g] }))} scelte={NF.gg.map(String)}
              onTocca={v => { const g = Number(v); setF({ gg: NF.gg.includes(g) ? NF.gg.filter(x => x !== g) : [...NF.gg, g] }) }} />
            <Nota>{NF.a && NF.b && notturna({ start_time: NF.a, end_time: NF.b })
              ? 'Fascia notturna: finisce il giorno dopo (+1) ma resta nello stesso giorno lavorativo.'
              : 'La generazione dei turni copre ogni fascia con almeno queste persone.'}</Nota>
            <PulsantiSalva onAnnulla={() => ff.chiudi()} onSalva={salvaFascia} etichetta={NF.id ? 'Salva modifiche' : 'Aggiungi fascia'} attivo={okF} occupato={salvando} />
          </CorpoFoglio>
        )}
      </FoglioAltro>

      <FoglioQr locale={qr.dati} aperto={!!qr.dati} esce={qr.esce} onChiudi={() => qr.chiudi()} />
    </div>
  )
}
