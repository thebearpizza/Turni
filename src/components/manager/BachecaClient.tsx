'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { chiediConferma } from '@/components/shared/Conferma'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { ScheletroForma } from '@/components/shared/ScheletroForma'
import { useScheletro } from '@/components/shared/useScheletro'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import { DEPARTMENTS } from '@/types'
import {
  BarraAltro, ElencoAltro, PannelloDettaglio, GrigliaAltro, FoglioAltro, TestataFoglio, CorpoFoglio, Campo, Testo,
  GruppoPillole, Nota, PulsantiSalva, useUscita, useTelefono, GRIGIO_TUTTI, USCITA, CLASSE_INPUT,
  type RigaAltro, type DatiDettaglio,
} from '@/components/altro/comuni'
import {
  destinatariDi, personeScelte, bersaglioDa, type PersonaStaff, type RuoloScelta, type SceltaDestinatari, type TargetBacheca,
} from '@/components/altro/destinatari'
import { RigaQr, type LocaleQr } from '@/components/altro/QrLocale'

// Bacheca. Manager e direttore: scheda di Altro (MTAltro.dc.html, sec
// "bacheca"): comunicati con letture, data e destinatari, dettaglio con chi
// ha letto e chi no, "Sollecita chi non ha letto", "Rimuovi comunicato" e
// il foglio "Nuovo comunicato" (locale, destinatari per ruolo o persone,
// reparti). Capo servizio: Bacheca di Capo Servizio.dc.html (7b) con il QR
// del locale e i messaggi. Ogni pubblicazione avvisa i destinatari con la
// notifica "Nuovo comunicato in bacheca".

const TZ = 'Europe/Rome'
const MESI3 = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const GG3 = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
const SELECT = '*, restaurant:restaurants(id, name), author:profiles!created_by(id, full_name, role)'

export interface ComunicatoRiga {
  id: string
  title: string
  body: string
  target: TargetBacheca
  target_roles: string[] | null
  target_user_ids: string[] | null
  target_department: string | null
  restaurant_id: string | null
  created_by: string
  created_at: string
  target_label?: string | null
  restaurant?: { id: string; name: string } | null
  author?: { id: string; full_name: string; role?: string } | null
}
export interface LetturaRiga { bulletin_id: string; user_id: string; read_at: string }

interface Props {
  vista: 'manager' | 'direttore' | 'capo'
  initialBulletins: ComunicatoRiga[]
  initialReads: LetturaRiga[]
  restaurants: { id: string; name: string }[]
  staff: PersonaStaff[]
  currentUserId: string
  /** Locale fisso di direttore e capo servizio. */
  currentRestaurantId: string | null
  canPost: boolean
  qr: LocaleQr | null
}

const giornoRoma = (iso: string) => formatInTimeZone(new Date(iso), TZ, 'yyyy-MM-dd')
const oraRoma = (iso: string) => formatInTimeZone(new Date(iso), TZ, 'H:mm')
function dataCorta(iso: string, oggi: string): string {
  const g = giornoRoma(iso)
  if (g === oggi) return 'oggi'
  const [, m, d] = g.split('-').map(Number)
  return `${d} ${MESI3[m - 1]}`
}

/** Realtime dei comunicati: inserimenti e rimozioni fatti da altri compaiono subito. */
function useComunicatiInDiretta(iniziali: ComunicatoRiga[]) {
  const [lista, setLista] = useState(iniziali)
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase.channel('rt-bacheca')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bulletins' }, async payload => {
        if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id: string }).id
          setLista(bs => bs.filter(b => b.id !== id))
          return
        }
        // Il payload non porta le relazioni (autore, locale): si rilegge la riga.
        const { data } = await supabase.from('bulletins').select(SELECT).eq('id', (payload.new as { id: string }).id).single()
        if (!data) return
        const r = data as unknown as ComunicatoRiga
        setLista(bs => bs.some(b => b.id === r.id) ? bs.map(b => (b.id === r.id ? r : b)) : [r, ...bs])
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])
  return [lista, setLista] as const
}

export function BachecaClient(p: Props) {
  return p.vista === 'capo' ? <BachecaCapo {...p} /> : <BachecaAltro {...p} />
}

// ── Foglio "Nuovo comunicato" (condiviso) ────────────────────────────────

interface StatoNuovo { t: string; b: string; loc: string | null; dst: SceltaDestinatari['modo']; rl: RuoloScelta[]; pp: string[]; rep: string[] }

function useNuovoComunicato({ single, staff, restaurants, currentRestaurantId, currentUserId, onPubblicato }: {
  single: boolean; staff: PersonaStaff[]; restaurants: { id: string; name: string }[]; currentRestaurantId: string | null; currentUserId: string
  onPubblicato: (b: ComunicatoRiga) => void
}) {
  const f = useUscita<StatoNuovo>()
  const [invio, setInvio] = useState(false)
  const apri = () => f.apri({ t: '', b: '', loc: single ? currentRestaurantId : null, dst: 'Tutti', rl: [], pp: [], rep: [] })
  const set = (x: Partial<StatoNuovo>) => f.setDati(d => (d ? { ...d, ...x } : d))
  const toggle = <T extends string>(arr: T[], v: T) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v])
  const NW = f.dati
  const staffNoMe = staff.filter(s => s.id !== currentUserId)
  const nomeLoc = (id: string | null) => (id ? restaurants.find(r => r.id === id)?.name ?? '' : 'Tutti i locali')

  const ok = !!NW && !!NW.t.trim() && (NW.dst !== 'Persone' || NW.pp.length > 0) && (NW.dst !== 'Per ruolo' || NW.rl.length > 0)

  async function pubblica() {
    if (!NW || !ok) return
    const scelta: SceltaDestinatari = { locale: NW.loc, modo: NW.dst, ruoli: NW.rl, persone: NW.pp, reparti: NW.rep }
    const scelte = personeScelte(scelta, staffNoMe)
    if (!scelte.length) { toast({ title: 'Nessun destinatario per questa scelta', variant: 'destructive' }); return }
    const P2 = NW.dst === 'Persone', R2 = NW.dst === 'Per ruolo'
    const etichetta = nomeLoc(NW.loc) + (P2
      ? ' · ' + (NW.pp.length === 1 ? staff.find(s => s.id === NW.pp[0])?.full_name ?? '1 persona' : NW.pp.length + ' persone')
      : (R2 ? ' · ' + NW.rl.join(', ') : '') + (NW.rep.length ? ' · ' + NW.rep.join(', ') : ''))
    setInvio(true)
    try {
      const res = await fetch('/api/bacheca', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: NW.t.trim(), body: NW.b.trim(), ...bersaglioDa(scelta, scelte), target_label: etichetta }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Pubblicazione non riuscita')
      onPubblicato(j.bulletin as ComunicatoRiga)
      f.chiudi()
      const n = j.notificati as number
      toast({ title: `Comunicato pubblicato, notifica inviata a ${n} ${n === 1 ? 'persona' : 'persone'}` })
    } catch (e) {
      toast({ title: 'Pubblicazione non riuscita', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setInvio(false)
    }
  }

  const foglio = (
    <FoglioAltro aperto={!!NW} esce={f.esce} onChiudi={() => f.chiudi()} testata={<TestataFoglio titolo="Nuovo comunicato" onChiudi={() => f.chiudi()} />}>
      {NW && (
        <CorpoFoglio>
          <Campo etichetta="Titolo"><Testo value={NW.t} onChange={v => set({ t: v })} placeholder="Es. Chiusura straordinaria lunedì" /></Campo>
          <Campo etichetta="Testo">
            <textarea value={NW.b} onChange={e => set({ b: e.target.value })} placeholder="Scrivi il comunicato…"
              className={cn(CLASSE_INPUT, 'h-[110px] resize-none py-3 text-[15px] leading-[1.45]')} />
          </Campo>
          {!single && (
            <GruppoPillole etichetta="Locale" opzioni={[{ v: '', l: 'Tutti i locali' }, ...restaurants.map(r => ({ v: r.id, l: r.name }))]}
              scelte={[NW.loc ?? '']} onTocca={v => set({ loc: v || null, pp: [] })} />
          )}
          <GruppoPillole etichetta="Destinatari" opzioni={(['Tutti', 'Per ruolo', 'Persone'] as const).map(v => ({ v, l: v }))}
            scelte={[NW.dst]} onTocca={v => set({ dst: v })} />
          {NW.dst === 'Per ruolo' && (
            <GruppoPillole key="rl" anima etichetta="Ruolo" opzioni={(['Dipendenti', 'Capi servizio', 'Direttori'] as RuoloScelta[]).map(v => ({ v, l: v }))}
              scelte={NW.rl} onTocca={v => set({ rl: toggle(NW.rl, v) })} />
          )}
          {NW.dst === 'Persone' && (
            <GruppoPillole key="pp" anima etichetta="Persone" opzioni={staffNoMe.filter(s => NW.loc === null || s.restaurant_id === NW.loc).map(s => ({ v: s.id, l: s.full_name }))}
              scelte={NW.pp} onTocca={v => set({ pp: toggle(NW.pp, v) })} />
          )}
          {NW.dst !== 'Persone' && (
            <GruppoPillole key="rep" anima etichetta="Reparto (vuoto = tutti)" opzioni={DEPARTMENTS.map(v => ({ v, l: v }))}
              scelte={NW.rep} onTocca={v => set({ rep: toggle(NW.rep, v) })} />
          )}
          <Nota>I destinatari ricevono una notifica push e tu vedi chi l&apos;ha letto.</Nota>
          <PulsantiSalva onAnnulla={() => f.chiudi()} onSalva={pubblica} etichetta="Pubblica" attivo={ok} occupato={invio} />
        </CorpoFoglio>
      )}
    </FoglioAltro>
  )
  return { apri, foglio }
}

// ── Manager e direttore: scheda di Altro ─────────────────────────────────

function BachecaAltro({ vista, initialBulletins, initialReads, restaurants, staff, currentUserId, currentRestaurantId, canPost }: Props) {
  const tel = useTelefono()
  const single = vista === 'direttore'
  const [oggi] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'))
  const [bulletins, setBulletins] = useComunicatiInDiretta(initialBulletins)
  const [reads, setReads] = useState(initialReads)
  const [nuovi, setNuovi] = useState<string[]>([])
  const [loc, setLoc] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [esceD, setEsceD] = useState(false)
  const tD = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (tD.current) clearTimeout(tD.current) }, [])
  const { stato: sk, avvia, pronto } = useScheletro(false)

  const locali = useMemo(() => restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) })), [restaurants])
  const colore = (id: string | null) => (id ? locali.find(l => l.id === id)?.colore ?? GRIGIO_TUTTI : GRIGIO_TUTTI)
  const nomeLoc = (id: string | null) => (id ? restaurants.find(r => r.id === id)?.name ?? '' : '')
  const staffPerId = useMemo(() => new Map(staff.map(s => [s.id, s])), [staff])

  const etichetta = (b: ComunicatoRiga) => {
    if (b.target_label) return b.target_label
    const tutti = single ? 'Tutti' : 'Tutti i locali'
    switch (b.target) {
      case 'all': return b.restaurant_id ? nomeLoc(b.restaurant_id) : tutti
      case 'restaurant': return b.restaurant?.name ?? nomeLoc(b.restaurant_id)
      case 'role': return (b.restaurant_id ? nomeLoc(b.restaurant_id) : tutti) + ' · ' + (b.target_roles ?? []).map(r => (r === 'dipendente' ? 'Dipendenti' : 'Capi servizio')).join(', ')
      case 'department': return (b.restaurant_id ? nomeLoc(b.restaurant_id) + ' · ' : '') + (b.target_department ?? '')
      case 'users': {
        const ids = b.target_user_ids ?? []
        return ids.length === 1 ? staffPerId.get(ids[0])?.full_name ?? '1 persona' : ids.length + ' persone'
      }
    }
  }

  const visibili = bulletins.filter(b => loc === null || b.restaurant_id === null || b.restaurant_id === loc)
  const stat = useMemo(() => {
    const m = new Map<string, { dest: PersonaStaff[]; letti: LetturaRiga[] }>()
    for (const b of bulletins) {
      const dest = destinatariDi(b, staff).filter(s => s.id !== b.created_by)
      const ids = new Set(dest.map(d => d.id))
      m.set(b.id, { dest, letti: reads.filter(r => r.bulletin_id === b.id && ids.has(r.user_id)).sort((x, y) => x.read_at.localeCompare(y.read_at)) })
    }
    return m
  }, [bulletins, reads, staff])

  const righe: RigaAltro[] = visibili.map(b => {
    const s = stat.get(b.id)!
    return { key: b.id, a: b.title, as: b.body || 'Nessun testo', lc: colore(b.restaurant_id), b: `${s.letti.length} / ${s.dest.length}`, c: dataCorta(b.created_at, oggi), t: etichetta(b), tono: 'neu', nuova: nuovi.includes(b.id) }
  })
  const conDest = visibili.map(b => stat.get(b.id)!).filter(s => s.dest.length > 0)
  const kpis = [
    { l: 'Comunicati attivi', v: String(visibili.length) },
    { l: 'Letture medie', v: conDest.length ? Math.round((conDest.reduce((t, s) => t + s.letti.length / s.dest.length, 0) / conDest.length) * 100) + '%' : '—' },
  ]

  // Le letture cambiano mentre la scheda è aperta: si rileggono quando si apre un comunicato.
  async function aggiornaLetture(id: string) {
    const { data } = await createClient().from('bulletin_reads').select('bulletin_id, user_id, read_at').eq('bulletin_id', id)
    if (data) setReads(rs => [...rs.filter(r => r.bulletin_id !== id), ...(data as LetturaRiga[])])
  }
  function scegli(k: string) { if (tD.current) clearTimeout(tD.current); setEsceD(false); setSel(k); aggiornaLetture(k) }
  function chiudiDettaglio() {
    setEsceD(true)
    if (tD.current) clearTimeout(tD.current)
    tD.current = setTimeout(() => { setSel(null); setEsceD(false) }, USCITA)
  }
  function cambiaLoc(ids: string[]) { setLoc(ids[0] ?? null); setSel(null); avvia(); pronto() }

  const nuovo = useNuovoComunicato({
    single, staff, restaurants, currentRestaurantId, currentUserId,
    onPubblicato: b => { setBulletins(bs => [b, ...bs.filter(x => x.id !== b.id)]); setNuovi(n => [...n, b.id]) },
  })

  const [sollecito, setSollecito] = useState(false)
  async function sollecita(b: ComunicatoRiga) {
    setSollecito(true)
    try {
      const res = await fetch('/api/bacheca/sollecita', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bulletinId: b.id }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Invio non riuscito')
      const n = j.notificati as number
      toast({ title: n ? `Promemoria inviato a ${n} ${n === 1 ? 'persona' : 'persone'}` : 'Hanno già letto tutti' })
    } catch (e) {
      toast({ title: 'Promemoria non inviato', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSollecito(false)
    }
  }
  async function rimuovi(b: ComunicatoRiga) {
    if (!(await chiediConferma({ titolo: 'Rimuovere il comunicato?', testo: 'Sparisce dalla bacheca di tutti i destinatari.', conferma: 'Rimuovi' }))) return
    const { error } = await createClient().from('bulletins').delete().eq('id', b.id)
    if (error) { toast({ title: 'Rimozione non riuscita', description: error.message, variant: 'destructive' }); return }
    setBulletins(bs => bs.filter(x => x.id !== b.id))
    setSel(null)
    toast({ title: 'Comunicato rimosso' })
  }

  const b = visibili.find(x => x.id === sel) ?? null
  let d: DatiDettaglio | null = null
  if (b) {
    const s = stat.get(b.id)!, letti = new Set(s.letti.map(r => r.user_id))
    const pct = s.dest.length ? Math.round((s.letti.length / s.dest.length) * 100) : 0
    const quando = (iso: string) => (giornoRoma(iso) === oggi ? oraRoma(iso) : `${dataCorta(iso, oggi)} ${oraRoma(iso)}`)
    const pubbl = dataCorta(b.created_at, oggi)
    d = {
      titolo: b.title, sotto: (pubbl === 'oggi' ? 'pubblicato oggi' : 'pubblicato il ' + pubbl) + ' · ' + etichetta(b), tag: pct + '% letto', tono: 'tl',
      msg: b.body || undefined,
      sezioni: [
        { h: 'Letto da ' + s.letti.length, righe: s.letti.map(r => ({ l: staffPerId.get(r.user_id)?.full_name ?? '—', v: quando(r.read_at), c: 'var(--muted-foreground)' })) },
        { h: 'Non ancora letto · ' + (s.dest.length - s.letti.length), righe: s.dest.filter(p => !letti.has(p.id)).map(p => ({ l: p.full_name, v: '—', c: 'var(--muted-foreground)' })) },
      ],
      azioni: [
        { l: tel ? 'Sollecita lettura' : 'Sollecita chi non ha letto', stile: 'contorno', onClick: () => sollecita(b), disabilitata: sollecito || s.letti.length >= s.dest.length },
        { l: 'Rimuovi comunicato', stile: 'neg', onClick: () => rimuovi(b) },
      ],
    }
  }

  return (
    <div data-sk-root="" data-sk-on={sk === 'on' ? '1' : undefined} className="relative box-border flex h-full flex-col gap-3 px-4 sm:px-8">
      <BarraAltro
        locali={!single ? <PilloleLocali locali={locali} selezionati={loc ? [loc] : []} onCambia={cambiaLoc} etichettaTutti="Tutti" className="sm:mx-0 sm:px-0" /> : undefined}
        kpis={kpis}
        nuovo={canPost ? { l: 'Nuovo comunicato', onClick: nuovo.apri } : undefined}
      />
      <GrigliaAltro>
        <ElencoAltro
          testate={[{ l: 'Comunicato', a: 'left' }, { l: 'Lettura', a: 'right' }, { l: 'Data', a: 'right' }, { l: 'Destinatari', a: 'right' }]}
          colonne="minmax(0,1.4fr) 100px 92px 132px" righe={righe} scelta={sel} onScegli={scegli}
          vuoto={{ t: 'Nessun comunicato', s: loc ? 'Nessun comunicato per questo locale.' : 'Pubblica il primo comunicato con Nuovo comunicato.' }}
        />
        <PannelloDettaglio d={d} chiave={`bacheca|${sel}|${loc}`} esce={esceD} onChiudi={chiudiDettaglio} />
      </GrigliaAltro>
      {sk !== 'no' && <ScheletroForma esce={sk === 'out'} />}
      {nuovo.foglio}
    </div>
  )
}

// ── Capo servizio: QR del locale e messaggi ──────────────────────────────

function BachecaCapo({ initialBulletins, initialReads, restaurants, staff, currentUserId, currentRestaurantId, canPost, qr }: Props) {
  const [bulletins, setBulletins] = useComunicatiInDiretta(initialBulletins)
  // Pallino blu: comunicati di altri che non avevo ancora letto all'apertura.
  const [nonLetti] = useState(() => new Set(initialBulletins.filter(b => b.created_by !== currentUserId && !initialReads.some(r => r.bulletin_id === b.id && r.user_id === currentUserId)).map(b => b.id)))
  const segnati = useRef(new Set<string>())
  const [adesso] = useState(() => Date.now())

  // Il testo è tutto visibile: aprire la bacheca vale come lettura.
  useEffect(() => {
    const da = bulletins.filter(b => b.created_by !== currentUserId && !segnati.current.has(b.id))
    if (!da.length) return
    da.forEach(b => segnati.current.add(b.id))
    createClient().from('bulletin_reads')
      .upsert(da.map(b => ({ bulletin_id: b.id, user_id: currentUserId })), { onConflict: 'bulletin_id,user_id', ignoreDuplicates: true })
      .then(() => {})
  }, [bulletins, currentUserId])

  const nuovo = useNuovoComunicato({
    single: true, staff, restaurants, currentRestaurantId, currentUserId,
    onPubblicato: b => setBulletins(bs => [b, ...bs.filter(x => x.id !== b.id)]),
  })

  const oggi = formatInTimeZone(new Date(adesso), TZ, 'yyyy-MM-dd')
  const ieri = formatInTimeZone(new Date(adesso - 864e5), TZ, 'yyyy-MM-dd')
  const quando = (iso: string) => {
    const g = giornoRoma(iso), h = oraRoma(iso)
    if (g === oggi) return 'oggi ' + h
    if (g === ieri) return 'ieri ' + h
    if (adesso - new Date(iso).getTime() < 6 * 864e5) return GG3[new Date(g + 'T12:00:00Z').getUTCDay()] + ' ' + h
    return dataCorta(iso, oggi)
  }
  const autore = (b: ComunicatoRiga) => {
    if (b.created_by === currentUserId) return 'Tu'
    const n = b.author?.full_name ?? ''
    if (!n) return 'Direzione'
    return b.author?.role === 'manager' ? 'Manager · ' + n.split(' ')[0] : n
  }

  return (
    <div className="box-border flex h-full flex-col gap-4 px-4 pt-3">
      <span className="px-1 text-[28px] font-semibold tracking-[-0.8px]">Bacheca</span>
      {qr?.qr_secret && <RigaQr locale={qr} />}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-border bg-card">
        <div className="flex flex-none items-center justify-between border-b border-border px-3.5 py-3">
          <span className="text-[15px] font-semibold">Messaggi</span>
          {canPost && <button type="button" onClick={nuovo.apri} className="text-[13px] font-medium text-muted-foreground active:scale-[0.97]">+ Nuovo</button>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {bulletins.length === 0 && (
            <div className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center">
              <span className="text-[15px] font-semibold">Nessun messaggio</span>
              <span className="text-[13px] text-muted-foreground">I comunicati della direzione compaiono qui.</span>
            </div>
          )}
          {bulletins.map((b, i) => (
            <div key={b.id} className="anim-inrise flex flex-col gap-1.5 border-b border-border p-3.5" style={{ animationDelay: `${Math.min(i, 10) * 70}ms` }}>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 flex-none rounded-full" style={{ background: nonLetti.has(b.id) ? 'var(--turni)' : 'transparent' }} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{autore(b)}</span>
                <span className="flex-none font-mono text-xs text-muted-foreground">{quando(b.created_at)}</span>
              </div>
              <span className="text-[15px] leading-[1.45] text-pretty">
                <span className="font-medium">{b.title}</span>
                {b.body && <span className="block whitespace-pre-wrap">{b.body}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
      {nuovo.foglio}
    </div>
  )
}
