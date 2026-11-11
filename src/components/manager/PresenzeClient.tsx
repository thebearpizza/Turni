'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { ScheletroForma } from '@/components/shared/ScheletroForma'
import { useScheletro } from '@/components/shared/useScheletro'
import { impostaSottotitolo } from '@/components/shell/intestazioneDinamica'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import { Rotella } from '@/components/ui/rotella'
import {
  TZ, GG, GG_LUNGHI, FRECCIA_SX, FRECCIA_DX, ICONA_FOTO, USCITA,
  BarraMese, PulsanteNero, Avatar, BadgeTipo, Foglio, useFoglio, Etichetta, SceltaDipendente, PulsantiFoglio,
  useTelefono, piuGiorni, dataLunga, etichettaMese, spostaMese, ultimoDelMese, daIso,
} from '@/components/presenze/comuni'
import type { AbsenceType } from '@/types'

// Scheda Presenze del manager (MTPresenze.dc.html): mese con l'elenco dei
// giorni (striscia di giorni sul telefono), dettaglio del giorno con
// presenti, in corso/assenti e ore, timbrature con foto da approvare e
// foglio Aggiungi/Modifica presenza con la rotella degli orari.

const BUCKET = 'clock_in_proofs'
const SELECT_PRESENZE = 'id, user_id, restaurant_id, check_in, check_out, needs_manager_approval, fallback_photo_path_in, fallback_photo_path_out, profile:profiles(id, full_name, role, department)'

export type PresenzaRiga = {
  id: string
  user_id: string
  restaurant_id: string | null
  check_in: string
  check_out: string | null
  needs_manager_approval: boolean
  fallback_photo_path_in: string | null
  fallback_photo_path_out: string | null
  profile?: { id: string; full_name: string; role: string; department: string | null } | null
}

export type AbsenceItem = {
  id: string
  user_id: string
  restaurant_id: string | null
  type: string
  start_date: string
  end_date: string
  profile?: { id: string; full_name: string } | null
}

export type DipendentePresenze = { id: string; full_name: string; role: string; department: string | null; restaurant_id: string | null }

interface Props {
  initialPresenze: PresenzaRiga[]
  initialAbsences: AbsenceItem[]
  initialMonth: string
  restaurants: { id: string; name: string }[]
  dipendenti: DipendentePresenze[]
}

function limitiMese(mese: string) {
  return {
    inizio: fromZonedTime(`${mese}-01T00:00:00`, TZ).toISOString(),
    fine: fromZonedTime(`${ultimoDelMese(mese)}T23:59:59`, TZ).toISOString(),
  }
}

const giornoDi = (iso: string) => formatInTimeZone(new Date(iso), TZ, 'yyyy-MM-dd')
const oraDi = (iso: string) => formatInTimeZone(new Date(iso), TZ, 'HH:mm')
const toM = (s: string) => { const [h, m] = s.split(':').map(Number); return (h % 24) * 60 + (m || 0) }
// "19h 21": ore e minuti del design (senza la "m" finale).
const hh = (m: number) => Math.floor(m / 60) + 'h ' + String(Math.round(m % 60)).padStart(2, '0')
const reparto = (p?: { role: string; department: string | null } | null) => p?.role === 'capo_servizio' ? 'Capo servizio' : (p?.department ?? '—')

type Campo = 'a' | 'b'
interface StatoForm { id: string | null; userId: string | null; data: string; a: string; b: string; edit: boolean }

export function PresenzeClient({ initialPresenze, initialAbsences, initialMonth, restaurants, dipendenti }: Props) {
  const tel = useTelefono()
  const [adesso, setAdesso] = useState(() => Date.now())
  const oggi = formatInTimeZone(new Date(adesso), TZ, 'yyyy-MM-dd')
  const meseCorrente = oggi.slice(0, 7)

  const [presenze, setPresenze] = useState(initialPresenze)
  const [assenze, setAssenze] = useState(initialAbsences)
  const [mese, setMese] = useState(initialMonth)
  const [sel, setSel] = useState(() => { const o = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'); return o.startsWith(initialMonth) ? o : ultimoDelMese(initialMonth) })
  const [loc, setLoc] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const { stato: sk, avvia: avviaScheletro, pronto: scheletroPronto } = useScheletro(false)

  const locali = useMemo(() => restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) })), [restaurants])
  const infoLoc = useMemo(() => new Map(locali.map(l => [l.id, l])), [locali])
  const multiLoc = locali.length > 1
  const dipPerId = useMemo(() => new Map(dipendenti.map(d => [d.id, d])), [dipendenti])

  // Secondi del contatore "In corso": un tick al secondo basta per il
  // contatore e per far scattare il giorno a mezzanotte.
  useEffect(() => {
    const t = setInterval(() => setAdesso(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { impostaSottotitolo(etichettaMese(mese)) }, [mese])
  useEffect(() => () => impostaSottotitolo(null), [])

  const carica = useCallback(async (m: string) => {
    const { inizio, fine } = limitiMese(m)
    const supabase = createClient()
    const [{ data: p, error: e1 }, { data: a, error: e2 }] = await Promise.all([
      supabase.from('attendances').select(SELECT_PRESENZE).gte('check_in', inizio).lte('check_in', fine).order('check_in'),
      supabase.from('absences').select('id, user_id, restaurant_id, type, start_date, end_date, profile:profiles!user_id(id, full_name)')
        .eq('status', 'approved').lte('start_date', ultimoDelMese(m)).gte('end_date', `${m}-01`),
    ])
    if (e1 || e2) { toast({ title: 'Caricamento delle presenze non riuscito', description: (e1 ?? e2)?.message, variant: 'destructive' }); return false }
    setPresenze((p ?? []) as unknown as PresenzaRiga[])
    setAssenze((a ?? []) as unknown as AbsenceItem[])
    return true
  }, [])

  // Realtime: ogni timbratura (anche da un altro dispositivo) ricarica il
  // mese mostrato, a raffica raggruppata, senza scheletro.
  const meseRef = useRef(mese)
  useEffect(() => { meseRef.current = mese }, [mese])
  useEffect(() => {
    const supabase = createClient()
    let t: ReturnType<typeof setTimeout> | null = null
    const ricarica = () => { if (t) clearTimeout(t); t = setTimeout(() => { carica(meseRef.current) }, 300) }
    const ch = supabase.channel('rt-presenze')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances' }, ricarica)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absences' }, ricarica)
      .subscribe(s => setLive(s === 'SUBSCRIBED'))
    return () => { if (t) clearTimeout(t); supabase.removeChannel(ch) }
  }, [carica])

  async function cambiaMese(n: number) {
    const m = spostaMese(mese, n)
    if (m > meseCorrente) return
    setMese(m)
    // Come nel design: nel mese corrente si apre oggi, negli altri l'ultimo giorno.
    setSel(m === meseCorrente ? oggi : ultimoDelMese(m))
    avviaScheletro()
    await carica(m)
    scheletroPronto()
  }
  function cambiaLoc(ids: string[]) {
    setLoc(ids[0] ?? null)
    avviaScheletro()
    scheletroPronto()
  }

  // ── Calcoli del mese ─────────────────────────────────────────────────
  const inLoc = useCallback((rid: string | null) => loc === null || rid === loc, [loc])
  const durata = useCallback((p: PresenzaRiga) => {
    const a = new Date(p.check_in).getTime()
    if (p.check_out) return Math.max(0, (new Date(p.check_out).getTime() - a) / 60000)
    return giornoDi(p.check_in) === oggi ? Math.max(0, (adesso - a) / 60000) : 0
  }, [oggi, adesso])

  const perGiorno = useMemo(() => {
    const g = new Map<string, PresenzaRiga[]>()
    for (const p of presenze) {
      if (!inLoc(p.restaurant_id)) continue
      const k = giornoDi(p.check_in)
      g.set(k, [...(g.get(k) ?? []), p])
    }
    return g
  }, [presenze, inLoc])

  const ultimo = mese === meseCorrente ? oggi : ultimoDelMese(mese)
  const giorni = useMemo(() => {
    const out: { d: string; p: number; min: number; warn: boolean }[] = []
    for (let d = ultimo; d >= `${mese}-01`; d = piuGiorni(d, -1)) {
      const ps = perGiorno.get(d) ?? []
      out.push({ d, p: new Set(ps.map(x => x.user_id)).size, min: ps.reduce((s, x) => s + durata(x), 0), warn: ps.some(x => x.needs_manager_approval) })
    }
    return out
  }, [ultimo, mese, perGiorno, durata])

  // ── Dettaglio del giorno scelto ──────────────────────────────────────
  const isOggi = sel === oggi
  const righe = useMemo(() => {
    const ps = (perGiorno.get(sel) ?? []).slice().sort((a, b) => a.check_in.localeCompare(b.check_in))
    const perUtente = new Map<string, PresenzaRiga[]>()
    for (const p of ps) perUtente.set(p.user_id, [...(perUtente.get(p.user_id) ?? []), p])
    const ass = new Map<string, AbsenceType>()
    for (const a of assenze) {
      const rid = a.restaurant_id ?? dipPerId.get(a.user_id)?.restaurant_id ?? null
      if (a.start_date <= sel && a.end_date >= sel && inLoc(rid)) ass.set(a.user_id, a.type as AbsenceType)
    }
    const ids = new Set([...perUtente.keys(), ...ass.keys()])
    return [...ids].map(uid => {
      const bl = perUtente.get(uid) ?? []
      const dip = dipPerId.get(uid)
      const nome = bl[0]?.profile?.full_name ?? dip?.full_name ?? assenze.find(a => a.user_id === uid)?.profile?.full_name ?? '—'
      const rid = bl[0]?.restaurant_id ?? dip?.restaurant_id ?? null
      return {
        uid, nome, blocchi: bl, assenza: ass.get(uid) ?? null,
        loc: rid ? infoLoc.get(rid) : undefined,
        rep: reparto(bl[0]?.profile ?? dip),
        min: bl.reduce((s, x) => s + durata(x), 0),
        primo: bl[0]?.check_in ?? '~',
      }
    }).sort((a, b) => a.primo.localeCompare(b.primo) || a.nome.localeCompare(b.nome, 'it'))
  }, [perGiorno, sel, assenze, dipPerId, inLoc, infoLoc, durata])

  const presenti = righe.filter(r => r.blocchi.length).length
  const inCorso = righe.reduce((s, r) => s + r.blocchi.filter(b => !b.check_out).length, 0)
  const assenti = righe.filter(r => r.assenza).length
  const oreTot = righe.reduce((s, r) => s + r.min, 0)
  const daApprovare = (perGiorno.get(sel) ?? []).filter(p => p.needs_manager_approval)

  // ── Foto delle timbrature d'emergenza ────────────────────────────────
  const [fotoAperta, setFotoAperta] = useState<string | null>(null)
  const [urlFoto, setUrlFoto] = useState<Record<string, string>>({})
  const [inAzione, setInAzione] = useState<string | null>(null)
  async function apriFoto(p: PresenzaRiga) {
    if (fotoAperta === p.id) { setFotoAperta(null); return }
    setFotoAperta(p.id)
    const paths = [p.fallback_photo_path_in, p.fallback_photo_path_out].filter((x): x is string => !!x && !urlFoto[x])
    if (!paths.length) return
    const supabase = createClient()
    const firmate = await Promise.all(paths.map(x => supabase.storage.from(BUCKET).createSignedUrl(x, 300)))
    setUrlFoto(u => { const n = { ...u }; firmate.forEach((f, i) => { if (f.data?.signedUrl) n[paths[i]] = f.data.signedUrl }); return n })
  }
  async function decidiFoto(p: PresenzaRiga, action: 'approve' | 'reject') {
    setInAzione(p.id)
    try {
      const res = await fetch('/api/presenze/fallback-approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attendanceId: p.id, action }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Operazione non riuscita')
      toast({ title: action === 'approve' ? 'Timbratura approvata' : 'Timbratura rifiutata' })
      await carica(mese)
    } catch (e) {
      toast({ title: action === 'approve' ? 'Approvazione non riuscita' : 'Rifiuto non riuscito', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setInAzione(null) }
  }

  // ── Foglio Aggiungi / Modifica presenza ──────────────────────────────
  const foglio = useFoglio<StatoForm>()
  const f = foglio.dati
  const [campo, setCampo] = useState<Campo | null>(null)
  const [campoEsce, setCampoEsce] = useState(false)
  const [confElimina, setConfElimina] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const tCampo = useRef<ReturnType<typeof setTimeout> | null>(null)

  const chiudiCampo = useCallback(() => {
    setCampoEsce(true)
    if (tCampo.current) clearTimeout(tCampo.current)
    tCampo.current = setTimeout(() => { setCampo(null); setCampoEsce(false) }, USCITA)
  }, [])
  function apriCampo(k: Campo) {
    if (campo === k) return
    if (tCampo.current) clearTimeout(tCampo.current)
    if (campo) {
      // Dall'altro campo: prima esce la rotella aperta, poi entra la nuova.
      setCampoEsce(true)
      tCampo.current = setTimeout(() => { setCampo(k); setCampoEsce(false) }, USCITA)
    } else { setCampo(k); setCampoEsce(false) }
  }
  // Tocco fuori da campi e rotella: la rotella si chiude, il valore resta.
  useEffect(() => {
    if (!campo) return
    const h = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('[data-kp]')) chiudiCampo() }
    window.addEventListener('pointerdown', h, true)
    return () => window.removeEventListener('pointerdown', h, true)
  }, [campo, chiudiCampo])

  function apriForm(p: PresenzaRiga | null) {
    setCampo(null); setCampoEsce(false); setConfElimina(false)
    foglio.apri(p
      ? { id: p.id, userId: p.user_id, data: giornoDi(p.check_in), a: oraDi(p.check_in), b: p.check_out ? oraDi(p.check_out) : '', edit: true }
      : { id: null, userId: null, data: sel, a: '', b: '', edit: false })
  }
  function chiudiForm() { if (campo) chiudiCampo(); foglio.chiudi() }
  const aggiorna = (p: Partial<StatoForm>) => foglio.setDati(x => (x ? { ...x, ...p } : x))

  async function salva() {
    if (!f || !f.userId || !f.a) return
    setSalvando(true)
    try {
      const res = await fetch('/api/presenze', {
        method: f.edit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f.edit
          ? { id: f.id, date: f.data, checkIn: f.a, checkOut: f.b || null }
          : { userId: f.userId, date: f.data, checkIn: f.a, checkOut: f.b || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Salvataggio non riuscito')
      toast({ title: f.edit ? 'Presenza modificata' : 'Presenza aggiunta' })
      chiudiForm()
      await carica(mese)
    } catch (e) {
      toast({ title: f.edit ? 'Modifica non riuscita' : 'Presenza non aggiunta', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setSalvando(false) }
  }
  async function elimina() {
    if (!f?.id) return
    if (!confElimina) { setConfElimina(true); return }
    setSalvando(true)
    const { error } = await createClient().from('attendances').delete().eq('id', f.id)
    setSalvando(false)
    if (error) { toast({ title: 'Eliminazione non riuscita', description: error.message, variant: 'destructive' }); return }
    toast({ title: 'Presenza eliminata' })
    chiudiForm()
    await carica(mese)
  }

  const scelto = f?.userId ? dipPerId.get(f.userId) : undefined
  let durataTesto = ''
  if (f?.a && f.b) {
    let x = toM(f.b) - toM(f.a)
    const notte = x <= 0
    if (notte) x += 1440
    const d = daIso(f.data)
    durataTesto = 'Durata ' + hh(x) + 'm' + (notte ? ` · uscita il giorno dopo, la presenza resta su ${GG_LUNGHI[d.getUTCDay()].toLowerCase()} ${d.getUTCDate()}` : '')
  }
  const listaDip = useMemo(() => {
    const ordine = new Map(locali.map((l, i) => [l.id, i]))
    return dipendenti
      .map(d => ({ id: d.id, nome: d.full_name, locale: d.restaurant_id ? infoLoc.get(d.restaurant_id)?.nome ?? '' : '', o: d.restaurant_id ? ordine.get(d.restaurant_id) ?? 99 : 99 }))
      .sort((a, b) => a.o - b.o || a.nome.localeCompare(b.nome, 'it'))
  }, [dipendenti, locali, infoLoc])

  const nomeLoc = loc ? infoLoc.get(loc)?.nome ?? '' : 'Tutti i locali'
  const pill = (
    <PilloleLocali
      locali={locali} selezionati={loc ? [loc] : []} onCambia={cambiaLoc}
      className={tel ? 'flex-[1_1_100%]' : 'mx-0 flex-[0_1_auto] px-0'}
    />
  )

  return (
    <div data-sk-root="" data-sk-on={sk === 'on' ? '1' : undefined} className="relative box-border flex h-full flex-col gap-3 px-4 sm:px-8">
      {/* Barra, nell'ordine comune a tutte le sezioni: locali, poi mese e
          azione principale (sul telefono su due righe). */}
      <div data-sk-keep="" className="flex flex-none flex-wrap items-center gap-2.5">
        {pill}
        {multiLoc && !tel && <span className="mx-1 block h-7 w-px bg-[oklch(0.88_0.01_250)] dark:bg-line-strong" />}
        <BarraMese mese={mese} onPrec={() => cambiaMese(-1)} onSucc={() => cambiaMese(1)} succDisabilitato={mese >= meseCorrente} />
        {!tel && <span className="flex-1" />}
        {!tel && live && (
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-[oklch(0.4_0.08_150)] dark:text-ok">
            <span className="h-2 w-2 rounded-full bg-[oklch(0.6_0.13_150)] shadow-[0_0_0_3px_oklch(0.6_0.13_150/.2)]" />Live
          </span>
        )}
        <PulsanteNero onClick={() => apriForm(null)}>{tel ? 'Aggiungi' : 'Aggiungi presenza'}</PulsanteNero>
      </div>

      {/* Telefono: striscia dei giorni */}
      {tel && (
        <div className="-mx-4 flex flex-none gap-1.5 overflow-x-auto overscroll-contain px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {giorni.map(g => {
            const on = g.d === sel, d = daIso(g.d)
            return (
              <button
                key={g.d} type="button" onClick={() => setSel(g.d)}
                className={cn('relative flex h-[60px] w-[52px] flex-none flex-col items-center justify-center gap-px rounded-[10px] border transition-[background-color] duration-200 active:scale-[0.96]',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-card text-foreground dark:border-line-strong')}
              >
                <span className="text-[11px] font-medium opacity-80">{GG[d.getUTCDay()]}</span>
                <span className="font-mono text-[17px] font-semibold">{d.getUTCDate()}</span>
                {g.warn && <span className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full bg-[oklch(0.62_0.13_75)]" />}
                {g.d === oggi && <span className={cn('absolute bottom-[5px] h-1 w-1 rounded-full', on ? 'bg-white dark:bg-background' : 'bg-[oklch(0.58_0.12_180)]')} />}
              </button>
            )
          })}
        </div>
      )}

      <div className={cn('grid min-h-0 flex-1 gap-4', tel ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[340px_minmax(0,1fr)]')}>
        {/* Tablet: elenco dei giorni del mese */}
        {!tel && (
          <div className="anim-swapin flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-border bg-card">
            <div className="grid flex-none grid-cols-[minmax(0,1fr)_70px_70px] gap-2 border-b border-border bg-[oklch(0.97_0.01_250)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground dark:bg-secondary">
              <span>Giorno</span><span className="text-right">Presenti</span><span className="text-right">Ore</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {giorni.map(g => {
                const on = g.d === sel, d = daIso(g.d)
                return (
                  <button
                    key={g.d} type="button" onClick={() => setSel(g.d)}
                    className={cn('grid min-h-[52px] w-full grid-cols-[minmax(0,1fr)_70px_70px] items-center gap-2 border-b border-[oklch(0.94_0.01_250)] px-4 text-left transition-[background-color] duration-200 active:scale-[0.99] dark:border-border',
                      on ? 'bg-primary text-primary-foreground' : 'bg-transparent text-foreground')}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {GG[d.getUTCDay()]} {d.getUTCDate()}
                      {g.d === oggi && <span className="rounded-full bg-ok-tint px-[7px] py-0.5 text-[10px] font-semibold uppercase tracking-[.05em] text-ok">Oggi</span>}
                      {g.warn && <span className="h-[7px] w-[7px] rounded-full bg-[oklch(0.62_0.13_75)]" />}
                    </span>
                    <span className="text-right font-mono text-[13px] font-medium">{g.p}</span>
                    <span className="text-right font-mono text-[13px] font-medium">{hh(g.min)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Dettaglio del giorno */}
        <div key={`${sel}|${loc}`} className="anim-swapin flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-border bg-card">
          <div className={cn('flex flex-none border-b border-border', tel ? 'flex-col gap-2.5 px-3.5 py-3' : 'flex-wrap items-center gap-[18px] px-[18px] py-3.5')}>
            <div className={cn('flex flex-col gap-0.5', !tel && 'flex-1')}>
              <span className="text-lg font-semibold">{dataLunga(sel)}</span>
              <span className="text-[13px] text-muted-foreground">{nomeLoc}{isOggi ? ' · in aggiornamento continuo' : ''}</span>
            </div>
            {/* I numeri del giorno sul telefono si ritirano scorrendo le
                timbrature; resta la data. */}
            <div data-ritira="" style={{ ['--ritira-gap' as string]: '10px' }} className={cn('flex', tel ? 'gap-3' : 'flex-none items-center gap-[18px]')}>
              {[
                { l: 'Presenti', v: String(presenti), c: '' },
                { l: isOggi ? 'In corso' : 'Assenti', v: String(isOggi ? inCorso : assenti), c: isOggi ? 'text-[oklch(0.4_0.08_150)] dark:text-ok' : '' },
                { l: 'Ore totali', v: hh(oreTot), c: '' },
              ].map(s => (
                <div key={s.l} className={cn('flex flex-col gap-px', tel ? 'flex-[1_1_0] items-start' : 'flex-none items-end')}>
                  <span className="text-xs font-medium text-muted-foreground">{s.l}</span>
                  <span className={cn('font-mono text-lg font-semibold', s.c)}>{s.v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {daApprovare.map(p => {
              const nome = p.profile?.full_name ?? dipPerId.get(p.user_id)?.full_name ?? '—'
              const cosa = [p.fallback_photo_path_in && `l'entrata delle ${oraDi(p.check_in)}`, p.fallback_photo_path_out && p.check_out && `l'uscita delle ${oraDi(p.check_out)}`].filter(Boolean).join(' e ')
              const foto = [
                p.fallback_photo_path_in && { path: p.fallback_photo_path_in, ora: oraDi(p.check_in) },
                p.fallback_photo_path_out && { path: p.fallback_photo_path_out, ora: p.check_out ? oraDi(p.check_out) : '' },
              ].filter((x): x is { path: string; ora: string } => !!x)
              const occ = inAzione === p.id
              return (
                <div key={p.id} className={cn('mt-3 flex flex-col gap-3 rounded-[10px] bg-[oklch(0.96_0.035_75)] p-3 dark:bg-warn-tint', tel ? 'mx-3.5' : 'mx-[18px]')}>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => apriFoto(p)} aria-label="Ingrandisci la foto"
                      className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-[8px] bg-[oklch(0.86_0.02_75)] text-[oklch(0.42_0.08_75)] active:scale-[0.96] dark:bg-[oklch(0.36_0.03_75)] dark:text-warn">
                      {ICONA_FOTO(20)}
                    </button>
                    <span className="min-w-0 flex-1 text-pretty text-sm font-medium text-[oklch(0.35_0.06_75)] dark:text-warn">
                      {nome} ha timbrato {cosa || `l'entrata delle ${oraDi(p.check_in)}`} con la foto: il GPS non era disponibile. Tocca la foto per ingrandirla.
                    </span>
                  </div>
                  {fotoAperta === p.id && foto.map(x => (
                    <button key={x.path} type="button" onClick={() => setFotoAperta(null)}
                      className="anim-swapin relative flex aspect-[3/4] max-h-[360px] w-full max-w-[270px] flex-col items-center justify-center gap-1.5 self-center overflow-hidden rounded-[10px] bg-[oklch(0.86_0.02_75)] text-[13px] font-medium text-[oklch(0.42_0.08_75)] dark:bg-[oklch(0.36_0.03_75)] dark:text-warn">
                      {urlFoto[x.path]
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={urlFoto[x.path]} alt={`Foto della timbratura delle ${x.ora}`} className="absolute inset-0 h-full w-full object-cover" />
                        : <>{ICONA_FOTO(28)}Foto della timbratura · {x.ora}</>}
                    </button>
                  ))}
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" disabled={occ} onClick={() => decidiFoto(p, 'reject')}
                      className="flex h-10 items-center justify-center rounded-[8px] border border-[oklch(0.85_0.05_25)] text-[13px] font-semibold text-[oklch(0.45_0.1_25)] active:scale-[0.97] disabled:opacity-50 dark:border-[oklch(0.45_0.08_25)] dark:text-neg">Rifiuta</button>
                    <button type="button" disabled={occ} onClick={() => decidiFoto(p, 'approve')}
                      className="flex h-10 items-center justify-center rounded-[8px] bg-primary text-[13px] font-semibold text-primary-foreground active:scale-[0.97] disabled:opacity-50">Approva</button>
                  </div>
                </div>
              )
            })}

            {righe.length === 0 && daApprovare.length === 0 && (
              <div className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center text-pretty">
                <span className="text-[15px] font-semibold">Nessuna presenza in questo giorno</span>
                <span className="text-[13px] text-muted-foreground">{isOggi ? 'Le timbrature compaiono qui in tempo reale.' : 'Cambia giorno o locale, oppure aggiungi una presenza.'}</span>
              </div>
            )}

            {righe.map(r => (
              <div key={r.uid}
                className={cn('grid min-h-16 items-center border-b border-[oklch(0.94_0.01_250)] dark:border-border',
                  tel ? 'grid-cols-[36px_minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-3.5 py-2.5' : 'grid-cols-[40px_minmax(0,1fr)_minmax(0,1.4fr)_90px] gap-3.5 px-[18px] py-2')}>
                <Avatar nome={r.nome} grande={!tel} className={tel ? 'row-[1/3] self-start' : 'self-start'} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[15px] font-medium">{r.nome}</span>
                  <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    <span className="h-[7px] w-[7px] flex-none rounded-[2px]" style={{ background: r.loc?.colore ?? 'var(--line-strong)' }} />
                    <span className="truncate">{r.loc?.nome ?? '—'} · {r.rep}</span>
                  </span>
                </div>
                <div className={cn('flex flex-wrap items-center gap-1.5', tel && 'col-[2/4] row-[2]')}>
                  {r.blocchi.map(b => {
                    const lv = !b.check_out && isOggi
                    const x = durata(b), sec = Math.floor(((adesso - new Date(b.check_in).getTime()) / 1000) % 60)
                    const notte = !!b.check_out && giornoDi(b.check_out) > giornoDi(b.check_in)
                    return (
                      <button key={b.id} type="button" onClick={() => apriForm(b)}
                        className={cn('flex h-10 items-center gap-2 rounded-[8px] border px-3 font-mono text-[13px] font-medium text-foreground hover:brightness-[0.98] active:scale-[0.97]',
                          lv ? 'border-[oklch(0.85_0.06_150)] bg-[oklch(0.97_0.025_150)] dark:border-ok/40 dark:bg-ok-tint/50' : 'border-[oklch(0.9_0.01_250)] bg-[oklch(0.975_0.01_250)] dark:border-border dark:bg-secondary')}>
                        {oraDi(b.check_in)} → {b.check_out ? oraDi(b.check_out) : ''}{notte ? ' (+1)' : ''}
                        {lv && (
                          <span className="rounded-full bg-ok-tint px-[7px] py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[.05em] text-ok">
                            In corso {Math.floor(x / 60)}:{String(Math.floor(x % 60)).padStart(2, '0')}:{String(Math.max(0, sec)).padStart(2, '0')}
                          </span>
                        )}
                      </button>
                    )
                  })}
                  {r.blocchi.length > 1 && <span className="rounded-full bg-[oklch(0.93_0.01_250)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.05em] text-muted-foreground dark:bg-secondary">Spezzato</span>}
                  {r.assenza && <BadgeTipo tipo={r.assenza} className="px-[9px] py-[3px]" />}
                </div>
                <span className={cn('row-[1] text-right font-mono text-sm font-semibold', tel && 'col-[3]', !r.blocchi.length && 'text-muted-foreground')}>
                  {r.blocchi.length ? hh(r.min) : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {sk !== 'no' && <ScheletroForma esce={sk === 'out'} />}

      <Foglio aperto={!!f} esce={foglio.esce} onChiudi={chiudiForm} titolo={f?.edit ? 'Modifica presenza' : 'Aggiungi presenza'} larghezza={580} altoTablet={150}>
        {f && (
          <>
            <div className="flex flex-col gap-2">
              <Etichetta>Dipendente</Etichetta>
              {f.edit ? (
                <div className="flex h-12 items-center gap-2.5 rounded-[6px] bg-[oklch(0.96_0.01_250)] px-3.5 text-[15px] font-medium dark:bg-secondary">
                  {scelto?.full_name ?? presenze.find(p => p.id === f.id)?.profile?.full_name ?? '—'}
                  <span className="text-[13px] font-normal text-muted-foreground">
                    {(scelto?.restaurant_id ? infoLoc.get(scelto.restaurant_id)?.nome : '') ?? ''}{scelto ? ' · ' + reparto(scelto) : ''}
                  </span>
                </div>
              ) : (
                <SceltaDipendente dipendenti={listaDip} scelto={f.userId} onScegli={id => aggiorna({ userId: id })} />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Etichetta>Data</Etichetta>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Giorno precedente" disabled={f.edit} onClick={() => aggiorna({ data: piuGiorni(f.data, -1) })}
                  className={cn('flex h-12 w-12 items-center justify-center rounded-[6px] border border-line-strong active:scale-[0.96]', f.edit && 'opacity-30 active:scale-100')}>{FRECCIA_SX}</button>
                <div className="flex h-12 flex-1 items-center justify-center rounded-[6px] border border-line-strong text-[15px] font-medium">{dataLunga(f.data)}</div>
                <button type="button" aria-label="Giorno successivo" disabled={f.edit || f.data >= oggi} onClick={() => aggiorna({ data: piuGiorni(f.data, 1) })}
                  className={cn('flex h-12 w-12 items-center justify-center rounded-[6px] border border-line-strong active:scale-[0.96]', (f.edit || f.data >= oggi) && 'opacity-30 active:scale-100')}>{FRECCIA_DX}</button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {([['a', 'Ora ingresso'], ['b', 'Ora uscita']] as const).map(([k, l]) => (
                <div key={k} className="flex flex-col gap-2">
                  <Etichetta>{l}</Etichetta>
                  <button type="button" data-kp="" onClick={() => apriCampo(k)}
                    className={cn('box-border flex h-[60px] items-center justify-center rounded-[6px] font-mono text-2xl font-medium transition-[border-color] duration-200',
                      campo === k ? 'border-[1.5px] border-[oklch(0.58_0.12_180)]' : 'border border-line-strong', !f[k] && 'text-muted-foreground')}>
                    {f[k] || '—'}
                  </button>
                </div>
              ))}
            </div>

            {campo && (
              <div data-kp="" className="flex justify-center">
                <Rotella
                  key={campo}
                  value={f[campo] || (campo === 'a' ? '10:00' : '18:00')}
                  onChange={v => aggiorna({ [campo]: v } as Partial<StatoForm>)}
                  onDone={chiudiCampo}
                  className={campoEsce ? 'anim-swapout' : 'anim-swapin'}
                />
              </div>
            )}

            {durataTesto && <span className="text-sm font-medium">{durataTesto}</span>}

            <PulsantiFoglio
              conElimina={f.edit} confermaElimina={confElimina} onElimina={elimina} onAnnulla={chiudiForm} onSalva={salva}
              etichettaSalva={f.edit ? 'Salva modifiche' : 'Aggiungi'} salvaAttivo={!!f.userId && !!f.a} occupato={salvando}
            />
          </>
        )}
      </Foglio>
    </div>
  )
}
