'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { ScheletroForma } from '@/components/shared/ScheletroForma'
import { useScheletro } from '@/components/shared/useScheletro'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import { Tastierino, type TastoTastierino } from '@/components/ui/tastierino'
import {
  TZ, FRECCIA_SX, FRECCIA_DX, USCITA, TIPI, ORDINE_TIPI,
  BarraMese, PulsanteNero, Avatar, BadgeTipo, Foglio, useFoglio, Etichetta, SceltaDipendente, PulsantiFoglio, Vuoto,
  useTelefono, piuGiorni, giorniTra, dataBreve, dataConGiorno, spostaMese, ultimoDelMese, daIso,
} from '@/components/presenze/comuni'
import type { AbsenceType, AbsenceStatus } from '@/types'

// Scheda Assenze di manager e direttore (MTAssenze.dc.html): richieste in
// attesa da approvare o rifiutare, calendario del mese con le assenze
// approvate come barre colorate per tipo, foglio Nuova/Modifica assenza
// con il codice INPS digitato sul tastierino.

const SELECT_ASSENZE = 'id, user_id, restaurant_id, type, start_date, end_date, certificate_code, notes, status, created_at, profile:profiles!user_id(id, full_name)'

export type AssenzaRiga = {
  id: string
  user_id: string
  restaurant_id: string | null
  type: AbsenceType
  start_date: string
  end_date: string
  certificate_code: string | null
  notes: string | null
  status: AbsenceStatus
  created_at: string
  profile?: { id: string; full_name: string } | null
}

interface DipProfile { id: string; full_name: string; restaurant_id: string | null }

interface Props {
  initialApproved: AssenzaRiga[]
  initialPending: AssenzaRiga[]
  initialMonth: string
  restaurants: { id: string; name: string }[]
  dipendenti: DipProfile[]
  /** Direttore: un solo locale, niente pillole dei locali. */
  single: boolean
  /** Locale fisso del direttore (filtra caricamenti e realtime). */
  restaurantId: string | null
}

interface StatoForm { id: string | null; userId: string | null; tipo: AbsenceType; a: string; b: string; c: string; edit: boolean }

export function AssenzeClient({ initialApproved, initialPending, initialMonth, restaurants, dipendenti, single, restaurantId }: Props) {
  const tel = useTelefono()
  const [oggi] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'))
  const [mese, setMese] = useState(initialMonth)
  const [loc, setLoc] = useState<string | null>(null)
  const [approvate, setApprovate] = useState(initialApproved)
  const [richieste, setRichieste] = useState(initialPending)
  const [uscenti, setUscenti] = useState<string[]>([])
  const [nuove, setNuove] = useState<string[]>([])
  const { stato: sk, avvia: avviaScheletro, pronto: scheletroPronto } = useScheletro(false)

  const locali = useMemo(() => restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) })), [restaurants])
  const infoLoc = useMemo(() => new Map(locali.map(l => [l.id, l])), [locali])
  const ordineLoc = useMemo(() => new Map(locali.map((l, i) => [l.id, i])), [locali])
  const dipPerId = useMemo(() => new Map(dipendenti.map(d => [d.id, d])), [dipendenti])
  const locDi = useCallback((a: { user_id: string; restaurant_id: string | null }) => a.restaurant_id ?? dipPerId.get(a.user_id)?.restaurant_id ?? null, [dipPerId])
  const inLoc = useCallback((a: { user_id: string; restaurant_id: string | null }) => loc === null || locDi(a) === loc, [loc, locDi])
  const nomeDi = (a: AssenzaRiga) => a.profile?.full_name ?? dipPerId.get(a.user_id)?.full_name ?? '—'

  const carica = useCallback(async (m: string) => {
    const supabase = createClient()
    let qa = supabase.from('absences').select(SELECT_ASSENZE).eq('status', 'approved').lte('start_date', ultimoDelMese(m)).gte('end_date', `${m}-01`)
    let qp = supabase.from('absences').select(SELECT_ASSENZE).eq('status', 'pending').order('created_at', { ascending: false })
    if (restaurantId) { qa = qa.eq('restaurant_id', restaurantId); qp = qp.eq('restaurant_id', restaurantId) }
    const [{ data: a, error: e1 }, { data: p, error: e2 }] = await Promise.all([qa, qp])
    if (e1 || e2) { toast({ title: 'Caricamento delle assenze non riuscito', description: (e1 ?? e2)?.message, variant: 'destructive' }); return }
    setApprovate((a ?? []) as unknown as AssenzaRiga[])
    setRichieste((p ?? []) as unknown as AssenzaRiga[])
  }, [restaurantId])

  // Realtime: una richiesta inviata da un dipendente (o una modifica di un
  // altro responsabile) compare subito, senza scheletro.
  const meseRef = useRef(mese)
  useEffect(() => { meseRef.current = mese }, [mese])
  useEffect(() => {
    const supabase = createClient()
    let t: ReturnType<typeof setTimeout> | null = null
    const ch = supabase.channel('rt-assenze')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absences' }, () => {
        if (t) clearTimeout(t)
        t = setTimeout(() => { carica(meseRef.current) }, 300)
      })
      .subscribe()
    return () => { if (t) clearTimeout(t); supabase.removeChannel(ch) }
  }, [carica])

  async function vaiAlMese(m: string) {
    setMese(m)
    avviaScheletro()
    await carica(m)
    scheletroPronto()
  }
  function cambiaLoc(ids: string[]) { setLoc(ids[0] ?? null); avviaScheletro(); scheletroPronto() }

  // ── Richieste in attesa ──────────────────────────────────────────────
  const reqs = richieste.filter(inLoc)
  async function decidi(r: AssenzaRiga, ok: boolean) {
    setUscenti(u => [...u, r.id])
    try {
      const res = await fetch('/api/assenze', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, action: ok ? 'approve' : 'reject' }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Operazione non riuscita')
      // La riga esce con lo swapout, poi sparisce; se approvata entra nel
      // calendario con lo swapin.
      setTimeout(() => {
        setRichieste(x => x.filter(y => y.id !== r.id))
        setUscenti(u => u.filter(y => y !== r.id))
        if (ok) { setApprovate(x => [...x.filter(y => y.id !== r.id), { ...r, status: 'approved' }]); setNuove(n => [...n, r.id]) }
      }, USCITA)
      toast({ title: ok ? 'Assenza approvata' : 'Richiesta rifiutata' })
    } catch (e) {
      setUscenti(u => u.filter(y => y !== r.id))
      toast({ title: ok ? 'Approvazione non riuscita' : 'Rifiuto non riuscito', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }
  const inviata = (iso: string) => {
    const g = formatInTimeZone(new Date(iso), TZ, 'yyyy-MM-dd')
    if (g === oggi) return formatInTimeZone(new Date(iso), TZ, 'HH:mm')
    if (g === piuGiorni(oggi, -1)) return 'ieri'
    return dataBreve(g)
  }

  // ── Calendario del mese ──────────────────────────────────────────────
  const m0 = `${mese}-01`, m1 = ultimoDelMese(mese), nd = daIso(m1).getUTCDate()
  const giorni = Array.from({ length: nd }, (_, i) => {
    const d = piuGiorni(m0, i), w = daIso(d).getUTCDay()
    return { n: i + 1, oggi: d === oggi, weekend: w === 0 || w === 6 }
  })
  const delMese = approvate.filter(a => inLoc(a) && a.end_date >= m0 && a.start_date <= m1)
  const perDip = new Map<string, AssenzaRiga[]>()
  delMese.forEach(a => perDip.set(a.user_id, [...(perDip.get(a.user_id) ?? []), a]))
  const righe = [...perDip.entries()].map(([uid, as]) => {
    const rid = locDi(as[0])
    return { uid, nome: nomeDi(as[0]), loc: rid ? infoLoc.get(rid) : undefined, o: rid ? ordineLoc.get(rid) ?? 99 : 99, as }
  }).sort((p, q) => p.o - q.o || p.nome.localeCompare(q.nome, 'it'))
  const colonne = tel ? '96px minmax(0,1fr)' : '170px minmax(0,1fr)'
  const cellaGiorno = (g: typeof giorni[number]) => g.oggi
    ? 'bg-[oklch(0.58_0.12_180)] text-white font-bold'
    : g.weekend ? 'bg-[oklch(0.94_0.01_250)] text-[oklch(0.35_0.01_250)] dark:bg-[oklch(0.26_0.01_250)] dark:text-[oklch(0.8_0.01_250)]' : 'text-[oklch(0.55_0.01_250)]'

  // ── Foglio Nuova / Modifica assenza ──────────────────────────────────
  const foglio = useFoglio<StatoForm>()
  const f = foglio.dati
  const [confElimina, setConfElimina] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [kp, setKp] = useState(false)
  const [kpEsce, setKpEsce] = useState(false)
  const digitato = useRef(false)
  const tKp = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refCampo = useRef<HTMLButtonElement>(null)
  const refDock = useRef<HTMLDivElement>(null)

  const chiudiKp = useCallback(() => {
    setKpEsce(true)
    if (tKp.current) clearTimeout(tKp.current)
    tKp.current = setTimeout(() => { setKp(false); setKpEsce(false) }, USCITA)
  }, [])
  function apriKp() {
    if (kp && !kpEsce) return
    if (tKp.current) clearTimeout(tKp.current)
    digitato.current = false
    setKp(true); setKpEsce(false)
    // Telefono: il tastierino è agganciato in fondo al foglio; si scorre
    // quanto basta perché il campo resti visibile sopra di esso.
    if (tel) setTimeout(() => {
      const c = refCampo.current, d = refDock.current, sc = d?.parentElement
      if (!c || !d || !sc) return
      const delta = c.getBoundingClientRect().bottom - (d.getBoundingClientRect().top - 16)
      if (delta > 0) sc.scrollBy({ top: delta, behavior: 'smooth' })
    }, 80)
  }
  useEffect(() => {
    if (!kp) return
    const h = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('[data-kp]')) chiudiKp() }
    window.addEventListener('pointerdown', h, true)
    return () => window.removeEventListener('pointerdown', h, true)
  }, [kp, chiudiKp])

  const aggiorna = (p: Partial<StatoForm>) => foglio.setDati(x => (x ? { ...x, ...p } : x))
  function apriForm(a: AssenzaRiga | null) {
    setConfElimina(false); setKp(false); setKpEsce(false)
    foglio.apri(a
      ? { id: a.id, userId: a.user_id, tipo: a.type, a: a.start_date, b: a.end_date, c: a.certificate_code ?? '', edit: true }
      : { id: null, userId: null, tipo: 'ferie', a: oggi, b: oggi, c: '', edit: false })
  }
  function chiudiForm() { if (kp) chiudiKp(); foglio.chiudi() }
  // Dal/Al: spostando una data oltre l'altra, l'altra la segue.
  const sposta = (k: 'a' | 'b', n: number) => foglio.setDati(x => {
    if (!x) return x
    const g = { ...x, [k]: piuGiorni(x[k], n) }
    if (k === 'a' && g.a > g.b) g.b = g.a
    if (k === 'b' && g.b < g.a) g.a = g.b
    return g
  })
  function tasto(k: TastoTastierino) {
    foglio.setDati(x => {
      if (!x) return x
      // Il primo tasto sostituisce il codice mostrato, non lo prolunga.
      let c = digitato.current ? x.c : ''
      if (k === 'del') c = c.slice(0, -1)
      else if (/^\d$/.test(k) && c.length < 12) c += k
      return { ...x, c }
    })
    digitato.current = true
  }

  async function salva() {
    if (!f || !f.userId) return
    setSalvando(true)
    const supabase = createClient()
    const rid = dipPerId.get(f.userId)?.restaurant_id ?? null
    const campi = { user_id: f.userId, restaurant_id: rid, type: f.tipo, start_date: f.a, end_date: f.b, certificate_code: f.tipo === 'malattia' ? f.c || null : null }
    let errore: string | null = null
    if (f.edit && f.id) {
      const { error } = await supabase.from('absences').update(campi).eq('id', f.id)
      errore = error?.message ?? null
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.from('absences').insert({ ...campi, created_by: user?.id ?? null, status: 'approved' }).select('id').single()
      errore = error?.message ?? null
      if (data) setNuove(n => [...n, data.id as string])
    }
    setSalvando(false)
    if (errore) { toast({ title: f.edit ? 'Modifica non riuscita' : 'Assenza non registrata', description: errore, variant: 'destructive' }); return }
    toast({ title: f.edit ? 'Assenza modificata' : 'Assenza registrata' })
    chiudiForm()
    // Come nel design: dopo una nuova assenza si va al mese in cui inizia.
    const m = f.edit ? mese : f.a.slice(0, 7)
    if (m !== mese) setMese(m)
    await carica(m)
  }
  async function elimina() {
    if (!f?.id) return
    if (!confElimina) { setConfElimina(true); return }
    setSalvando(true)
    const { error } = await createClient().from('absences').delete().eq('id', f.id)
    setSalvando(false)
    if (error) { toast({ title: 'Eliminazione non riuscita', description: error.message, variant: 'destructive' }); return }
    toast({ title: 'Assenza eliminata' })
    setApprovate(x => x.filter(y => y.id !== f.id))
    chiudiForm()
  }

  const listaDip = useMemo(() => dipendenti
    .map(d => ({ id: d.id, nome: d.full_name, locale: d.restaurant_id ? infoLoc.get(d.restaurant_id)?.nome ?? '' : '', o: d.restaurant_id ? ordineLoc.get(d.restaurant_id) ?? 99 : 99 }))
    .sort((a, b) => a.o - b.o || a.nome.localeCompare(b.nome, 'it')), [dipendenti, infoLoc, ordineLoc])
  const nGiorni = f ? giorniTra(f.a, f.b) : 0
  const dataSettimana = (s: string) => dataConGiorno(s)
  const tastierino = (cls?: string) => <Tastierino senzaVirgola onKey={tasto} onDone={chiudiKp} className={cn(kpEsce ? 'anim-swapout' : 'anim-swapin', cls)} />

  return (
    <div data-sk-root="" data-sk-on={sk === 'on' ? '1' : undefined} className="relative box-border flex h-full flex-col gap-3 px-4 sm:px-8">
      <div data-sk-keep="" className="flex flex-none flex-wrap items-center gap-2.5">
        <BarraMese mese={mese} onPrec={() => vaiAlMese(spostaMese(mese, -1))} onSucc={() => vaiAlMese(spostaMese(mese, 1))} />
        {!single && locali.length > 1 && !tel && <span className="mx-1 block h-7 w-px bg-[oklch(0.88_0.01_250)] dark:bg-line-strong" />}
        {!single && (
          <PilloleLocali locali={locali} selezionati={loc ? [loc] : []} onCambia={cambiaLoc} etichettaTutti="Tutti"
            className={tel ? 'order-5 flex-[1_1_100%]' : 'mx-0 flex-[0_1_auto] px-0'} />
        )}
        {!tel && <span className="flex-1" />}
        <PulsanteNero onClick={() => apriForm(null)}>{tel ? 'Nuova' : 'Nuova assenza'}</PulsanteNero>
      </div>

      <div className={cn('min-h-0 flex-1 gap-4', tel ? '-mx-4 flex flex-col overflow-y-auto overscroll-contain px-4' : 'grid grid-cols-[420px_minmax(0,1fr)]')}>
        {/* Richieste in attesa */}
        <div className="anim-swapin flex min-h-0 flex-none flex-col overflow-hidden rounded-[12px] border border-border bg-card">
          <div className={cn('flex flex-none items-center gap-2.5 border-b border-border py-3.5', tel ? 'px-3.5' : 'px-[18px]')}>
            <span className="text-[17px] font-semibold">Richieste in attesa</span>
            <span className="font-mono text-[13px] font-medium text-muted-foreground">{reqs.length ? reqs.length : ''}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {reqs.length === 0 && <Vuoto titolo="Nessuna richiesta in attesa" testo="Le nuove richieste compaiono qui in tempo reale." />}
            {reqs.map(r => {
              const n = nomeDi(r), g = giorniTra(r.start_date, r.end_date), rid = locDi(r), l = rid ? infoLoc.get(rid) : undefined
              return (
                <div key={r.id} className={cn('flex flex-col gap-2.5 border-b border-[oklch(0.93_0.01_250)] py-3.5 dark:border-border', tel ? 'px-3.5' : 'px-[18px]', uscenti.includes(r.id) && 'anim-swapout')}>
                  <div className="flex items-start gap-3">
                    <Avatar nome={n} />
                    <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold">{n}<BadgeTipo tipo={r.type} /></span>
                      <span className="text-sm text-[oklch(0.35_0.01_250)] dark:text-[oklch(0.8_0.01_250)]">
                        {r.start_date === r.end_date ? dataSettimana(r.start_date) : `Dal ${dataBreve(r.start_date)} al ${dataBreve(r.end_date)}`} · {g}{g === 1 ? ' giorno' : ' giorni'}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: l?.colore ?? 'var(--line-strong)' }} />
                        {l?.nome ?? '—'} · inviata {inviata(r.created_at)}
                      </span>
                    </div>
                  </div>
                  {r.notes && <span className="rounded-[8px] bg-[oklch(0.965_0.01_250)] px-3 py-2 text-[13px] leading-[1.45] text-[oklch(0.3_0.01_250)] dark:bg-secondary dark:text-foreground">{r.notes}</span>}
                  <div className="grid grid-cols-[1fr_1.4fr] gap-2">
                    <button type="button" disabled={uscenti.includes(r.id)} onClick={() => decidi(r, false)} className="flex h-11 items-center justify-center rounded-[8px] border border-line-strong text-sm font-medium active:scale-[0.97]">Rifiuta</button>
                    <button type="button" disabled={uscenti.includes(r.id)} onClick={() => decidi(r, true)} className="flex h-11 items-center justify-center rounded-[8px] bg-primary text-sm font-semibold text-primary-foreground active:scale-[0.97]">Approva</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Assenze approvate: calendario del mese */}
        <div key={`${mese}|${loc}`} className="anim-swapin flex min-h-0 flex-none flex-col overflow-hidden rounded-[12px] border border-border bg-card">
          <div className={cn('flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-border py-3.5', tel ? 'px-3.5' : 'px-[18px]')}>
            <span className="text-[17px] font-semibold">Assenze approvate</span>
            <span className="font-mono text-[13px] font-medium text-muted-foreground">{delMese.length}{delMese.length === 1 ? ' assenza' : ' assenze'}</span>
            <span className={tel ? 'flex-[0_0_100%]' : 'flex-1'} />
            {ORDINE_TIPI.map(k => (
              <span key={k} className="flex items-center gap-1.5 text-xs font-medium text-[oklch(0.35_0.01_250)] dark:text-[oklch(0.8_0.01_250)]">
                <span className={cn('h-3 w-3 rounded-[3px] border', TIPI[k].cls)} style={{ background: TIPI[k].bg, borderColor: TIPI[k].bd }} />{TIPI[k].l}
              </span>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-x-auto overscroll-contain">
            <div className="flex min-h-0 flex-1 flex-col" style={{ minWidth: tel ? 680 : 0 }}>
              <div className="grid flex-none border-b border-border bg-[oklch(0.97_0.01_250)] dark:bg-secondary" style={{ gridTemplateColumns: colonne }}>
                <span className={cn('sticky left-0 z-[2] bg-[oklch(0.97_0.01_250)] py-2 text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground dark:bg-secondary', tel ? 'px-2.5' : 'px-4')}>Dipendente</span>
                <div className="grid" style={{ gridTemplateColumns: `repeat(${nd},minmax(0,1fr))` }}>
                  {giorni.map(g => (
                    <span key={g.n} className={cn('border-l border-[oklch(0.93_0.01_250)] py-2 text-center font-mono text-[10.5px] font-medium dark:border-border', cellaGiorno(g))}>{g.n}</span>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {righe.length === 0 && <Vuoto titolo="Nessuna assenza nel mese" testo="Vale per i locali selezionati. Cambia mese o locale per vedere le altre." />}
                {righe.map(r => (
                  <div key={r.uid} className="grid h-[52px] border-b border-[oklch(0.94_0.01_250)] dark:border-border" style={{ gridTemplateColumns: colonne }}>
                    <div className={cn('sticky left-0 z-[2] flex min-w-0 flex-col justify-center bg-card', tel ? 'px-2.5' : 'px-4')}>
                      <span className="truncate text-sm font-medium">{r.nome}</span>
                      <span className="flex items-center gap-[5px] text-[11.5px] text-muted-foreground">
                        <span className="h-1.5 w-1.5 flex-none rounded-[2px]" style={{ background: r.loc?.colore ?? 'var(--line-strong)' }} /><span className="truncate">{r.loc?.nome ?? '—'}</span>
                      </span>
                    </div>
                    <div className="relative">
                      <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${nd},minmax(0,1fr))` }}>
                        {giorni.map(g => (
                          <span key={g.n} className={cn('border-l border-[oklch(0.93_0.01_250)] dark:border-border', g.oggi ? 'bg-[oklch(0.58_0.12_180)]' : g.weekend && 'bg-[oklch(0.94_0.01_250)] dark:bg-[oklch(0.26_0.01_250)]')} />
                        ))}
                      </div>
                      {r.as.map(a => {
                        const da = a.start_date < m0 ? m0 : a.start_date, al = a.end_date > m1 ? m1 : a.end_date
                        const i0 = giorniTra(m0, da) - 1, len = giorniTra(da, al), T = TIPI[a.type]
                        return (
                          <button key={a.id} type="button" onClick={() => apriForm(a)}
                            className={cn('absolute bottom-[9px] top-[9px] box-border flex items-center overflow-hidden whitespace-nowrap rounded-[6px] border px-2 text-[11px] font-semibold active:scale-[0.97]', T.cls, nuove.includes(a.id) && 'anim-swapin')}
                            style={{ left: `${(i0 / nd) * 100}%`, width: `${(len / nd) * 100}%`, background: T.bg, borderColor: T.bd, color: T.fg }}>
                            {len >= 2 ? T.l : T.l[0]}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {sk !== 'no' && <ScheletroForma esce={sk === 'out'} />}

      <Foglio
        aperto={!!f} esce={foglio.esce} onChiudi={chiudiForm} titolo={f?.edit ? 'Modifica assenza' : 'Nuova assenza'} larghezza={600} altoTablet={130}
        coda={f && kp && tel ? <div ref={refDock} data-kp="" className="sticky bottom-0 z-[5] mt-auto flex justify-center">{tastierino('w-full max-w-none rounded-b-none')}</div> : null}
      >
        {f && (
          <>
            <div className="flex flex-col gap-2">
              <Etichetta>Dipendente</Etichetta>
              <SceltaDipendente dipendenti={listaDip} scelto={f.userId} onScegli={id => aggiorna({ userId: id })} />
            </div>
            <div className="flex flex-col gap-2">
              <Etichetta>Tipo</Etichetta>
              <div className={cn('grid gap-1.5', tel ? 'grid-cols-2' : 'grid-cols-4')}>
                {ORDINE_TIPI.map(k => {
                  const on = f.tipo === k, T = TIPI[k]
                  return (
                    <button key={k} type="button" onClick={() => aggiorna({ tipo: k })}
                      className={cn('flex h-12 items-center justify-center rounded-[8px] border text-center text-[13px] font-medium transition-[background-color] duration-200 active:scale-[0.97]', on ? T.cls : 'border-[oklch(0.88_0.01_250)] bg-card text-foreground dark:border-line-strong')}
                      style={on ? { background: T.bg, borderColor: T.bd, color: T.fg } : undefined}>
                      {T.l}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className={cn('grid gap-3', tel ? 'grid-cols-1' : 'grid-cols-2')}>
              {(['a', 'b'] as const).map(k => (
                <div key={k} className="flex flex-col gap-2">
                  <Etichetta>{k === 'a' ? 'Dal' : 'Al'}</Etichetta>
                  <div className="flex items-center gap-1.5">
                    <button type="button" aria-label="Giorno precedente" onClick={() => sposta(k, -1)} className="flex h-12 w-11 items-center justify-center rounded-[6px] border border-line-strong active:scale-[0.96]">{FRECCIA_SX}</button>
                    <div className="flex h-12 flex-1 items-center justify-center rounded-[6px] border border-line-strong text-sm font-medium">{dataSettimana(f[k])}</div>
                    <button type="button" aria-label="Giorno successivo" onClick={() => sposta(k, 1)} className="flex h-12 w-11 items-center justify-center rounded-[6px] border border-line-strong active:scale-[0.96]">{FRECCIA_DX}</button>
                  </div>
                </div>
              ))}
            </div>
            {f.tipo === 'malattia' && (
              <div className="flex flex-col gap-2">
                <Etichetta>Codice certificato INPS</Etichetta>
                <div className="relative">
                  <button ref={refCampo} type="button" data-kp="" onClick={apriKp}
                    className={cn('box-border flex h-[52px] w-full items-center rounded-[6px] px-3.5 font-mono text-lg font-medium tracking-[.04em]', kp && !kpEsce ? 'border-[1.5px] border-[oklch(0.58_0.12_180)]' : 'border border-line-strong', !f.c && 'text-muted-foreground')}>
                    {f.c || 'Tocca per inserire'}
                  </button>
                  {kp && !tel && <div data-kp="" className="absolute left-1/2 top-[calc(100%+8px)] z-[5] -ml-[156px]">{tastierino()}</div>}
                </div>
              </div>
            )}
            <span className="text-sm font-medium">{nGiorni}{nGiorni === 1 ? ' giorno' : ' giorni'}{f.userId ? ' · ' + (dipPerId.get(f.userId)?.full_name ?? '') : ''}</span>
            <PulsantiFoglio
              conElimina={f.edit} confermaElimina={confElimina} onElimina={elimina} onAnnulla={chiudiForm} onSalva={salva}
              etichettaSalva={f.edit ? 'Salva modifiche' : 'Registra assenza'} salvaAttivo={!!f.userId} occupato={salvando}
            />
          </>
        )}
      </Foglio>
    </div>
  )
}
