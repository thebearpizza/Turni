'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAccountStatus } from '@/contexts/AccountStatusContext'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { CampoRicerca, corrisponde } from '@/components/shared/CampoRicerca'
import { ScheletroForma } from '@/components/shared/ScheletroForma'
import { useScheletro } from '@/components/shared/useScheletro'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import { CampoNumerico } from '@/components/ui/tastierino'
import { DEPARTMENTS, WEEK_DAYS_FULL, WEEK_DAYS_SHORT } from '@/types'
import type { Profile, ShiftSlot, SecondaryDepartment } from '@/types'
import {
  BarraAltro, ElencoAltro, PannelloDettaglio, GrigliaAltro, FoglioAltro, TestataFoglio, CorpoFoglio, Campo, Testo,
  GruppoPillole, Nota, PulsantiSalva, useUscita, useTelefono, USCITA, ICONA_COPIA, ICONA_RIGENERA,
  generaPassword, usernameDa, type RigaAltro, type DatiDettaglio, type Tono,
} from '@/components/altro/comuni'
import { FoglioCredenziali, copiaConAvviso, type StatoCredenziali } from '@/components/altro/Credenziali'
import { ConsulenteLavoroManager } from '@/components/manager/ConsulenteLavoroManager'

// Dipendenti (MTAltro.dc.html, sec "dipendenti"): staff dei locali con ore
// settimanali, riposi e ruolo; reparti come schede; dettaglio con account
// e parametri dei turni; "Reimposta password" e "Modifica"; foglio
// Nuovo/Modifica dipendente con username proposto dal nome e password
// generata, poi il foglio delle credenziali da condividere. Il direttore
// vede solo il suo locale (prototipo: `single`).

export type DipendenteRiga = Profile & { restaurant?: { id: string; name: string } | null }

type RuoloK = 'dipendente' | 'capo' | 'direttore' | 'cassiere' | 'hostess' | 'manager'
const RUOLO_L: Record<RuoloK, string> = { dipendente: 'Dipendente', capo: 'Capo servizio', direttore: 'Direttore', cassiere: 'Cassiere', hostess: 'Hostess', manager: 'Manager' }
const ruoloDi = (p: Pick<Profile, 'role' | 'is_direttore'>): RuoloK =>
  p.role === 'capo_servizio' ? (p.is_direttore ? 'direttore' : 'capo') : (p.role as RuoloK)
const TONO_RUOLO: Partial<Record<RuoloK, Tono>> = { direttore: 'tl', capo: 'warn' }
const SENZA_REPARTO: RuoloK[] = ['manager', 'hostess']
// Lun → Dom (0 = domenica)
const GIORNI = [1, 2, 3, 4, 5, 6, 0]

interface Props {
  initialDipendenti: DipendenteRiga[]
  restaurants: { id: string; name: string }[]
  fasce: ShiftSlot[]
  /** Direttore: un solo locale, niente pillole e niente ruolo Direttore. */
  single: boolean
  currentUserId: string
  currentRestaurantId: string | null
}

interface StatoForm {
  id: string | null
  t: string
  loc1: string | null
  rep1: string | null
  role: RuoloK
  /** null = proposto dal nome. */
  u: string | null
  /** '' = invariata (modifica). */
  pw: string
  bacheca: boolean
  ore: number | null
  riposi: number
  pref: number | null
  fasce: string[]
  jolly: SecondaryDepartment[]
  senior: boolean
}

const hhmm = (t: string) => t.slice(0, 5)

export function DipendentiClient({ initialDipendenti, restaurants, fasce, single, currentUserId, currentRestaurantId }: Props) {
  const tel = useTelefono()
  const { isPending } = useAccountStatus()
  const [dip, setDip] = useState(initialDipendenti)
  const [nuovi, setNuovi] = useState<string[]>([])
  const [loc, setLoc] = useState<string | null>(null)
  const [reps, setReps] = useState<string[]>([])
  // Manager: la scheda "Consulenti" mostra i consulenti del lavoro al posto dello staff.
  const [consulenti, setConsulenti] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [cerca, setCerca] = useState('')
  const [esceD, setEsceD] = useState(false)
  const tD = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tCr = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (tD.current) clearTimeout(tD.current); if (tCr.current) clearTimeout(tCr.current) }, [])
  const { stato: sk, avvia, pronto } = useScheletro(false)

  const locali = useMemo(() => restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) })), [restaurants])
  const info = (id: string | null) => (id ? locali.find(l => l.id === id) : undefined)
  const fascia = useMemo(() => new Map(fasce.map(f => [f.id, f])), [fasce])

  const E = dip.filter(d => loc === null || d.restaurant_id === loc)
  const perReparto = reps.length ? E.filter(d => d.department && reps.includes(d.department)) : E
  // Ricerca per nome, reparto o locale (senza maiuscole né accenti).
  const L = cerca.trim() ? perReparto.filter(d => corrisponde(cerca, d.full_name, d.department, info(d.restaurant_id)?.nome)) : perReparto
  const ore = (d: DipendenteRiga) => (d.weekly_hours_target ? `${d.weekly_hours_target}h` : 'Pieno')

  const righe: RigaAltro[] = L.map(d => {
    const r = ruoloDi(d)
    return {
      key: d.id, a: d.full_name, as: [info(d.restaurant_id)?.nome ?? 'Nessun locale', d.department].filter(Boolean).join(' · '),
      lc: info(d.restaurant_id)?.colore ?? 'var(--line-strong)', b: ore(d), c: String(d.weekly_rest_days ?? 1),
      t: RUOLO_L[r] ?? d.role, tono: TONO_RUOLO[r] ?? 'neu', nuova: nuovi.includes(d.id),
    }
  })
  const kpis = [{ l: 'Persone', v: String(L.length) }, { l: 'Part-time', v: String(L.filter(d => d.weekly_hours_target != null && d.weekly_hours_target < 40).length) }]
  const schede = [
    ...DEPARTMENTS.map(r => ({
      k: r, l: r, on: !consulenti && reps.includes(r),
      onClick: () => { setConsulenti(false); setReps(x => { const n = consulenti ? [r] : x.includes(r) ? x.filter(y => y !== r) : [...x, r]; return n.length === DEPARTMENTS.length ? [] : n }); setSel(null) },
    })),
    ...(!single ? [{ k: 'consulenti', l: 'Consulenti', on: consulenti, onClick: () => { setConsulenti(c => !c); setSel(null) } }] : []),
  ]

  // Tablet: all'apertura (e a ogni cambio di filtro) è scelta la prima riga,
  // così il dettaglio a destra non resta vuoto. Sul telefono no: aprirebbe il foglio.
  const selEff = righe.some(r => r.key === sel) ? sel : tel ? null : righe[0]?.key ?? null
  // Telefono: i reparti si scelgono nel foglio "Filtri", anche più d'uno.
  const filtri = [{
    titolo: 'Reparto', opzioni: DEPARTMENTS.map(r => ({ k: r as string, l: r as string })), valori: reps,
    onCambia: (v: string[]) => { setReps(v); setSel(null) },
  }]

  function scegli(k: string) { if (tD.current) clearTimeout(tD.current); setEsceD(false); setSel(k) }
  function chiudiDettaglio() { setEsceD(true); if (tD.current) clearTimeout(tD.current); tD.current = setTimeout(() => { setSel(null); setEsceD(false) }, USCITA) }

  // ── Credenziali ────────────────────────────────────────────────────────
  const cr = useUscita<StatoCredenziali & { id: string }>()
  const [impostando, setImpostando] = useState(false)
  async function impostaPassword() {
    const c = cr.dati
    if (!c) return
    setImpostando(true)
    try {
      const res = await fetch('/api/users/password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, password: c.pw }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Reset non riuscito')
      cr.setDati(x => (x ? { ...x, chiede: false } : x))
      toast({ title: 'Password di ' + c.nome.split(' ')[0] + ' aggiornata' })
    } catch (e) {
      toast({ title: 'Password non aggiornata', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setImpostando(false)
    }
  }
  // Il foglio delle credenziali entra dopo che il form è uscito (340 ms nel prototipo).
  const mostraCredenziali = (c: StatoCredenziali & { id: string }) => {
    if (tCr.current) clearTimeout(tCr.current)
    tCr.current = setTimeout(() => cr.apri(c), USCITA + 20)
  }

  // ── Form ───────────────────────────────────────────────────────────────
  const f = useUscita<StatoForm>()
  const NW = f.dati
  const [salvando, setSalvando] = useState(false)
  const [confElimina, setConfElimina] = useState(false)
  const set = (x: Partial<StatoForm>) => f.setDati(d => (d ? { ...d, ...x } : d))
  const usernames = dip.map(d => d.username ?? '').filter(Boolean)

  function apriNuovo() {
    setConfElimina(false)
    f.apri({ id: null, t: '', loc1: single ? currentRestaurantId : loc, rep1: null, role: 'dipendente', u: null, pw: generaPassword(), bacheca: false, ore: null, riposi: 1, pref: null, fasce: [], jolly: [], senior: false })
  }
  function apriModifica(d: DipendenteRiga) {
    setConfElimina(false)
    f.apri({
      id: d.id, t: d.full_name, loc1: d.restaurant_id, rep1: d.department, role: ruoloDi(d), u: d.username ?? '', pw: '',
      bacheca: d.can_post_bulletin, ore: d.weekly_hours_target, riposi: d.weekly_rest_days ?? 1, pref: d.preferred_rest_day,
      fasce: d.primary_slot_ids ?? [], jolly: (d.secondary_departments ?? []) as SecondaryDepartment[], senior: d.can_substitute_capo_servizio ?? false,
    })
  }

  const ruoli: RuoloK[] = single ? ['dipendente', 'capo'] : ['dipendente', 'capo', 'direttore', 'cassiere', 'hostess', 'manager']
  if (NW && !ruoli.includes(NW.role)) ruoli.push(NW.role)
  const serveReparto = !!NW && !SENZA_REPARTO.includes(NW.role)
  const userMostrato = NW ? (NW.u != null ? NW.u : usernameDa(NW.t, usernames)) : ''
  const ok = !!NW && !!NW.t.trim() && !!NW.loc1 && (!serveReparto || !!NW.rep1) && !!userMostrato

  async function salva() {
    if (!NW || !ok) return
    const edi = NW.id != null
    const role = NW.role === 'capo' || NW.role === 'direttore' ? 'capo_servizio' : NW.role
    const base = {
      full_name: NW.t.trim(), role, department: serveReparto ? NW.rep1 : null, restaurant_id: NW.loc1,
      is_direttore: NW.role === 'direttore', can_post_bulletin: NW.role === 'direttore' || ((NW.role === 'capo') && NW.bacheca),
    }
    setSalvando(true)
    try {
      if (edi) {
        const res = await fetch('/api/users', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: NW.id, ...base, username: userMostrato,
            weekly_rest_days: NW.riposi, preferred_rest_day: NW.pref, primary_slot_ids: NW.fasce,
            secondary_departments: NW.jolly, weekly_hours_target: NW.ore || null, can_substitute_capo_servizio: NW.senior,
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (j && (j.id || j.profile)) { const p = (j.id ? j : j.profile) as DipendenteRiga; setDip(ds => ds.map(d => (d.id === p.id ? { ...d, ...p } : d))) }
        if (!res.ok) throw new Error(j.error ?? 'Salvataggio non riuscito')
        if (NW.pw) {
          const r2 = await fetch('/api/users/password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: NW.id, password: NW.pw }) })
          const j2 = await r2.json().catch(() => ({}))
          if (!r2.ok) throw new Error(j2.error ?? 'Password non aggiornata')
          f.chiudi()
          mostraCredenziali({ id: NW.id!, nome: NW.t.trim(), user: userMostrato, pw: NW.pw, modo: 'reset', chiede: false })
        } else {
          f.chiudi()
          toast({ title: `Dati di ${NW.t.trim()} aggiornati` })
        }
      } else {
        const res = await fetch('/api/users', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...base, username: userMostrato, password: NW.pw }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error ?? 'Creazione non riuscita')
        setDip(ds => [...ds, j as DipendenteRiga].sort((a, b) => a.full_name.localeCompare(b.full_name, 'it')))
        setNuovi(n => [...n, (j as DipendenteRiga).id])
        f.chiudi()
        mostraCredenziali({ id: (j as DipendenteRiga).id, nome: NW.t.trim(), user: userMostrato, pw: NW.pw, modo: 'nuovo', chiede: false })
      }
    } catch (e) {
      toast({ title: edi ? 'Modifica non riuscita' : 'Account non creato', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSalvando(false)
    }
  }

  async function elimina() {
    if (!NW?.id) return
    if (!confElimina) { setConfElimina(true); return }
    setSalvando(true)
    const res = await fetch(`/api/users?id=${NW.id}`, { method: 'DELETE' })
    const j = await res.json().catch(() => ({}))
    setSalvando(false)
    if (!res.ok) { toast({ title: 'Eliminazione non riuscita', description: j.error, variant: 'destructive' }); return }
    setDip(ds => ds.filter(d => d.id !== NW.id))
    setSel(null)
    f.chiudi()
    toast({ title: `Account di ${NW.t.trim()} eliminato` })
  }

  // ── Dettaglio ──────────────────────────────────────────────────────────
  const x = L.find(d => d.id === selEff)
  let d: DatiDettaglio | null = null
  if (x) {
    const r = ruoloDi(x), sn = (v: boolean) => (v ? 'Sì' : 'No')
    const principali = (x.primary_slot_ids ?? []).map(id => fascia.get(id)).filter(Boolean).map(s => s!.name)
    const jolly = ((x.secondary_departments ?? []) as SecondaryDepartment[]).map(j => fascia.get(j.slot_id)).filter(Boolean).map(s => s!.department)
    d = {
      titolo: x.full_name, sotto: [RUOLO_L[r] ?? x.role, x.department, info(x.restaurant_id)?.nome].filter(Boolean).join(' · '), tag: RUOLO_L[r] ?? x.role, tono: 'neu',
      sezioni: [
        { h: 'Account', righe: [{ l: 'Username', v: x.username ?? '—' }, { l: 'Permesso bacheca', v: sn(x.can_post_bulletin || r === 'direttore') }, { l: 'Direttore del locale', v: sn(r === 'direttore') }] },
        {
          h: 'Parametri turni', righe: [
            { l: 'Ore settimanali target', v: x.weekly_hours_target ? x.weekly_hours_target + 'h' : 'Tempo pieno' },
            { l: 'Riposi settimanali', v: String(x.weekly_rest_days ?? 1) },
            { l: 'Riposo preferito', v: x.preferred_rest_day != null ? WEEK_DAYS_FULL[x.preferred_rest_day] : 'Nessuno' },
            { l: 'Fasce principali', v: principali.length ? [...new Set(principali)].join(', ') : '—' },
            { l: 'Jolly su altri reparti', v: jolly.length ? [...new Set(jolly)].join(', ') : 'No' },
            { l: 'Può sostituire il capo servizio', v: sn(!!x.can_substitute_capo_servizio) },
          ],
        },
      ],
      azioni: [
        // La password di un manager non si reimposta da qui (lo vieta anche l'API).
        ...(x.role !== 'manager' && x.id !== currentUserId ? [{
          l: 'Reimposta password', stile: 'contorno' as const,
          onClick: () => cr.apri({ id: x.id, nome: x.full_name, user: x.username ?? '', pw: generaPassword(), modo: 'reset', chiede: true }),
        }] : []),
        { l: 'Modifica', stile: 'nero', onClick: () => apriModifica(x), disabilitata: isPending },
      ],
    }
  }

  // Fasce del locale scelto nel form: principali del reparto, jolly degli altri.
  const fasceLoc = NW?.loc1 ? fasce.filter(s => s.restaurant_id === NW.loc1) : []
  const fasceRep = fasceLoc.filter(s => s.department === NW?.rep1)
  const fasceJolly = fasceLoc.filter(s => s.department !== NW?.rep1)
  const etFascia = (s: ShiftSlot) => `${s.name} ${hhmm(s.start_time)}–${hhmm(s.end_time)}`
  const edi = NW?.id != null

  if (consulenti) return <ConsulenteLavoroManager managerId={currentUserId} restaurants={restaurants} schede={schede} disabilitato={isPending} />

  return (
    <div data-sk-root="" data-sk-on={sk === 'on' ? '1' : undefined} className="relative box-border flex h-full flex-col gap-3 px-4 sm:px-8">
      <BarraAltro
        locali={!single ? <PilloleLocali locali={locali} selezionati={loc ? [loc] : []} onCambia={ids => { setLoc(ids[0] ?? null); setSel(null); avvia(); pronto() }} className="sm:mx-0 sm:px-0" /> : undefined}
        schede={schede} filtri={filtri} kpis={kpis} nuovo={{ l: 'Nuovo dipendente', corta: 'Nuovo', onClick: apriNuovo, disabilitato: isPending }}
        ricerca={<CampoRicerca valore={cerca} onCambia={v => { setCerca(v); setSel(null) }} segnaposto={tel ? 'Cerca' : 'Cerca nome, reparto, locale'} />}
        // I consulenti sono una scheda a parte, non un reparto: sul telefono
        // restano un pulsante a sé, fuori dal foglio dei filtri.
        accanto={!single ? (
          <button type="button" onClick={() => { setConsulenti(true); setSel(null) }}
            className="flex h-10 flex-none items-center gap-1 whitespace-nowrap rounded-[8px] border border-[oklch(0.88_0.01_250)] bg-card px-3 text-[13px] font-medium active:scale-[0.97] dark:border-line-strong">
            Consulenti
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
          </button>
        ) : undefined}
      />
      <GrigliaAltro>
        <ElencoAltro
          testate={[{ l: 'Nome', a: 'left' }, { l: 'Ore / sett.', a: 'right' }, { l: 'Riposi', a: 'right' }, { l: 'Ruolo', a: 'right' }]}
          colonne="minmax(0,1.4fr) 100px 92px 132px" righe={righe} scelta={selEff} onScegli={scegli}
          vuoto={cerca.trim()
            ? { t: `Nessun risultato per «${cerca.trim()}»`, s: 'Controlla come è scritto o togli i filtri.' }
            : { t: 'Nessuna persona', s: reps.length || loc ? 'Nessuno in questo locale o reparto.' : 'Aggiungi la prima con Nuovo dipendente.' }}
        />
        <PannelloDettaglio d={d} chiave={`dip|${selEff}|${loc}`} esce={esceD} onChiudi={chiudiDettaglio} senzaRighe={righe.length === 0} />
      </GrigliaAltro>
      {sk !== 'no' && <ScheletroForma esce={sk === 'out'} />}

      <FoglioAltro aperto={!!NW} esce={f.esce} onChiudi={() => f.chiudi()} testata={<TestataFoglio titolo={edi ? 'Modifica dipendente' : 'Nuovo dipendente'} onChiudi={() => f.chiudi()} />}>
        {NW && (
          <CorpoFoglio>
            <Campo etichetta="Nome e cognome"><Testo value={NW.t} onChange={v => set({ t: v })} placeholder="Es. Mario Esposito" /></Campo>
            {!single && <GruppoPillole etichetta="Locale" opzioni={restaurants.map(r => ({ v: r.id, l: r.name }))} scelte={NW.loc1 ? [NW.loc1] : []} onTocca={v => set({ loc1: v, fasce: [], jolly: [] })} />}
            {serveReparto && <GruppoPillole etichetta="Reparto" opzioni={DEPARTMENTS.map(v => ({ v, l: v }))} scelte={NW.rep1 ? [NW.rep1] : []} onTocca={v => set({ rep1: v, fasce: [] })} />}
            <GruppoPillole etichetta="Ruolo" opzioni={ruoli.map(v => ({ v, l: RUOLO_L[v] }))} scelte={[NW.role]} onTocca={v => set({ role: v })} />
            <div className="grid gap-3" style={{ gridTemplateColumns: tel ? '1fr' : '1fr 1fr' }}>
              <Campo etichetta="Username">
                <Testo mono autoCapitalize="none" value={userMostrato} onChange={v => set({ u: v.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} />
              </Campo>
              <Campo etichetta="Password">
                <div className="box-border flex h-[52px] items-center gap-0.5 rounded-[6px] border border-line-strong bg-background pl-3.5 pr-1">
                  <span key={NW.pw || 'inv'} className={cn('anim-swapin min-w-0 flex-1 truncate font-mono text-lg font-medium tracking-[.06em]', !NW.pw && 'text-base tracking-normal text-muted-foreground')}>{NW.pw || 'invariata'}</span>
                  <button type="button" aria-label="Rigenera password" onClick={() => set({ pw: generaPassword() })} className="flex h-11 w-11 flex-none items-center justify-center rounded-[8px] text-[oklch(0.35_0.01_250)] active:scale-[0.94] dark:text-[oklch(0.8_0.01_250)]">{ICONA_RIGENERA}</button>
                  <button type="button" aria-label="Copia password" onClick={() => { if (NW.pw) copiaConAvviso(NW.pw, 'Password copiata') }} className="flex h-11 w-11 flex-none items-center justify-center rounded-[8px] text-[oklch(0.35_0.01_250)] active:scale-[0.94] dark:text-[oklch(0.8_0.01_250)]">{ICONA_COPIA}</button>
                </div>
              </Campo>
            </div>
            {NW.role === 'capo' && <GruppoPillole etichetta="Può pubblicare in bacheca" opzioni={[{ v: 'si', l: 'Sì' }, { v: 'no', l: 'No' }]} scelte={[NW.bacheca ? 'si' : 'no']} onTocca={v => set({ bacheca: v === 'si' })} />}
            {edi && (
              // Parametri usati dalla generazione dei turni: nel prototipo si
              // vedono nel dettaglio, qui restano modificabili.
              <>
                <span className="pt-1 text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Parametri turni</span>
                <Campo etichetta="Ore settimanali target (vuoto = tempo pieno)">
                  <CampoNumerico value={NW.ore} onChange={v => set({ ore: v || null })} decimali={0} min={0} max={60} suffisso="h" placeholder="Tempo pieno" className="h-[52px] rounded-[6px] border-line-strong" />
                </Campo>
                <GruppoPillole etichetta="Riposi settimanali" opzioni={['0', '1', '2', '3'].map(v => ({ v, l: v }))} scelte={[String(NW.riposi)]} onTocca={v => set({ riposi: Number(v) })} />
                <GruppoPillole etichetta="Riposo preferito" opzioni={[{ v: '', l: 'Nessuno' }, ...GIORNI.map(g => ({ v: String(g), l: WEEK_DAYS_SHORT[g] }))]}
                  scelte={[NW.pref == null ? '' : String(NW.pref)]} onTocca={v => set({ pref: v === '' ? null : Number(v) })} />
                {fasceRep.length > 0 && (
                  <GruppoPillole etichetta={`Fasce principali · ${NW.rep1}`} opzioni={fasceRep.map(s => ({ v: s.id, l: etFascia(s) }))} scelte={NW.fasce}
                    onTocca={v => set({ fasce: NW.fasce.includes(v) ? NW.fasce.filter(y => y !== v) : [...NW.fasce, v] })} />
                )}
                {!single && fasceJolly.length > 0 && (
                  <GruppoPillole etichetta="Jolly su altri reparti" opzioni={fasceJolly.map(s => ({ v: s.id, l: `${s.department} · ${etFascia(s)}` }))} scelte={NW.jolly.map(j => j.slot_id)}
                    onTocca={v => set({ jolly: NW.jolly.some(j => j.slot_id === v) ? NW.jolly.filter(j => j.slot_id !== v) : [...NW.jolly, { slot_id: v, priority: 2 }] })} />
                )}
                <GruppoPillole etichetta="Può sostituire il capo servizio" opzioni={[{ v: 'si', l: 'Sì' }, { v: 'no', l: 'No' }]} scelte={[NW.senior ? 'si' : 'no']} onTocca={v => set({ senior: v === 'si' })} />
              </>
            )}
            <Nota>{edi
              ? 'Rigenera la password solo se va cambiata: dopo il salvataggio la vedi per condividerla.'
              : 'Username proposto dal nome, puoi cambiarlo. La password è generata: rigenerala se vuoi, la rivedi dopo il salvataggio per condividerla.'}</Nota>
            <PulsantiSalva onAnnulla={() => f.chiudi()} onSalva={salva} etichetta={edi ? 'Salva modifiche' : 'Crea account'} attivo={ok} occupato={salvando}
              elimina={edi && NW.id !== currentUserId && (!single || NW.role !== 'manager') ? { conferma: confElimina, onClick: elimina } : undefined} />
          </CorpoFoglio>
        )}
      </FoglioAltro>

      <FoglioCredenziali cr={cr.dati} esce={cr.esce} onChiudi={() => cr.chiudi()} occupato={impostando}
        onRigenera={() => cr.setDati(c => (c ? { ...c, pw: generaPassword() } : c))} onImposta={impostaPassword} />
    </div>
  )
}
