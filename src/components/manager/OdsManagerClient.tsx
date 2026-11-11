'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { createOdsTask } from '@/app/actions/ods'
import { useAccountStatus } from '@/contexts/AccountStatusContext'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { chiediConferma } from '@/components/shared/Conferma'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { ScheletroForma } from '@/components/shared/ScheletroForma'
import { useScheletro } from '@/components/shared/useScheletro'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import { DEPARTMENTS, ODS_DAYS_IT, ODS_TYPE_LABELS } from '@/types'
import type { OdsTask, OdsTaskType } from '@/types'
import {
  BarraAltro, ElencoAltro, PannelloDettaglio, GrigliaAltro, FoglioAltro, TestataFoglio, CorpoFoglio, Campo, Testo,
  GruppoPillole, Nota, PulsantiSalva, Badge, useUscita, useTelefono, USCITA,
  type RigaAltro, type DatiDettaglio, type Tono,
} from '@/components/altro/comuni'

// ODS. Manager e direttore: scheda di Altro (MTAltro.dc.html, sec "ods"):
// reparti come schede, completamenti di oggi per persona, ricorrenza,
// dettaglio con chi ha fatto e chi no, foglio "Nuovo ordine di servizio".
// Capo servizio: "ODS sala" di Capo Servizio.dc.html (7d), con
// l'avanzamento di oggi del proprio reparto.

const TZ = 'Europe/Rome'
const GG = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'] as const
type Giorno = typeof GG[number]
const daGiorno = (g: Giorno) => ODS_DAYS_IT[GG.indexOf(g)]
const aGiorno = (d: string) => GG[ODS_DAYS_IT.indexOf(d.toLowerCase() as typeof ODS_DAYS_IT[number])] ?? d.slice(0, 3)
const RIC: OdsTaskType[] = ['quotidiana', 'settimanale', 'bisettimanale', 'straordinaria']
/** Giorni da scegliere per ricorrenza (prototipo: Settimanale 1, Bisettimanale 2, Straordinaria 1). */
const N_GIORNI: Record<OdsTaskType, number> = { quotidiana: 0, settimanale: 1, bisettimanale: 2, straordinaria: 1 }

export type CompletamentoRiga = { task_id: string; user_id: string; completed_at: string; profile?: { id: string; full_name: string } | null }
export type PersonaOds = { id: string; full_name: string; department: string | null; restaurant_id: string | null }

interface Props {
  vista: 'manager' | 'direttore' | 'capo'
  initialTasks: OdsTask[]
  completions: CompletamentoRiga[]
  staff: PersonaOds[]
  restaurants: { id: string; name: string }[]
  currentUserId: string
  currentDepartment: string | null
  currentRestaurantId: string | null
}

function sogliaOds(): string {
  const now = new Date()
  const h = parseInt(formatInTimeZone(now, TZ, 'H'), 10)
  const rif = h < 4 ? new Date(now.getTime() - 864e5) : now
  return fromZonedTime(`${formatInTimeZone(rif, TZ, 'yyyy-MM-dd')}T04:00:00`, TZ).toISOString()
}
const oraRoma = (iso: string) => formatInTimeZone(new Date(iso), TZ, 'H:mm')

function ricorrenza(t: OdsTask): string {
  const l = ODS_TYPE_LABELS[t.type]
  return t.recurrence_days.length && t.type !== 'quotidiana' ? `${l} · ${t.recurrence_days.map(d => aGiorno(d).toLowerCase()).join(', ')}` : l
}

export function OdsManagerClient(p: Props) {
  const { isPending } = useAccountStatus()
  const [tasks, setTasks] = useState(p.initialTasks)
  const [compl, setCompl] = useState(p.completions)
  const [nuovi, setNuovi] = useState<string[]>([])

  // Le notifiche "ODS completato" si considerano lette aprendo la pagina
  // (solo quelle degli ODS, non quelle di altre sezioni).
  useEffect(() => {
    createClient().from('notifications').update({ read_at: new Date().toISOString() })
      .eq('user_id', p.currentUserId).is('read_at', null).like('link', '%/ods%').then(() => {})
  }, [p.currentUserId])

  // Realtime: un compito spuntato da un dipendente compare subito.
  const idsRef = useRef(new Set(tasks.map(t => t.id)))
  useEffect(() => { idsRef.current = new Set(tasks.map(t => t.id)) }, [tasks])
  const ricarica = useCallback(async () => {
    const { data } = await createClient().from('ods_completions')
      .select('task_id, user_id, completed_at, profile:profiles!user_id(id, full_name)').gte('completed_at', sogliaOds())
    if (data) setCompl((data as unknown as CompletamentoRiga[]).filter(c => idsRef.current.has(c.task_id)))
  }, [])
  useEffect(() => {
    const supabase = createClient()
    let t: ReturnType<typeof setTimeout> | null = null
    const ch = supabase.channel('rt-ods-completions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ods_completions' }, () => { if (t) clearTimeout(t); t = setTimeout(ricarica, 300) })
      .subscribe()
    return () => { if (t) clearTimeout(t); supabase.removeChannel(ch) }
  }, [ricarica])

  const perTask = useMemo(() => {
    const m = new Map<string, CompletamentoRiga[]>()
    compl.forEach(c => m.set(c.task_id, [...(m.get(c.task_id) ?? []), c]))
    m.forEach(v => v.sort((a, b) => a.completed_at.localeCompare(b.completed_at)))
    return m
  }, [compl])

  const [oggiNome] = useState(() => formatInTimeZone(new Date(Date.now() - 4 * 3600e3), TZ, 'EEEE', { locale: it }).toLowerCase())
  const diOggi = (t: OdsTask) => t.type === 'quotidiana' || t.type === 'straordinaria' || t.recurrence_days.some(d => d.toLowerCase() === oggiNome)

  async function elimina(t: OdsTask, poi: () => void) {
    if (!(await chiediConferma({ titolo: "Eliminare l'ordine di servizio?", testo: 'Sparisce dalla lista di tutto il reparto.' }))) return
    const { error } = await createClient().from('ods_tasks').delete().eq('id', t.id)
    if (error) { toast({ title: 'Eliminazione non riuscita', description: error.message, variant: 'destructive' }); return }
    setTasks(x => x.filter(y => y.id !== t.id))
    poi()
    toast({ title: 'ODS eliminato' })
  }

  const form = useNuovoOds({
    ...p, deptBloccato: p.vista === 'capo' ? p.currentDepartment : null,
    onCreati: ts => { setTasks(x => [...ts, ...x]); setNuovi(n => [...n, ...ts.map(t => t.id)]) },
  })

  const comune = { tasks, perTask, diOggi, elimina, nuovi, apriForm: form.apri, disabilitato: isPending }
  return (
    <>
      {p.vista === 'capo' ? <OdsCapo {...p} {...comune} /> : <OdsAltro {...p} {...comune} />}
      {form.foglio}
    </>
  )
}

interface Comune {
  tasks: OdsTask[]
  perTask: Map<string, CompletamentoRiga[]>
  diOggi: (t: OdsTask) => boolean
  elimina: (t: OdsTask, poi: () => void) => void
  nuovi: string[]
  apriForm: () => void
  disabilitato: boolean
}

/** Persone attese su un ODS oggi: l'assegnatario o tutto il reparto del locale. */
function attese(t: OdsTask, staff: PersonaOds[]): { id: string; nome: string }[] {
  if (t.assigned_to) return [{ id: t.assigned_to, nome: t.assignee?.full_name ?? staff.find(s => s.id === t.assigned_to)?.full_name ?? '—' }]
  return staff.filter(s => s.restaurant_id === t.restaurant_id && s.department === t.department).map(s => ({ id: s.id, nome: s.full_name }))
}

function useDettaglio() {
  const [sel, setSel] = useState<string | null>(null)
  const [esce, setEsce] = useState(false)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (t.current) clearTimeout(t.current) }, [])
  return {
    sel, esce, setSel,
    scegli: (k: string) => { if (t.current) clearTimeout(t.current); setEsce(false); setSel(k) },
    chiudi: () => { setEsce(true); if (t.current) clearTimeout(t.current); t.current = setTimeout(() => { setSel(null); setEsce(false) }, USCITA) },
  }
}

function datiDettaglio(t: OdsTask, staff: PersonaOds[], comp: CompletamentoRiga[], nomeLoc: string, onElimina: () => void): DatiDettaglio {
  const pp = attese(t, staff), fatti = new Map(comp.map(c => [c.user_id, c]))
  const n = Math.max(pp.length, 1), dn = comp.length
  // Chi ha spuntato senza essere fra gli attesi (es. spostato di reparto) compare comunque.
  const extra = comp.filter(c => !pp.some(x => x.id === c.user_id)).map(c => ({ id: c.user_id, nome: c.profile?.full_name ?? '—' }))
  const chi = t.assignee?.full_name
  return {
    titolo: t.title,
    sotto: (chi ? chi + ' · ' : '') + t.department + ' · ' + nomeLoc + ' · ' + ricorrenza(t),
    tag: dn >= n ? 'Completato' : `${dn} su ${n}`, tono: dn >= n ? 'ok' : 'warn',
    stats: [
      { l: 'Completato da', v: dn + (dn === 1 ? ' persona' : ' persone') },
      { l: 'Riparte', v: t.type === 'straordinaria' ? 'Una volta' : t.type === 'quotidiana' ? 'Domani alle 04:00' : t.recurrence_days.map(d => aGiorno(d).toLowerCase()).join(', ') + ' alle 04:00' },
    ],
    sezioni: [{
      h: 'Oggi',
      righe: [...pp, ...extra].map(x => {
        const c = fatti.get(x.id)
        return { l: x.nome, v: c ? 'Fatto alle ' + oraRoma(c.completed_at) : 'Da fare', c: c ? 'var(--ok)' : 'var(--muted-foreground)' }
      }),
    }],
    azioni: [{ l: 'Elimina ODS', stile: 'neg', onClick: onElimina }],
  }
}

// ── Manager e direttore ──────────────────────────────────────────────────

function OdsAltro({ vista, staff, restaurants, tasks, perTask, diOggi, elimina, nuovi, apriForm, disabilitato }: Props & Comune) {
  const tel = useTelefono()
  const single = vista === 'direttore'
  const [loc, setLoc] = useState<string | null>(null)
  const [reps, setReps] = useState<string[]>([])
  const det = useDettaglio()
  const { stato: sk, avvia, pronto } = useScheletro(false)
  const locali = useMemo(() => restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) })), [restaurants])
  const info = (id: string) => locali.find(l => l.id === id)

  const O = tasks.filter(t => loc === null || t.restaurant_id === loc)
  const L = reps.length ? O.filter(t => reps.includes(t.department)) : O
  const stato = (t: OdsTask) => { const n = Math.max(attese(t, staff).length, 1), dn = (perTask.get(t.id) ?? []).length; return { n, dn, pieno: dn >= n } }

  const righe: RigaAltro[] = L.map(t => {
    const s = stato(t), oggi = diOggi(t)
    const tono: Tono = oggi && s.pieno ? 'ok' : t.type === 'straordinaria' ? 'warn' : 'neu'
    return {
      key: t.id, a: t.title, as: info(t.restaurant_id)?.nome ?? '—', lc: info(t.restaurant_id)?.colore ?? 'var(--line-strong)',
      // Un ricorrente che oggi non tocca non ha un avanzamento da mostrare.
      b: oggi ? `${s.dn} / ${s.n}` : '—', c: t.assignee?.full_name ?? t.department, t: ODS_TYPE_LABELS[t.type], tono, nuova: nuovi.includes(t.id),
    }
  })
  const oggiL = L.filter(diOggi)
  const kpis = [{ l: 'Completati oggi', v: `${oggiL.filter(t => stato(t).pieno).length} / ${oggiL.length}` }, { l: 'Reset', v: '04:00' }]
  const schede = DEPARTMENTS.map(r => ({
    k: r, l: r, on: reps.includes(r),
    // Scegliere tutti i reparti uno per uno equivale a nessun filtro.
    onClick: () => { setReps(x => { const n = x.includes(r) ? x.filter(y => y !== r) : [...x, r]; return n.length === DEPARTMENTS.length ? [] : n }); det.setSel(null) },
  }))

  // Telefono: un reparto alla volta, scelto nel foglio "Filtri".
  const filtri = [{
    titolo: 'Reparto', opzioni: DEPARTMENTS.map(r => ({ k: r as string, l: r as string })), valore: reps.length === 1 ? reps[0] : null,
    onCambia: (k: string | null) => { setReps(k ? [k] : []); det.setSel(null) },
  }]

  // Tablet: la prima riga è scelta da sola, così il dettaglio non resta
  // vuoto. Sul telefono no: aprirebbe il foglio.
  const selEff = L.some(x => x.id === det.sel) ? det.sel : tel ? null : L[0]?.id ?? null
  const t = L.find(x => x.id === selEff)
  const d = t ? datiDettaglio(t, staff, perTask.get(t.id) ?? [], info(t.restaurant_id)?.nome ?? '', () => elimina(t, () => det.setSel(null))) : null

  return (
    <div data-sk-root="" data-sk-on={sk === 'on' ? '1' : undefined} className="relative box-border flex h-full flex-col gap-3 px-4 sm:px-8">
      <BarraAltro
        locali={!single ? <PilloleLocali locali={locali} selezionati={loc ? [loc] : []} onCambia={ids => { setLoc(ids[0] ?? null); det.setSel(null); avvia(); pronto() }} className="sm:mx-0 sm:px-0" /> : undefined}
        schede={schede} filtri={filtri} kpis={kpis} nuovo={{ l: 'Nuovo ODS', onClick: apriForm, disabilitato }}
      />
      <GrigliaAltro>
        <ElencoAltro
          testate={[{ l: 'Ordine di servizio', a: 'left' }, { l: 'Oggi', a: 'right' }, { l: 'Reparto', a: 'right' }, { l: 'Ricorrenza', a: 'right' }]}
          colonne="minmax(0,1.4fr) 100px 92px 132px" righe={righe} scelta={selEff} onScegli={det.scegli}
          vuoto={{ t: 'Nessun ordine di servizio', s: reps.length || loc ? 'Nessun ODS per questo filtro.' : 'Crea il primo con Nuovo ODS.' }}
        />
        <PannelloDettaglio d={d} chiave={`ods|${selEff}|${loc}`} esce={det.esce} onChiudi={det.chiudi} senzaRighe={righe.length === 0} />
      </GrigliaAltro>
      {sk !== 'no' && <ScheletroForma esce={sk === 'out'} />}
    </div>
  )
}

// ── Capo servizio: ODS del reparto ───────────────────────────────────────

function OdsCapo({ staff, restaurants, currentDepartment, tasks, perTask, diOggi, elimina, apriForm, disabilitato }: Props & Comune) {
  const det = useDettaglio()
  const [oggiNome] = useState(() => formatInTimeZone(new Date(Date.now() - 4 * 3600e3), TZ, 'EEEE', { locale: it }).toLowerCase())
  const mie = tasks.filter(t => !currentDepartment || t.department === currentDepartment)
  // Prima quelli di oggi, poi i ricorrenti di altri giorni (attenuati).
  const lista = [...mie.filter(diOggi), ...mie.filter(t => !diOggi(t))]
  const oggi = mie.filter(diOggi), fatti = oggi.filter(t => (perTask.get(t.id) ?? []).length > 0).length
  const rep = (currentDepartment ?? '').toLowerCase()

  const meta = (t: OdsTask) => {
    const c = perTask.get(t.id) ?? []
    if (c.length) { const u = c[c.length - 1]; return `${u.profile?.full_name ?? 'Qualcuno'} · ${oraRoma(u.completed_at)}${c.length > 1 ? ` e altri ${c.length - 1}` : ''}` }
    if (t.assignee) return t.assignee.full_name + (t.type === 'quotidiana' ? '' : ' · ' + (diOggi(t) ? oggiNome : t.recurrence_days.join(', ')))
    if (t.type === 'straordinaria') return 'Straordinario · da assegnare'
    return `Tutta la ${rep || 'squadra'} · ${t.type === 'quotidiana' ? 'quotidiano' : diOggi(t) ? oggiNome : t.recurrence_days.join(', ')}`
  }
  const t = mie.find(x => x.id === det.sel)
  const d = t ? datiDettaglio(t, staff, perTask.get(t.id) ?? [], restaurants.find(r => r.id === t.restaurant_id)?.name ?? '', () => elimina(t, () => det.setSel(null))) : null

  return (
    <div className="mx-auto box-border flex h-full w-full max-w-[640px] flex-col">
      <div className="flex flex-none flex-col gap-3 px-5 pb-3 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[28px] font-semibold tracking-[-0.8px]">ODS{rep ? ' ' + rep : ''}</span>
          <span className="font-mono text-sm font-medium text-muted-foreground">{fatti}/{oggi.length}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-sm bg-border">
          <div className="h-1 bg-turni transition-[width] duration-500" style={{ width: oggi.length ? `${(fatti / oggi.length) * 100}%` : '0%' }} />
        </div>
      </div>
      <div className="mx-4 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain">
        {lista.length === 0 && (
          <div className="anim-swapin rounded-[14px] border border-dashed border-line-strong px-4 py-10 text-center">
            <span className="block text-[15px] font-semibold">Nessun ordine di servizio</span>
            <span className="text-[13px] text-muted-foreground">Crealo con il pulsante qui sotto.</span>
          </div>
        )}
        {lista.map((x, i) => {
          const fatto = (perTask.get(x.id) ?? []).length > 0, adesso = diOggi(x)
          return (
            <button key={x.id} type="button" onClick={() => det.scegli(x.id)}
              className={cn('anim-inrise grid min-h-[60px] flex-none items-center gap-x-2.5 gap-y-0.5 rounded-[14px] border border-border bg-card px-3.5 py-2 text-left active:scale-[0.99]', !adesso && 'opacity-50')}
              style={{ gridTemplateColumns: '1fr auto', animationDelay: `${Math.min(i, 10) * 70}ms` }}>
              <span className="text-[15px] font-medium">{x.title}</span>
              <Badge tono={fatto ? 'ok' : 'neu'}>{fatto ? 'Fatto' : adesso ? 'Da fare' : 'Non oggi'}</Badge>
              <span className="text-xs text-muted-foreground">{meta(x)}</span>
            </button>
          )
        })}
      </div>
      <div className="flex-none px-4 py-3">
        <button type="button" onClick={apriForm} disabled={disabilitato}
          className="flex h-12 w-full items-center justify-center rounded-[12px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-40">
          + Nuovo ordine di servizio
        </button>
      </div>
      <PannelloDettaglio d={d} chiave={`ods-capo|${det.sel}`} esce={det.esce} onChiudi={det.chiudi} sempreFoglio />
    </div>
  )
}

// ── Foglio "Nuovo ordine di servizio" ────────────────────────────────────

interface StatoOds { t: string; loc: string | null; rep: string | null; asg: 'Tutto il reparto' | 'Una persona'; p1: string | null; ric: OdsTaskType; gg: Giorno[] }

function useNuovoOds({ vista, staff, restaurants, currentRestaurantId, deptBloccato, onCreati }: Props & { deptBloccato: string | null; onCreati: (t: OdsTask[]) => void }) {
  const tel = useTelefono()
  const single = vista !== 'manager'
  const f = useUscita<StatoOds>()
  const [invio, setInvio] = useState(false)
  const NW = f.dati
  const set = (x: Partial<StatoOds>) => f.setDati(d => (d ? { ...d, ...x } : d))
  const apri = () => f.apri({ t: '', loc: single ? currentRestaurantId : null, rep: deptBloccato, asg: 'Tutto il reparto', p1: null, ric: 'quotidiana', gg: [] })

  const gN = NW ? N_GIORNI[NW.ric] : 0
  const ok = !!NW && !!NW.t.trim() && !!NW.rep && NW.gg.length === gN && (NW.asg !== 'Una persona' || !!NW.p1)
  const persone = NW?.rep ? staff.filter(s => s.department === NW.rep && (NW.loc === null || s.restaurant_id === NW.loc)) : []
  const nomeLoc = (id: string | null) => restaurants.find(r => r.id === id)?.name ?? ''

  async function crea() {
    if (!NW || !ok || !NW.rep) return
    const p1 = NW.asg === 'Una persona' ? staff.find(s => s.id === NW.p1) : undefined
    // "Tutti i locali": un ODS per ogni locale (il compito vale per ogni
    // reparto omonimo); con una persona, il suo locale.
    const locali = p1 ? [p1.restaurant_id] : NW.loc ? [NW.loc] : restaurants.map(r => r.id)
    const giorni = GG.filter(g => NW.gg.includes(g)).map(daGiorno)
    setInvio(true)
    const creati: OdsTask[] = []
    try {
      for (const rid of locali) {
        if (!rid) continue
        creati.push(await createOdsTask({ title: NW.t.trim(), department: NW.rep, restaurant_id: rid, type: NW.ric, recurrence_days: gN ? giorni : [], assigned_to: p1?.id ?? null }))
      }
      onCreati(creati)
      f.chiudi()
      toast({ title: creati.length > 1 ? `ODS creato in ${creati.length} locali` : 'ODS creato' })
    } catch (e) {
      if (creati.length) onCreati(creati)
      toast({ title: 'Creazione non riuscita', description: e instanceof Error ? e.message : 'Riprova più tardi', variant: 'destructive' })
    } finally {
      setInvio(false)
    }
  }

  const gL = NW?.ric === 'bisettimanale' ? 'Giorni della settimana · scegline 2' : NW?.ric === 'straordinaria' ? 'Giorno' : 'Giorno della settimana'
  const nota = !gN
    ? 'I quotidiani ripartono ogni notte alle 04:00. Ti avvisiamo quando qualcuno completa.'
    : NW?.ric === 'straordinaria' ? 'Compare una sola volta, il prossimo giorno scelto, e poi sparisce.' : 'Riparte alle 04:00 dei giorni scelti. Ti avvisiamo quando qualcuno completa.'

  const foglio = (
    <FoglioAltro aperto={!!NW} esce={f.esce} onChiudi={() => f.chiudi()} testata={<TestataFoglio titolo="Nuovo ordine di servizio" onChiudi={() => f.chiudi()} />}>
      {NW && (
        <CorpoFoglio>
          <Campo etichetta="Compito"><Testo value={NW.t} onChange={v => set({ t: v })} placeholder="Es. Pulizia frigo bibite" /></Campo>
          {!single && (
            <GruppoPillole etichetta="Locale" opzioni={[{ v: '', l: 'Tutti i locali' }, ...restaurants.map(r => ({ v: r.id, l: r.name }))]}
              scelte={[NW.loc ?? '']} onTocca={v => set({ loc: v || null, p1: null })} />
          )}
          {deptBloccato ? (
            <Campo etichetta="Reparto"><div className="flex h-10 items-center self-start rounded-full border border-primary bg-primary px-3.5 text-[13px] font-medium text-primary-foreground">{deptBloccato}</div></Campo>
          ) : (
            <GruppoPillole etichetta="Reparto" opzioni={DEPARTMENTS.map(v => ({ v, l: v }))} scelte={NW.rep ? [NW.rep] : []} onTocca={v => set({ rep: v, p1: null })} />
          )}
          <GruppoPillole etichetta="Assegna a" opzioni={(['Tutto il reparto', 'Una persona'] as const).map(v => ({ v, l: v }))} scelte={[NW.asg]} onTocca={v => set({ asg: v })} />
          {NW.asg === 'Una persona' && NW.rep && (
            <GruppoPillole key={'p1-' + NW.rep} anima etichetta="Persona"
              opzioni={persone.map(s => ({ v: s.id, l: s.full_name + (NW.loc === null && !single ? ' · ' + nomeLoc(s.restaurant_id) : '') }))}
              scelte={NW.p1 ? [NW.p1] : []} onTocca={v => set({ p1: v })} />
          )}
          <GruppoPillole etichetta="Ricorrenza" opzioni={RIC.map(v => ({ v, l: ODS_TYPE_LABELS[v] }))} scelte={[NW.ric]}
            onTocca={v => set({ ric: v, gg: v === NW.ric ? NW.gg : [] })} />
          {gN > 0 && (
            <GruppoPillole key={'gg-' + NW.ric} anima griglia7 etichetta={gL} opzioni={GG.map(v => ({ v, l: v }))} scelte={NW.gg}
              // Con un solo giorno si sostituisce; con due si tengono gli ultimi due toccati.
              onTocca={v => set({ gg: NW.gg.includes(v) ? NW.gg.filter(x => x !== v) : gN === 1 ? [v] : [...NW.gg, v].slice(-gN) })} />
          )}
          <Nota>{nota}</Nota>
          <PulsantiSalva onAnnulla={() => f.chiudi()} onSalva={crea} etichetta={invio && tel ? 'Creo…' : 'Crea ODS'} attivo={ok} occupato={invio} />
        </CorpoFoglio>
      )}
    </FoglioAltro>
  )
  return { apri, foglio }
}
