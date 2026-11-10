'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { useAccountStatus } from '@/contexts/AccountStatusContext'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  createTurn, updateTurn, deleteTurn, createTurnsBulk, populateFromStandard, copyWeek, salvaSettimanaTipo,
  type TurnInput,
} from '@/app/actions/turni'
import { scopeTurnsQuery, type ScopeProfile } from '@/lib/turniScope'
import { chiediConferma } from '@/components/shared/Conferma'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { ScheletroForma } from '@/components/shared/ScheletroForma'
import { useScheletro } from '@/components/shared/useScheletro'
import { impostaSottotitolo } from '@/components/shell/intestazioneDinamica'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import type { Turn, Department, StandardShift, AiScheduleDraft, AiScheduleDraftTurn } from '@/types'
import {
  TZ, Velo, useApertura, useTelefono, Segmento, ICONA_PIU, ICONA_FISSI, ICONA_COPIA, ICONA_IA,
  pesoReparto, lunediDi, giorniSettimana, piuGiorni, etichettaSettimana, etichettaSettimanaStretta,
  giornoLungo, hm, toM, nomeBreve, indiceGiorno,
} from '@/components/turni/comuni'
import { GrigliaSettimana, type GruppoGriglia } from '@/components/turni/GrigliaSettimana'
import { TimelineGiorno, type GruppoTimeline } from '@/components/turni/TimelineGiorno'
import { ModificaTurno, type SalvaModifica } from '@/components/turni/ModificaTurno'
import { FoglioNuovoTurno, type RichiestaNuovo } from '@/components/turni/FoglioNuovoTurno'
import { FoglioTurniFissi, dowDi, type GiornoSchema } from '@/components/turni/FoglioTurniFissi'
import { TurniReparto, type AssenzaReparto } from '@/components/turni/TurniReparto'
import { AiScheduleDialog } from './AiScheduleDialog'
import { AiScheduleDraftView } from './AiScheduleDraftView'

// Sezione Turni (MTTurni.dc.html) per manager e direttore, e per il capo
// servizio su tablet; sul telefono il capo servizio ha la timeline del suo
// reparto (Capo Servizio.dc.html, TurniReparto). In alto locali e reparti,
// Settimana/Giorno, Nuovo turno, Turni fissi, Copia settimana e Genera con
// IA; sotto la settimana con le frecce. Niente bozze né "Pubblica": ogni
// turno è subito visibile ai dipendenti.

const SELECT_TURNI = '*, profile:profiles!user_id(id, full_name), restaurant:restaurants(id, name)'
const ETICHETTA_ASSENZA_GRIGLIA: Record<string, string> = { malattia: 'Malattia', ferie: 'Ferie', assenza_ingiustificata: 'Assente' }

type StaffMember = { id: string; full_name: string; department: string | null; restaurant_id: string | null; role?: string | null; weekly_hours_target?: number | null }
type RestaurantItem = { id: string; name: string }

interface Props {
  initialTurns:          Turn[]
  initialStandardShifts: StandardShift[]
  initialAbsences:       AssenzaReparto[]
  staff:                 StaffMember[]
  restaurants:           RestaurantItem[]
  currentUserId:         string
  currentUserRole:       string
  currentDepartment:     string | null
  currentRestaurantId:   string | null
  currentIsDirettore:    boolean
}

// Aggiunge o aggiorna per id, mai una concat: il realtime arriva spesso
// prima dell'aggiornamento locale e una concat mostrerebbe doppioni.
function mergeTurns(prev: Turn[], incoming: Turn[]): Turn[] {
  if (!incoming.length) return prev
  const m = new Map(prev.map(t => [t.id, t]))
  for (const t of incoming) m.set(t.id, t)
  return [...m.values()]
}

const errore = (e: unknown) => e instanceof Error ? e.message : undefined

export function TurniManagerClient({
  initialTurns, initialStandardShifts, initialAbsences, staff, restaurants,
  currentUserId, currentUserRole, currentDepartment, currentRestaurantId, currentIsDirettore,
}: Props) {
  const { isPending } = useAccountStatus()
  const tel = useTelefono()
  const isManager = currentUserRole === 'manager'
  const isCapo = currentUserRole === 'capo_servizio' && !currentIsDirettore

  const [turns, setTurns] = useState<Turn[]>(initialTurns)
  const [standard, setStandard] = useState<StandardShift[]>(initialStandardShifts)
  const [assenze, setAssenze] = useState<AssenzaReparto[]>(initialAbsences)
  const [adesso, setAdesso] = useState(() => Date.now())
  const oggi = formatInTimeZone(new Date(adesso), TZ, 'yyyy-MM-dd')
  const minutoOra = toM(formatInTimeZone(new Date(adesso), TZ, 'HH:mm'))
  const lunediOggi = lunediDi(oggi)
  const [lunedi, setLunedi] = useState(() => lunediDi(formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')))
  const giorni = useMemo(() => giorniSettimana(lunedi), [lunedi])
  const domenica = giorni[6]

  // Come nel prototipo si guarda un locale alla volta (il primo); "Tutti i
  // locali" resta perché le pillole condivise lo mostrano sempre.
  const locali = useMemo(() => restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) })), [restaurants])
  // Locali scelti nelle pillole, a selezione multipla (vuoto = tutti): si
  // può lavorare su più locali insieme, come deciso dal gestore.
  const [locs, setLocs] = useState<string[]>(() => isManager && restaurants[0] ? [restaurants[0].id] : [])
  const loc = locs.length === 1 ? locs[0] : null
  const [reps, setReps] = useState<string[]>([])
  const [vista, setVista] = useState<'week' | 'day'>('week')
  const [giornoSel, setGiornoSel] = useState(() => Math.max(0, giorniSettimana(lunediDi(formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'))).indexOf(formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'))))
  const { stato: sk, avvia: avviaScheletro, pronto: scheletroPronto } = useScheletro(false)

  useEffect(() => { const t = setInterval(() => setAdesso(Date.now()), 60_000); return () => clearInterval(t) }, [])

  // Sottotitolo del guscio come nel design ("Settimana 12–18 ottobre"); il
  // direttore e il capo hanno l'intestazione col locale.
  useEffect(() => { if (isManager) impostaSottotitolo('Settimana ' + etichettaSettimanaStretta(lunedi)) }, [isManager, lunedi])
  useEffect(() => () => impostaSottotitolo(null), [])

  // ── Realtime ─────────────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient()
    const filter = !isManager && currentRestaurantId ? `restaurant_id=eq.${currentRestaurantId}` : undefined
    const channel = supabase
      .channel('rt-turni')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'turns', ...(filter ? { filter } : {}) }, async payload => {
        // Capo servizio: il filtro realtime copre il ristorante, il reparto si verifica qui.
        const inScope = (row: { department: string | null }) => !isCapo || !currentDepartment || row.department === currentDepartment
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const rec = payload.new as Turn
          if (!inScope(rec)) { setTurns(p => p.filter(t => t.id !== rec.id)); return }
          const { data } = await supabase.from('turns').select(SELECT_TURNI).eq('id', rec.id).single()
          if (data) setTurns(p => mergeTurns(p, [data as unknown as Turn]))
        } else if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id: string }).id
          setTurns(p => p.filter(t => t.id !== id))
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [isManager, isCapo, currentDepartment, currentRestaurantId])

  // ── Settimane caricate al volo ───────────────────────────────────────
  // Il server carica la settimana corrente ±1; le altre si chiedono quando
  // si naviga, invece di scaricare tutta la storia dei turni.
  const caricate = useRef<Set<string>>(new Set([-7, 0, 7].map(d => piuGiorni(lunediDi(formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')), d))))
  const caricaSettimana = useCallback(async (lun: string) => {
    if (caricate.current.has(lun)) return true
    const supabase = createClient()
    const scope: ScopeProfile = { role: currentUserRole, restaurant_id: currentRestaurantId, department: currentDepartment, is_direttore: currentIsDirettore }
    const fine = piuGiorni(lun, 6)
    let q = supabase.from('turns').select(SELECT_TURNI).gte('date', lun).lte('date', fine)
    q = scopeTurnsQuery(q, scope, currentUserId)
    const [{ data, error }, ass] = await Promise.all([
      q,
      // Assenze approvate della settimana per tutti (griglia e timeline):
      // il manager le vede su tutti i suoi locali (RLS), gli altri sul proprio.
      (isManager
        ? supabase.from('absences').select('user_id, type, start_date, end_date').eq('status', 'approved').lte('start_date', fine).gte('end_date', lun)
        : currentRestaurantId
          ? supabase.from('absences').select('user_id, type, start_date, end_date').eq('status', 'approved').eq('restaurant_id', currentRestaurantId).lte('start_date', fine).gte('end_date', lun)
          : Promise.resolve({ data: null })),
    ])
    if (error) { toast({ title: 'Caricamento dei turni non riuscito', description: error.message, variant: 'destructive' }); return false }
    caricate.current.add(lun)
    setTurns(p => mergeTurns(p, (data ?? []) as unknown as Turn[]))
    if (ass.data) setAssenze(p => [...p, ...(ass.data as AssenzaReparto[])])
    return true
  }, [currentUserRole, currentRestaurantId, currentDepartment, currentIsDirettore, currentUserId, isManager])

  async function vaiASettimana(lun: string) {
    setLunedi(lun)
    setGiornoSel(lun === lunediOggi ? indiceGiorno(oggi) : 0)
    avviaScheletro()
    await caricaSettimana(lun)
    scheletroPronto()
  }
  function cambiaLocali(ids: string[]) {
    setLocs(ids); setReps([])
    avviaScheletro(); scheletroPronto()
  }

  // ── Dati della vista ─────────────────────────────────────────────────
  const staffLoc = isManager && locs.length ? staff.filter(s => s.restaurant_id && locs.includes(s.restaurant_id)) : staff
  const reparti = [...new Set(staffLoc.map(s => s.department).filter((d): d is string => !!d))]
    .sort((a, b) => pesoReparto(a) - pesoReparto(b) || a.localeCompare(b))
  const E = reps.length ? staffLoc.filter(s => s.department && reps.includes(s.department)) : staffLoc
  const nomeLocale = (id: string | null) => restaurants.find(r => r.id === id)?.name ?? ''

  const perCella = useMemo(() => {
    const m = new Map<string, Turn[]>()
    for (const t of turns) {
      if (t.date < lunedi || t.date > domenica) continue
      const k = `${t.user_id}|${t.date}`
      m.set(k, [...(m.get(k) ?? []), t])
    }
    m.forEach(l => l.sort((a, b) => a.start_time.localeCompare(b.start_time)))
    return m
  }, [turns, lunedi, domenica])

  const perReparto = <T,>(map: (s: StaffMember) => T) => {
    const gruppi = new Map<string | null, StaffMember[]>()
    for (const s of E) gruppi.set(s.department ?? null, [...(gruppi.get(s.department ?? null) ?? []), s])
    return [...gruppi.entries()]
      .sort(([a], [b]) => pesoReparto(a) - pesoReparto(b) || (a ?? '').localeCompare(b ?? ''))
      .map(([n, membri]) => ({ n: n ?? 'Senza reparto', righe: membri.map(map) }))
  }
  const gruppiGriglia: GruppoGriglia[] = perReparto(s => ({
    id: s.id, nome: s.full_name, nomeBreve: nomeBreve(s.full_name),
    sotto: [s.role === 'capo_servizio' ? 'Capo servizio' : (s.department ?? ''), isManager && !loc ? nomeLocale(s.restaurant_id) : ''].filter(Boolean).join(' · '),
    obiettivo: s.weekly_hours_target ?? 40,
    celle: giorni.map(g => perCella.get(`${s.id}|${g}`) ?? []),
    assenze: giorni.map(g => { const a = assenze.find(x => x.user_id === s.id && x.start_date <= g && x.end_date >= g && x.type !== 'riposo'); return a ? ETICHETTA_ASSENZA_GRIGLIA[a.type] ?? 'Assente' : null }),
  }))
  const gruppiTimeline: GruppoTimeline[] = perReparto(s => ({ id: s.id, nome: s.full_name, turni: perCella.get(`${s.id}|${giorni[giornoSel]}`) ?? [] }))
  const dipendentiFoglio = staffLoc
    .slice().sort((a, b) => pesoReparto(a.department) - pesoReparto(b.department) || a.full_name.localeCompare(b.full_name, 'it'))
    .map(s => ({ id: s.id, nome: s.full_name, rep: s.role === 'capo_servizio' ? 'Capo servizio' : (s.department ?? '') }))
  const sottoFoglio = (loc ? nomeLocale(loc) : isManager ? (locs.length ? locs.map(nomeLocale).join(', ') : 'Tutti i locali') : nomeLocale(currentRestaurantId) || 'Il tuo locale')

  // ── Scritture ────────────────────────────────────────────────────────
  const inputPer = (userId: string, date: string, x: Partial<TurnInput>): TurnInput => {
    const s = staff.find(m => m.id === userId)
    return {
      user_id: userId, restaurant_id: s?.restaurant_id ?? currentRestaurantId ?? '', department: (s?.department ?? currentDepartment) as Department | null,
      date, start_time: '18:00', end_time: '23:00', is_extraordinary: false, is_rest_day: false, notes: null, ...x,
    }
  }

  // Un turno di lavoro prende il posto del riposo dello stesso giorno (come
  // nel prototipo, che sostituisce il contenuto della cella).
  async function togliRiposi(userId: string, date: string) {
    const riposi = turns.filter(t => t.user_id === userId && t.date === date && t.is_rest_day)
    for (const r of riposi) { await deleteTurn(r.id); setTurns(p => p.filter(t => t.id !== r.id)) }
  }

  async function creaDaFoglio(r: RichiestaNuovo): Promise<boolean> {
    const riposo = r.tipo === 'riposo', st = r.tipo === 'straordinario'
    try {
      let creati: Turn[] = []
      if (r.settimane > 1) {
        // Stesso orario per più settimane: una creazione in blocco per fascia.
        const fasce = riposo ? [{ a: '00:00', b: '00:00' }] : r.voci[0].fasce
        const base = inputPer(r.userId, lunedi, {})
        const res = await Promise.all(fasce.map(f => createTurnsBulk({
          user_id: r.userId, restaurant_id: base.restaurant_id, department: base.department,
          start_date: lunedi, end_date: piuGiorni(lunedi, r.settimane * 7 - 1),
          days_of_week: r.voci.map(v => dowDi(v.giorno)),
          start_time: f.a, end_time: f.b, is_extraordinary: st, is_rest_day: riposo, notes: null,
        })))
        creati = res.flat()
      } else {
        const res = await Promise.all(r.voci.flatMap(v => (riposo ? [{ a: '00:00', b: '00:00' }] : v.fasce).map(f =>
          createTurn(inputPer(r.userId, giorni[v.giorno], { start_time: f.a, end_time: f.b, is_extraordinary: st, is_rest_day: riposo })))))
        creati = res.filter((t): t is Turn => t !== null)
      }
      setTurns(p => mergeTurns(p, creati))
      if (!riposo) for (const v of r.voci) await togliRiposi(r.userId, giorni[v.giorno])
      const n = creati.length
      toast({ title: r.settimane > 1 ? `${n} turni creati su ${r.settimane} settimane` : n === 1 ? 'Turno creato' : `${n} turni creati` })
      return true
    } catch (e) {
      toast({ title: 'Creazione del turno non riuscita', description: errore(e), variant: 'destructive' })
      return false
    }
  }

  async function salvaModifica(t: Turn, v: SalvaModifica): Promise<boolean> {
    const riposo = v.tipo === 'riposo'
    try {
      const nuovo = await updateTurn(t.id, inputPer(t.user_id, t.date, {
        restaurant_id: t.restaurant_id, department: t.department,
        start_time: riposo ? '00:00' : v.a, end_time: riposo ? '00:00' : v.b,
        is_extraordinary: !riposo && v.tipo === 'straordinario', is_rest_day: riposo, notes: v.nota || null,
      }))
      setTurns(p => mergeTurns(p, [nuovo]))
      toast({ title: 'Turno aggiornato' })
      return true
    } catch (e) {
      toast({ title: 'Salvataggio non riuscito', description: errore(e), variant: 'destructive' })
      return false
    }
  }

  async function elimina(t: Turn): Promise<boolean> {
    if (!(await chiediConferma({ titolo: 'Eliminare il turno?', testo: 'Il dipendente non lo vedrà più tra i suoi turni.' }))) return false
    try {
      await deleteTurn(t.id)
      setTurns(p => p.filter(x => x.id !== t.id))
      toast({ title: 'Turno eliminato' })
      return true
    } catch (e) {
      toast({ title: 'Eliminazione non riuscita', description: errore(e), variant: 'destructive' })
      return false
    }
  }

  // Trascinamento sulla timeline: aggiornamento ottimistico, ripristino se il server rifiuta.
  async function sposta(t: Turn, a: number, b: number) {
    const prima = t
    const ora = { ...t, start_time: hm(a), end_time: hm(b) }
    setTurns(p => mergeTurns(p, [ora]))
    try {
      const nuovo = await updateTurn(t.id, inputPer(t.user_id, t.date, {
        restaurant_id: t.restaurant_id, department: t.department, start_time: hm(a), end_time: hm(b),
        is_extraordinary: t.is_extraordinary, is_rest_day: false, notes: t.notes,
      }))
      setTurns(p => mergeTurns(p, [nuovo]))
      toast({ title: `Turno spostato alle ${hm(a)}–${hm(b)}` })
    } catch (e) {
      setTurns(p => mergeTurns(p, [prima]))
      toast({ title: 'Spostamento non riuscito', description: errore(e), variant: 'destructive' })
    }
  }

  async function creaDaTimeline(userId: string, a: number, b: number) {
    const data = giorni[giornoSel]
    try {
      const t = await createTurn(inputPer(userId, data, { start_time: hm(a), end_time: hm(b) }))
      if (t) setTurns(p => mergeTurns(p, [t]))
      await togliRiposi(userId, data)
      toast({ title: `Turno creato ${hm(a)}–${hm(b)}` })
    } catch (e) {
      toast({ title: 'Creazione del turno non riuscita', description: errore(e), variant: 'destructive' })
    }
  }

  const [copia, setCopia] = useState(false)
  async function copiaSettimana() {
    if (copia) return
    setCopia(true)
    try {
      const { created, skipped } = await copyWeek(piuGiorni(lunedi, -7), lunedi)
      caricate.current.delete(lunedi)
      await caricaSettimana(lunedi)
      toast({ title: created ? `${created} turni copiati dalla settimana precedente${skipped ? `, ${skipped} già presenti` : ''}` : 'Nessun turno da copiare dalla settimana precedente' })
    } catch (e) {
      toast({ title: 'Copia della settimana non riuscita', description: errore(e), variant: 'destructive' })
    } finally { setCopia(false) }
  }

  async function ricaricaSettimane(n: number) {
    for (let w = 0; w < n; w++) caricate.current.delete(piuGiorni(lunedi, w * 7))
    await caricaSettimana(lunedi)
  }

  async function popolaTutti(n: number): Promise<boolean> {
    try {
      const { created, skipped } = await populateFromStandard(lunedi, piuGiorni(lunedi, n * 7 - 1))
      await ricaricaSettimane(n)
      toast({ title: `${created} turni creati${skipped ? `, ${skipped} saltati perché già presenti` : ''}` })
      return true
    } catch (e) {
      toast({ title: 'Popolamento non riuscito', description: errore(e), variant: 'destructive' })
      return false
    }
  }

  async function salvaFissi(userId: string, schema: GiornoSchema[], toccati: number[], n: number): Promise<boolean> {
    try {
      const giorniTipo = schema.map((x, d) => ({ day_of_week: dowDi(d), tipo: x.on === 'work' ? 'lavoro' as const : x.on === 'rip' ? 'riposo' as const : 'nessuno' as const, start_time: x.a, end_time: x.b }))
      const r = await salvaSettimanaTipo({ user_id: userId, giorni: giorniTipo, toccati, lunedi, settimane: n })
      setStandard(p => [...p.filter(s => s.user_id !== userId), ...(r.standard as StandardShift[])])
      await ricaricaSettimane(n)
      toast({ title: `${r.created} turni creati${r.skipped ? `, ${r.skipped} saltati perché già modificati` : ''}` })
      if (r.riposiNonRicordati) toast({ title: 'I riposi sono stati applicati ma non salvati tra i turni fissi', variant: 'destructive' })
      return true
    } catch (e) {
      toast({ title: 'Salvataggio dei turni fissi non riuscito', description: errore(e), variant: 'destructive' })
      return false
    }
  }

  // ── Fogli ────────────────────────────────────────────────────────────
  const modifica = useApertura<Turn>()
  const nuovo = useApertura<{ emp: string | null; giorni: number[]; k: number }>()
  const fissi = useApertura<number>()
  const [aiAperto, setAiAperto] = useState(false)
  const [aiDraft, setAiDraft] = useState<(AiScheduleDraft & { turns: AiScheduleDraftTurn[] }) | null>(null)
  const [occupato, setOccupato] = useState(false)
  const contatore = useRef(0)
  const apriNuovo = (emp: string | null, g: number[]) => { if (!isPending) nuovo.apri({ emp, giorni: g, k: ++contatore.current }) }
  const restaurantAi = isManager ? (loc ?? '') : (currentRestaurantId ?? '')

  const ed = modifica.dati
  const fogli = (
    <>
      <Velo aperto={!!ed} esce={modifica.esce} onChiudi={modifica.chiudi} altoTablet={220}>
        {ed && (
          <div onClick={e => e.stopPropagation()} style={{ width: tel ? '100%' : 'min(520px, 100%)' }}>
            <ModificaTurno
              key={ed.id}
              nome={staff.find(s => s.id === ed.user_id)?.full_name ?? ed.profile?.full_name ?? ''}
              giorno={giornoLungo(ed.date)}
              inizio={ed.is_rest_day ? '' : hm(toM(ed.start_time))} fine={ed.is_rest_day ? '' : hm(toM(ed.end_time))}
              tipo={ed.is_extraordinary ? 'straordinario' : 'standard'} nota={ed.notes ?? ''}
              raggio={tel ? '20px 20px 0 0' : '10px'} padB={tel ? 'calc(44px + env(safe-area-inset-bottom))' : '24px'}
              ombra="0 20px 60px rgba(20,30,50,.2)" anim={modifica.esce ? 'anim-swapout' : 'anim-swapin'} occupato={occupato}
              onClose={modifica.chiudi}
              onSave={async v => { setOccupato(true); const ok = await salvaModifica(ed, v); setOccupato(false); if (ok) modifica.chiudi() }}
              onDelete={async () => { setOccupato(true); const ok = await elimina(ed); setOccupato(false); if (ok) modifica.chiudi() }}
            />
          </div>
        )}
      </Velo>
      {nuovo.dati && (
        <FoglioNuovoTurno
          key={nuovo.dati.k} esce={nuovo.esce} onChiudi={nuovo.chiudi}
          sotto={`${sottoFoglio} · settimana ${etichettaSettimanaStretta(lunedi)}`}
          dipendenti={dipendentiFoglio} giorni={giorni} iniziale={nuovo.dati} onCrea={creaDaFoglio}
        />
      )}
      {fissi.dati !== null && (
        <FoglioTurniFissi
          key={fissi.dati} esce={fissi.esce} onChiudi={fissi.chiudi}
          sotto={`${sottoFoglio} · orario ricorrente per giorno della settimana`}
          dipendenti={dipendentiFoglio} standard={standard} onSalva={salvaFissi} onPopolaTutti={popolaTutti}
        />
      )}
      <AiScheduleDialog
        open={aiAperto} onClose={() => setAiAperto(false)}
        restaurantId={restaurantAi} restaurantName={nomeLocale(restaurantAi)} weekStart={lunedi}
        currentDept={currentDepartment as Department | null} currentUserRole={currentUserRole} currentIsDirettore={currentIsDirettore}
        onDraftCreated={d => { setAiDraft(d); setAiAperto(false) }}
      />
      {aiDraft && (
        <AiScheduleDraftView
          draft={aiDraft} staff={staff}
          onClose={() => setAiDraft(null)}
          onConfirmed={async () => { const lun = aiDraft.week_start; setAiDraft(null); caricate.current.delete(lun); await caricaSettimana(lun) }}
        />
      )}
    </>
  )

  // ── Capo servizio sul telefono: timeline del reparto ─────────────────
  if (isCapo && tel) {
    return (
      <div className="box-border h-full px-4">
        <TurniReparto
          reparto={currentDepartment ?? 'Reparto'} lunedi={lunedi} giorni={giorni} oggi={oggi}
          staff={staff} turni={turns.filter(t => t.date >= lunedi && t.date <= domenica)} assenze={assenze}
          onSettimana={d => vaiASettimana(d === null ? lunediOggi : piuGiorni(lunedi, d * 7))}
          onSposta={sposta} onSalva={salvaModifica} onElimina={elimina}
          onAggiungi={g => apriNuovo(null, [g])}
        />
        {fogli}
      </div>
    )
  }

  // ── Barra ────────────────────────────────────────────────────────────
  const settimanaCorrente = lunedi === lunediOggi
  const passata = lunedi < lunediOggi
  const statoSettimana = settimanaCorrente ? 'in corso · visibile ai dipendenti' : passata ? 'conclusa' : 'visibile ai dipendenti'
  const multiLoc = isManager && locali.length > 1
  const tastoCls = 'box-border flex h-10 min-w-10 items-center justify-center whitespace-nowrap rounded-[8px] border border-line-strong bg-card text-sm font-medium active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100'
  const disatt = isPending ? 'Disponibile dopo l\'attivazione' : undefined
  const vediGiorno = !tel && vista === 'day'

  return (
    <div data-sk-root="" data-sk-on={sk === 'on' ? '1' : undefined} className={cn('relative box-border flex h-full flex-col', tel ? 'gap-2.5 px-4' : 'gap-3 px-8')}>
      <div className="flex flex-none flex-wrap items-center gap-2.5">
        <div data-sk-keep="" className={cn('flex min-w-0 items-center gap-2.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', tel ? '-mx-4 flex-[1_1_100%] px-4' : 'flex-[0_1_auto]')}>
          {multiLoc && (
            <>
              <PilloleLocali multipla tuttiComeVuoto locali={locali} selezionati={locs} onCambia={cambiaLocali} className="mx-0 flex-none overflow-visible px-0" />
              <span className="h-7 w-px flex-none bg-[oklch(0.88_0.01_250)] dark:bg-border" style={{ margin: '0 4px' }} />
            </>
          )}
          {reparti.length > 1 && (
            <div className={cn('flex gap-1.5', !isManager && tel && 'flex-auto')}>
              {reparti.map(rp => {
                const on = reps.includes(rp)
                return (
                  <button
                    key={rp} type="button"
                    onClick={() => setReps(p => { const r = on ? p.filter(x => x !== rp) : [...p, rp]; return r.length === reparti.length ? [] : r })}
                    className={cn('flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border px-3 text-[13px] font-medium transition-[background-color,color] duration-200 active:scale-[0.97]',
                      !isManager && tel && 'flex-1', on ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-card dark:border-line-strong')}
                  >
                    {rp}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        {!tel && <span className="flex-1" />}
        {!tel && (
          <Segmento
            className="flex-none" alto={34} voceCls="flex-none px-3.5 font-medium"
            voci={[{ k: 'week' as const, l: 'Settimana' }, { k: 'day' as const, l: 'Giorno' }]} valore={vista} onCambia={setVista}
          />
        )}
        <button data-sk-keep="" type="button" onClick={() => apriNuovo(null, [])} disabled={isPending} title={disatt} className={cn(tastoCls, tel ? 'flex-[1_1_0] gap-1.5 px-2.5' : 'flex-none gap-2 px-3.5')}>
          {ICONA_PIU(16)}{tel ? 'Nuovo' : 'Nuovo turno'}
        </button>
        <button data-sk-keep="" type="button" onClick={() => fissi.apri(++contatore.current)} disabled={isPending} title={disatt} className={cn(tastoCls, tel ? 'flex-[1_1_0] gap-1.5 px-2.5' : 'flex-none gap-2 px-3.5')}>
          {ICONA_FISSI}Turni fissi
        </button>
        <button data-sk-keep="" type="button" onClick={copiaSettimana} disabled={isPending || copia} title={disatt ?? 'Copia i turni della settimana precedente su questa'} aria-label="Copia settimana" className={cn(tastoCls, tel ? 'flex-none px-0' : 'flex-none gap-2 px-3.5')}>
          {ICONA_COPIA}{!tel && (copia ? 'Copio…' : 'Copia settimana')}
        </button>
        <button
          data-sk-keep="" type="button" onClick={() => setAiAperto(true)} disabled={isPending || !restaurantAi}
          title={disatt ?? (!restaurantAi ? 'Scegli prima un locale' : undefined)} aria-label="Genera con IA"
          className={cn('flex h-10 min-w-10 flex-none items-center justify-center gap-2 rounded-[8px] bg-primary text-sm font-semibold text-primary-foreground active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100', tel ? 'px-0' : 'px-4')}
        >
          {ICONA_IA}{!tel && 'Genera con IA'}
        </button>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-2">
        <button data-sk-keep="" type="button" onClick={() => vaiASettimana(piuGiorni(lunedi, -7))} aria-label="Settimana precedente" className="flex h-10 w-10 flex-none items-center justify-center rounded-[20px] border border-[oklch(0.88_0.01_250)] bg-card active:scale-[0.96] dark:border-line-strong">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <div className={cn('flex flex-col items-center', tel ? 'min-w-0 flex-auto' : 'min-w-[180px] flex-none')}>
          <span data-sk-keep="" className="text-[15px] font-semibold">{etichettaSettimana(lunedi)}</span>
          <span className={cn('text-xs', passata ? 'text-muted-foreground' : 'text-ok')}>{statoSettimana}</span>
        </div>
        <button data-sk-keep="" type="button" onClick={() => vaiASettimana(piuGiorni(lunedi, 7))} aria-label="Settimana successiva" className="flex h-10 w-10 flex-none items-center justify-center rounded-[20px] border border-[oklch(0.88_0.01_250)] bg-card active:scale-[0.96] dark:border-line-strong">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
        </button>
        {!settimanaCorrente && (
          <button data-sk-keep="" type="button" onClick={() => vaiASettimana(lunediOggi)} className={cn('flex h-8 items-center rounded-full bg-[oklch(0.94_0.04_180)] px-3 text-[13px] font-medium text-[oklch(0.4_0.08_180)] active:scale-[0.97] dark:bg-[oklch(0.3_0.04_180)] dark:text-[oklch(0.85_0.07_180)]', tel && 'order-9')}>
            Torna a questa settimana
          </button>
        )}
        {!tel && <span className="flex-1" />}
        {!tel && (
          <div data-sk-keep="" className="flex items-center gap-3.5 text-xs font-medium text-[oklch(0.35_0.01_250)] dark:text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] border border-[oklch(0.82_0.06_250)] bg-[oklch(0.93_0.035_250)]" />Standard</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] border border-[oklch(0.84_0.06_25)] bg-[oklch(0.94_0.035_25)]" />Riposo</span>
          </div>
        )}
      </div>

      {vediGiorno ? (
        <TimelineGiorno
          giorni={giorni} sel={giornoSel} onSel={setGiornoSel} oggi={oggi} adesso={minutoOra} gruppi={gruppiTimeline}
          onSposta={sposta} onCrea={creaDaTimeline} onTocca={t => modifica.apri(t)}
        />
      ) : (
        <GrigliaSettimana
          tel={tel} giorni={giorni} oggi={oggi} gruppi={gruppiGriglia}
          onTurno={t => modifica.apri(t)}
          onVuota={(uid, data) => apriNuovo(uid, [giorni.indexOf(data)])}
          onGiorno={i => { setGiornoSel(i); setVista('day') }}
        />
      )}

      {sk !== 'no' && <ScheletroForma esce={sk === 'out'} />}
      {fogli}
    </div>
  )
}
