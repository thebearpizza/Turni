'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'
import { chiediConferma } from '@/components/shared/Conferma'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import { Calendario } from '@/components/cassa/analisi/Filtri'
import { impostaSottotitolo } from '@/components/shell/intestazioneDinamica'
import { notificaChiusuraConfermata } from '@/app/actions/cassa'
import { friendlySaveError } from '@/lib/supabase/friendlyError'
import { CategorieManagerDialog } from '@/components/cassa/CategorieManagerDialog'
import { ReportChiusuraCapture, type ReportChiusuraEstratto } from '@/components/cassa/ReportChiusuraCapture'
import { FormSpesa, caricaFotoScontrino, colonnaMancante, type SpesaInserita } from '@/components/cassa/FormSpesa'
import { DettaglioChiusura } from '@/components/cassa/DettaglioChiusura'
import {
  CampoCassa, RigaTastierino, PillolaCategoria, Foglio, IconaPiuPieno, IconaGiu, IconaX, useApriChiudi, useTelefono,
  n2, diffTesto, Contenitore, dataLunga, dataBreve, dataNum, piuGiorni, USCITA,
} from '@/components/cassa/comuni'
import { cn } from '@/lib/utils'
import type { CassaCategoria, CassaChiusura, CassaSpesa, CassaSpesaBozza } from '@/types'

// Chiusura cassa del cassiere (Chiusura Tablet v2, telefono da Cassiere e
// Dipendente 3b): una fase alla volta (Incassi → Spese → Quadratura) con il
// riepilogo sempre visibile a destra su tablet; dopo "Conferma chiusura" si
// apre il dettaglio, modificabile con revisione del manager (5e).

const TZ = 'Europe/Rome'
type Chiave = 'fondoI' | 'contanti' | 'pos' | 'bonifico' | 'asporto' | 'coperti' | 'fondoF' | 'cpb'
type Valori = Record<Chiave, number | null>
const VUOTI: Valori = { fondoI: null, contanti: null, pos: null, bonifico: null, asporto: null, coperti: null, fondoF: null, cpb: null }
const COLONNA: Record<Chiave, keyof CassaChiusura> = {
  fondoI: 'fondo_cassa_iniziale', contanti: 'entrate_contanti', pos: 'entrate_pos', bonifico: 'entrate_bonifico',
  asporto: 'incasso_asporto', coperti: 'coperti', fondoF: 'fondo_cassa_finale', cpb: 'contanti_per_banca',
}
// Obbligatori anche con 0: conta che l'operatore li abbia digitati.
const FASE1: Chiave[] = ['contanti', 'pos', 'bonifico', 'asporto', 'coperti']
const FASE3: Chiave[] = ['fondoF', 'cpb']
const v0 = (x: number | null) => x ?? 0

// Chi chiude dopo mezzanotte (fino alle 3) sta chiudendo il servizio del
// giorno prima: i turni oltre mezzanotte appartengono allo stesso giorno.
function dataDiDefault(): string {
  const ora = new Date()
  const h = Number(formatInTimeZone(ora, TZ, 'H'))
  return formatInTimeZone(h < 3 ? new Date(ora.getTime() - 864e5) : ora, TZ, 'yyyy-MM-dd')
}

interface Props {
  role: 'manager' | 'cassiere'
  restaurants: { id: string; name: string }[]
  fixedRestaurantId: string | null
  userId: string
  nomeUtente: string
}

export function ChiusuraCassaClient({ role, restaurants, fixedRestaurantId, userId, nomeUtente }: Props) {
  const tel = useTelefono()
  const sp = useSearchParams()
  const oggi = useMemo(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'), [])

  const [restaurantId, setRestaurantId] = useState(sp.get('restaurant_id') ?? fixedRestaurantId ?? (restaurants.length === 1 ? restaurants[0].id : restaurants[0]?.id ?? ''))
  const [data, setData] = useState(() => sp.get('data') ?? dataDiDefault())
  const [fase, setFase] = useState<1 | 2 | 3>(1)
  const [faseEsce, setFaseEsce] = useState(false)
  const [stato, setStato] = useState<'carica' | 'ok' | 'errore'>('carica')
  const [chiusura, setChiusura] = useState<CassaChiusura | null>(null)
  const [valori, setValori] = useState<Valori>(VUOTI)
  const [prec, setPrec] = useState<{ fondo: number; data: string } | null>(null)
  const [spese, setSpese] = useState<CassaSpesa[]>([])
  const [bozze, setBozze] = useState<CassaSpesaBozza[]>([])
  const [nomi, setNomi] = useState<Record<string, string>>({})
  const [categorie, setCategorie] = useState<CassaCategoria[]>([])
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [altreBozze, setAltreBozze] = useState<{ id: string; restaurant_id: string; data: string }[]>([])
  const [mancanti, setMancanti] = useState<Set<Chiave>>(new Set())
  const [invio, setInvio] = useState(false)
  const [appenaInviata, setAppenaInviata] = useState(false)
  const calendario = useApriChiudi()
  const report = useApriChiudi()

  // Fondo cassa iniziale = fondo finale della chiusura precedente: non si
  // modifica. Solo la prima chiusura di un locale lo chiede a mano.
  const fondoBloccato = !!prec
  const locale = restaurants.find(r => r.id === restaurantId)
  const confermata = chiusura?.stato === 'confermata'

  // ── Caricamento della chiusura di (locale, giorno) ─────────────────
  const req = useRef(0)
  const carica = useCallback(async () => {
    if (!restaurantId) { setStato('ok'); return }
    const mio = ++req.current
    setStato('carica')
    const sb = createClient()
    try {
      const [{ data: riga, error: e1 }, { data: p }, { data: bz }] = await Promise.all([
        sb.from('cassa_chiusure').select('*').eq('restaurant_id', restaurantId).eq('data', data).maybeSingle(),
        sb.from('cassa_chiusure').select('fondo_cassa_finale, data').eq('restaurant_id', restaurantId).lt('data', data).eq('stato', 'confermata').order('data', { ascending: false }).limit(1).maybeSingle(),
        sb.from('cassa_spese_bozza').select('*').eq('restaurant_id', restaurantId).eq('data', data).order('created_at'),
      ])
      if (e1) throw e1
      if (req.current !== mio) return
      const r = riga as CassaChiusura | null
      setChiusura(r)
      setPrec(p ? { fondo: Number(p.fondo_cassa_finale), data: p.data } : null)
      setBozze((bz ?? []) as CassaSpesaBozza[])
      if (r) {
        const v = { ...VUOTI }
        for (const k of Object.keys(COLONNA) as Chiave[]) v[k] = Number(r[COLONNA[k]])
        setValori(v)
        const { data: s } = await sb.from('cassa_spese').select('*').eq('chiusura_id', r.id).order('created_at')
        if (req.current !== mio) return
        setSpese((s ?? []) as CassaSpesa[])
      } else {
        // Fondo cassa iniziale = fondo finale della chiusura precedente.
        setValori({ ...VUOTI, fondoI: p ? Number(p.fondo_cassa_finale) : null })
        setSpese([])
      }
      // Nomi di chi ha annotato le bozze ("Marco · 19:40"): la RLS può non
      // mostrare gli altri profili al cassiere, in quel caso resta l'ora.
      const ids = [...new Set(((bz ?? []) as CassaSpesaBozza[]).map(b => b.created_by).filter(Boolean))] as string[]
      if (ids.length) {
        const { data: pr } = await sb.from('profiles').select('id, full_name').in('id', ids)
        if (req.current === mio) setNomi(Object.fromEntries(((pr ?? []) as { id: string; full_name: string }[]).map(x => [x.id, x.full_name.split(' ')[0]])))
      }
      setMancanti(new Set())
      setStato('ok')
    } catch {
      if (req.current === mio) setStato('errore')
    }
  }, [restaurantId, data])

  useEffect(() => { carica() }, [carica])

  useEffect(() => {
    if (!restaurantId) return
    const sb = createClient()
    sb.from('restaurants').select('owner_id').eq('id', restaurantId).single().then(({ data: r }) => setOwnerId(r?.owner_id ?? null))
  }, [restaurantId])

  const caricaCategorie = useCallback(async () => {
    if (!ownerId) return
    const { data: c } = await createClient().from('cassa_categorie').select('*').eq('owner_id', ownerId).order('nome')
    setCategorie((c ?? []) as CassaCategoria[])
  }, [ownerId])
  useEffect(() => { caricaCategorie() }, [caricaCategorie])

  // Bozze non inviate di altri giorni, da riprendere.
  const ids = useMemo(() => restaurants.map(r => r.id).join(','), [restaurants])
  const caricaAltre = useCallback(async () => {
    if (!ids) return
    const { data: b } = await createClient().from('cassa_chiusure').select('id, restaurant_id, data').in('restaurant_id', ids.split(',')).eq('stato', 'in_verifica').order('data', { ascending: false })
    setAltreBozze((b ?? []) as { id: string; restaurant_id: string; data: string }[])
  }, [ids])
  useEffect(() => { caricaAltre() }, [caricaAltre])
  useEffect(() => {
    const sb = createClient()
    const ch = sb.channel('cassa_chiusura_bozze').on('postgres_changes', { event: '*', schema: 'public', table: 'cassa_chiusure' }, () => caricaAltre()).subscribe()
    return () => { sb.removeChannel(ch) }
  }, [caricaAltre])

  // Intestazione del guscio: giorno della chiusura e stato.
  useEffect(() => {
    impostaSottotitolo(`${dataLunga(data)}${chiusura && !confermata ? ' · bozza' : ''}`)
  }, [data, chiusura, confermata])
  useEffect(() => () => impostaSottotitolo(null), [])

  function vaiA(nuovoLocale: string, nuovaData: string) {
    setRestaurantId(nuovoLocale)
    setData(nuovaData)
    setFase(1)
    setAppenaInviata(false)
    setChiusura(null)
  }

  function cambiaFase(f: 1 | 2 | 3) {
    if (f === fase) return
    setFaseEsce(true)
    setTimeout(() => { setFase(f); setFaseEsce(false) }, USCITA)
  }

  // ── Calcoli (regole di dominio) ─────────────────────────────────────
  const totSpese = spese.reduce((s, x) => s + Number(x.importo), 0)
  const totEntrate = v0(valori.contanti) + v0(valori.pos) + v0(valori.bonifico)
  const media = valori.coperti ? Math.max(0, totEntrate - v0(valori.asporto)) / valori.coperti : 0
  const bancaTeorica = v0(valori.fondoI) + v0(valori.contanti) - totSpese - v0(valori.fondoF)
  const diff = v0(valori.cpb) - bancaTeorica
  const quadra = Math.abs(diff) < 0.005
  const imposta = (k: Chiave) => (n: number) => { setValori(v => ({ ...v, [k]: n })); setMancanti(m => { if (!m.has(k)) return m; const x = new Set(m); x.delete(k); return x }) }

  function payload() {
    const o: Record<string, number> = {}
    for (const k of Object.keys(COLONNA) as Chiave[]) o[COLONNA[k] as string] = v0(valori[k])
    return o
  }

  // Trova o crea la bozza del giorno (serve un id per spese e bozze confermate).
  async function assicuraChiusura(): Promise<CassaChiusura | null> {
    if (chiusura) return chiusura
    const sb = createClient()
    const { data: r, error } = await sb.from('cassa_chiusure')
      .insert({ restaurant_id: restaurantId, data, stato: 'in_verifica' as const, created_by: userId, updated_by: userId, ...payload() }).select().single()
    if (!error && r) { setChiusura(r as CassaChiusura); return r as CassaChiusura }
    if (error?.code === '23505') {
      const { data: e } = await sb.from('cassa_chiusure').select('*').eq('restaurant_id', restaurantId).eq('data', data).single()
      if (e) { setChiusura(e as CassaChiusura); return e as CassaChiusura }
    }
    toast({ title: friendlySaveError(error), variant: 'destructive' })
    return null
  }

  async function avantiSpese() {
    const fondoObbl = !prec ? (['fondoI'] as Chiave[]) : []
    const manca = [...FASE1, ...fondoObbl].filter(k => valori[k] === null)
    if (manca.length) { setMancanti(new Set(manca)); toast({ title: 'Compila tutti gli incassi, anche con 0 se è corretto.', variant: 'destructive' }); return }
    setInvio(true)
    const sb = createClient()
    const { data: r, error } = chiusura
      ? await sb.from('cassa_chiusure').update({ ...payload(), updated_by: userId }).eq('id', chiusura.id).select().single()
      : await sb.from('cassa_chiusure').upsert({ restaurant_id: restaurantId, data, stato: 'in_verifica' as const, created_by: userId, updated_by: userId, ...payload() }, { onConflict: 'restaurant_id,data' }).select().single()
    setInvio(false)
    if (error || !r) { toast({ title: friendlySaveError(error), variant: 'destructive' }); return }
    setChiusura(r as CassaChiusura)
    cambiaFase(2)
  }

  async function conferma() {
    if (!chiusura) return
    const manca = FASE3.filter(k => valori[k] === null)
    if (manca.length) { setMancanti(new Set(manca)); toast({ title: 'Inserisci fondo finale e contanti per banca, anche con 0.', variant: 'destructive' }); return }
    setInvio(true)
    const { data: r, error } = await createClient().from('cassa_chiusure')
      .update({ ...payload(), stato: 'confermata' as const, updated_by: userId }).eq('id', chiusura.id).select().single()
    setInvio(false)
    if (error || !r) { toast({ title: 'Invio non riuscito, la chiusura resta in bozza.', variant: 'destructive' }); return }
    setChiusura(r as CassaChiusura)
    setAppenaInviata(true)
    toast({ title: `Chiusura di ${dataLunga(data).toLowerCase()} inviata` })
    // Solo alla prima conferma: notifica i manager (non deve bloccare).
    notificaChiusuraConfermata(chiusura.id).catch(() => {})
  }

  // ── Spese (fase 2) ─────────────────────────────────────────────────
  async function aggiungiSpesa(s: SpesaInserita): Promise<boolean> {
    const c = await assicuraChiusura()
    if (!c) return false
    const sb = createClient()
    const foto = await caricaFotoScontrino(restaurantId, s.foto)
    const base = { chiusura_id: c.id, nome_spesa: s.nome, categoria_id: s.categoriaId, importo: s.importo, created_by: userId }
    let { data: r, error } = await sb.from('cassa_spese').insert((foto ? { ...base, foto_path: foto } : base) as typeof base).select().single()
    if (error && foto && colonnaMancante(error)) {
      ({ data: r, error } = await sb.from('cassa_spese').insert(base).select().single())
      if (!error) toast({ title: 'Spesa aggiunta, la foto non è stata salvata', variant: 'destructive' })
    }
    if (error || !r) { toast({ title: friendlySaveError(error), variant: 'destructive' }); return false }
    if (s.foto && !foto) toast({ title: 'Spesa aggiunta, la foto non è stata caricata', variant: 'destructive' })
    setSpese(p => [...p, r as CassaSpesa])
    return true
  }

  const salvaImporto = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  function cambiaImporto(id: string, n: number) {
    setSpese(p => p.map(x => (x.id === id ? { ...x, importo: n } : x)))
    clearTimeout(salvaImporto.current[id])
    salvaImporto.current[id] = setTimeout(async () => {
      if (n <= 0) return
      const { error } = await createClient().from('cassa_spese').update({ importo: n }).eq('id', id)
      if (error) toast({ title: friendlySaveError(error), variant: 'destructive' })
    }, 700)
  }
  async function eliminaSpesa(x: CassaSpesa) {
    const { error } = await createClient().from('cassa_spese').delete().eq('id', x.id)
    if (error) { toast({ title: friendlySaveError(error), variant: 'destructive' }); return }
    setSpese(p => p.filter(y => y.id !== x.id))
    toast({ title: `«${x.nome_spesa}» eliminata` })
  }

  // ── Bozze di spesa (fase 1) ────────────────────────────────────────
  const [bzEsce, setBzEsce] = useState<string | null>(null)
  async function salvaBozza(s: SpesaInserita): Promise<boolean> {
    const sb = createClient()
    const foto = await caricaFotoScontrino(restaurantId, s.foto)
    const base = { restaurant_id: restaurantId, data, nome_spesa: s.nome, categoria_id: s.categoriaId, importo: s.importo, created_by: userId }
    let { data: r, error } = await sb.from('cassa_spese_bozza').insert((foto ? { ...base, foto_path: foto } : base) as typeof base).select().single()
    if (error && foto && colonnaMancante(error)) ({ data: r, error } = await sb.from('cassa_spese_bozza').insert(base).select().single())
    if (error || !r) { toast({ title: friendlySaveError(error), variant: 'destructive' }); return false }
    setBozze(p => [...p, r as CassaSpesaBozza])
    setNomi(n => ({ ...n, [userId]: nomeUtente.split(' ')[0] }))
    toast({ title: 'Bozza di spesa salvata' })
    swapNuova(false)
    return true
  }
  async function chiudiBozza(b: CassaSpesaBozza, conferma: boolean) {
    if (bzEsce) return
    const sb = createClient()
    if (conferma) {
      const c = await assicuraChiusura()
      if (!c) return
      const { data: r, error } = await sb.from('cassa_spese').insert({ chiusura_id: c.id, nome_spesa: b.nome_spesa, categoria_id: b.categoria_id, importo: b.importo, created_by: b.created_by ?? userId }).select().single()
      if (error || !r) { toast({ title: friendlySaveError(error), variant: 'destructive' }); return }
      setSpese(p => [...p, r as CassaSpesa])
    }
    const { error } = await sb.from('cassa_spese_bozza').delete().eq('id', b.id)
    if (error && !conferma) { toast({ title: friendlySaveError(error), variant: 'destructive' }); return }
    setBzEsce(b.id)
    setTimeout(() => { setBozze(p => p.filter(x => x.id !== b.id)); setBzEsce(null) }, USCITA)
    toast({ title: conferma ? `«${b.nome_spesa}» confermata nelle spese` : `Bozza «${b.nome_spesa}» eliminata` })
  }
  const [nuova, setNuova] = useState(false)
  const [nuovaEsce, setNuovaEsce] = useState(false)
  function swapNuova(v: boolean) {
    if (nuovaEsce) return
    setNuovaEsce(true)
    setTimeout(() => { setNuova(v); setNuovaEsce(false) }, USCITA)
  }

  function handleReport(r: ReportChiusuraEstratto) {
    setValori(v => ({ ...v, contanti: r.entrate_contanti, pos: r.entrate_pos, bonifico: r.entrate_bonifico, ...(r.coperti != null ? { coperti: r.coperti } : {}) }))
    report.chiudi()
    toast({
      title: r.data && r.data !== data ? `Il report è del ${dataNum(r.data)}: controlla di aver scelto il giorno giusto`
        : r.scostamento_totale ? 'Il totale del report non torna con i pagamenti letti: ricontrolla' : 'Incassi letti dal report: controllali',
      variant: (r.data && r.data !== data) || r.scostamento_totale ? 'destructive' : 'default',
    })
  }

  async function eliminaBozzaGiorno(b: { id: string; restaurant_id: string; data: string }) {
    if (!(await chiediConferma({ titolo: 'Eliminare la bozza?', testo: `${restaurants.find(r => r.id === b.restaurant_id)?.name ?? ''} · ${dataBreve(b.data)}: i dati inseriti andranno persi.`, conferma: 'Elimina' }))) return
    const { error } = await createClient().from('cassa_chiusure').delete().eq('id', b.id)
    if (error) { toast({ title: friendlySaveError(error), variant: 'destructive' }); return }
    setAltreBozze(p => p.filter(x => x.id !== b.id))
    toast({ title: 'Bozza eliminata' })
  }

  const locali = useMemo(() => restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) })), [restaurants])
  const gestisci = role === 'manager' && ownerId
    ? <CategorieManagerDialog ownerId={ownerId} onChange={caricaCategorie} />
    : undefined

  // ── Dettaglio dopo l'invio (5e) ─────────────────────────────────────
  if (stato === 'ok' && chiusura && confermata) {
    return (
      <Contenitore>
        <BarraAlta tel={tel} role={role} locali={locali} restaurantId={restaurantId} data={data} oggi={oggi} calendario={calendario}
          onLocale={id => vaiA(id, data)} onData={d => vaiA(restaurantId, d)} />
        <DettaglioChiusura
          chiusura={chiusura} spese={spese} categorie={categorie} role={role} userId={userId} tel={tel}
          appenaInviata={appenaInviata} nomeLocale={locale?.name ?? ''}
          onNuova={() => vaiA(restaurantId, data < oggi ? piuGiorni(data, 1) : dataDiDefault() > data ? dataDiDefault() : piuGiorni(data, 1))}
          onAggiornata={carica}
        />
      </Contenitore>
    )
  }

  const riepilogo: { l: string; v: string | null }[] = [
    { l: 'Totale entrate', v: n2(totEntrate) },
    { l: 'Media scontrino', v: n2(media) },
    { l: 'Spese', v: fase >= 2 || spese.length ? n2(totSpese) : null },
    { l: 'Fondo finale', v: fase === 3 ? n2(v0(valori.fondoF)) : null },
    { l: 'Banca teorica', v: fase === 3 ? n2(bancaTeorica) : null },
  ]
  const diffMostra = fase === 3 && valori.cpb !== null
  const animFase = faseEsce ? 'anim-swapout' : 'anim-swapin'
  const notaFondo = prec ? `DA CHIUSURA ${dataNum(prec.data)}` : undefined

  const listaSpese = (bordoTop: boolean) => spese.map(x => {
    const cat = categorie.find(c => c.id === x.categoria_id)
    return (
      <RigaTastierino key={x.id} valore={Number(x.importo)} onCambia={n => cambiaImporto(x.id, n)} onRimuovi={() => eliminaSpesa(x)} etichettaRimuovi="Elimina spesa"
        className={cn('grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-border', tel ? 'px-3.5 py-3' : 'px-[18px] py-4', bordoTop ? 'border-t' : 'border-b')}>
        {({ testo }) => (<>
          <span className="text-base font-medium">{x.nome_spesa}</span>
          <span className={cn('font-mono text-lg font-medium', testo && 'text-[oklch(0.45_0.1_180)]')}>{testo ?? n2(Number(x.importo))}</span>
          <span className="flex items-center gap-2 text-[13px] text-muted-foreground">{cat && <PillolaCategoria>{cat.nome}</PillolaCategoria>}{(x as CassaSpesa & { foto_path?: string | null }).foto_path ? 'scontrino allegato' : ''}</span>
        </>)}
      </RigaTastierino>
    )
  })

  const pannelloBozze = (
    nuova ? (
      <div className={cn('mt-0 sm:mt-7', nuovaEsce ? 'anim-swapout' : 'anim-swapin')}>
        <FormSpesa restaurantId={restaurantId} categorie={categorie} titolo="Nuova bozza di spesa"
          destra={`${bozze.length} ${bozze.length === 1 ? 'bozza salvata' : 'bozze salvate'}`} cta="Salva bozza"
          onSalva={salvaBozza} onAnnulla={() => swapNuova(false)} gestisciCategorie={gestisci} />
      </div>
    ) : (
      <div className={cn('flex flex-col overflow-hidden rounded-[8px] border border-line-strong bg-card', tel ? 'mt-1' : 'mt-7 [contain:size]', nuovaEsce ? 'anim-swapout' : 'anim-swapin')}>
        <div className="flex items-baseline justify-between px-5 pb-3 pt-[18px]">
          <span className="text-[17px] font-semibold">Bozze di spesa</span>
          <span className="text-[13px] text-muted-foreground">inserite durante il turno</span>
        </div>
        <div className="-mt-px min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border">
          {bozze.length === 0 && <div className="border-t border-border px-5 py-6 text-center text-[13px] text-muted-foreground">Nessuna bozza: le spese annotate durante il turno compaiono qui.</div>}
          {bozze.map(b => {
            const cat = categorie.find(c => c.id === b.categoria_id)
            const ora = formatInTimeZone(new Date(b.created_at), TZ, 'HH:mm')
            const chi = b.created_by ? nomi[b.created_by] : undefined
            return (
              <div key={b.id} className={cn('flex flex-col gap-3 border-t border-border px-5 py-4', bzEsce === b.id && 'anim-swapout')}>
                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                  <span className="text-base font-medium">{b.nome_spesa}</span>
                  <span className="font-mono text-lg font-medium">{n2(Number(b.importo))}</span>
                  <span className="flex items-center gap-2 text-[13px] text-muted-foreground">{cat && <PillolaCategoria>{cat.nome}</PillolaCategoria>}{[chi, ora, (b as CassaSpesaBozza & { foto_path?: string | null }).foto_path ? 'foto' : null].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="grid grid-cols-[1fr_2fr] gap-2">
                  <button type="button" onClick={() => chiudiBozza(b, false)} className="flex h-12 items-center justify-center rounded-[12px] bg-neg-tint text-[15px] font-semibold text-neg transition-transform duration-150 active:scale-[0.97]">Elimina</button>
                  <button type="button" onClick={() => chiudiBozza(b, true)} className="flex h-12 items-center justify-center rounded-[12px] border border-foreground text-[15px] font-semibold transition-transform duration-150 active:scale-[0.97]">Conferma nelle spese</button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-auto border-t border-border px-5 py-4">
          <button type="button" onClick={() => swapNuova(true)} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-line-strong text-[15px] font-medium active:scale-[0.99]">
            <IconaPiuPieno />Nuova bozza di spesa
          </button>
        </div>
      </div>
    )
  )

  const speseDelGiorno = (
    <div className="mt-7 flex flex-col self-start overflow-hidden rounded-[14px] border border-border bg-card">
      <div className="flex items-baseline justify-between px-5 pb-3 pt-[18px]"><span className="text-[17px] font-semibold">Spese del giorno</span><span className="text-[13px] text-muted-foreground">dalla fase 2</span></div>
      {spese.length === 0 && <div className="border-t border-border px-5 py-4 text-[13px] text-muted-foreground">Nessuna spesa registrata.</div>}
      {listaSpese(true)}
      <div className="flex h-14 items-center justify-between border-t border-border bg-[oklch(0.97_0.01_250)] px-5 dark:bg-secondary"><span className="text-[15px] font-semibold">Totale spese</span><span className="font-mono text-xl font-semibold">€ {n2(totSpese)}</span></div>
    </div>
  )

  const fasi = ['Incassi', 'Spese', 'Quadratura']
  const titoli = ['Incassi della giornata', 'Spese pagate in contanti', 'Fondo e contanti per la banca']
  const cta = fase === 1 ? 'Avanti: spese' : fase === 2 ? 'Avanti: quadratura' : 'Conferma chiusura'
  const avanti = fase === 1 ? avantiSpese : fase === 2 ? () => cambiaFase(3) : conferma
  const indietro = () => cambiaFase(fase === 3 ? 2 : 1)
  // Si torna indietro toccando una fase già fatta (barra in alto o riepilogo).
  const vaiFase = (i: number) => { if (i + 1 < fase) cambiaFase((i + 1) as 1 | 2 | 3) }

  const bozzeAltrove = altreBozze.filter(b => !(b.restaurant_id === restaurantId && b.data === data))

  return (
    <Contenitore>
      <BarraAlta tel={tel} role={role} locali={locali} restaurantId={restaurantId} data={data} oggi={oggi} calendario={calendario}
        onLocale={id => vaiA(id, data)} onData={d => vaiA(restaurantId, d)}
        fasi={tel ? undefined : (
          <div className="flex flex-1 justify-center gap-2">
            {fasi.map((l, i) => {
              const fatta = i + 1 < fase, on = i + 1 === fase
              return (
                <button key={l} type="button" onClick={() => vaiFase(i)} disabled={!fatta}
                  className={cn('flex h-11 items-center gap-2 rounded-full px-[18px] text-sm font-semibold transition-[background-color] duration-200',
                    on ? 'bg-[oklch(0.94_0.04_180)] dark:bg-[oklch(0.3_0.05_180)]' : '', on || fatta ? 'text-foreground' : 'text-muted-foreground', fatta && 'active:scale-[0.97]')}>
                  <span className={cn('flex h-[22px] w-[22px] items-center justify-center rounded-full font-mono text-xs font-semibold', on || fatta ? 'bg-[oklch(0.58_0.12_180)] text-white' : 'bg-border text-muted-foreground')}>{fatta ? '✓' : i + 1}</span>
                  {l}
                </button>
              )
            })}
          </div>
        )} />

      {bozzeAltrove.length > 0 && (
        <div className={cn('flex flex-none flex-wrap gap-2', tel ? 'px-4 pb-3' : 'px-8 pt-3')}>
          {bozzeAltrove.map(b => (
            <div key={b.id} className="flex h-10 items-center gap-1 rounded-full bg-warn-tint pl-3.5 text-[13px] font-medium text-warn">
              <button type="button" onClick={() => vaiA(b.restaurant_id, b.data)} className="h-10 active:scale-[0.98]">
                Bozza non inviata · {role === 'manager' ? `${restaurants.find(r => r.id === b.restaurant_id)?.name ?? ''} · ` : ''}{dataBreve(b.data)} · <span className="font-semibold underline underline-offset-2">Riprendi</span>
              </button>
              <button type="button" aria-label="Elimina bozza" onClick={() => eliminaBozzaGiorno(b)} className="flex h-10 w-10 items-center justify-center rounded-full active:scale-[0.94]"><IconaX size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {stato === 'errore' ? (
        <div className="anim-swapin flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
          <span className="text-[15px] font-semibold text-neg">Caricamento non riuscito</span>
          <span className="text-[13px] text-muted-foreground">Non riesco a leggere la chiusura. Controlla la connessione.</span>
          <button type="button" onClick={carica} className="mt-3 flex h-11 items-center rounded-[12px] border border-line-strong bg-card px-[18px] text-sm font-semibold active:scale-[0.97]">Riprova</button>
        </div>
      ) : !restaurantId ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">Nessun locale assegnato: chiedi al manager di associarti a un locale.</div>
      ) : stato === 'carica' ? (
        <div className="flex flex-1 flex-col gap-4 p-8">{[60, 80, 70].map(w => <div key={w} className="h-16 rounded-[12px] bg-[linear-gradient(90deg,var(--sk-a)_25%,var(--sk-b)_50%,var(--sk-a)_75%)] bg-[length:200%_100%] [animation:sk-sh_1.4s_linear_infinite]" style={{ width: `${w}%` }} />)}</div>
      ) : tel ? (
        // ── Telefono (3b): passaggi in sequenza, conferma fissa in fondo ──
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="grid flex-none grid-cols-3 gap-1.5 px-5 pb-3.5">
            {fasi.map((l, i) => (
              // Area toccabile di 41 px attorno al disegno (barretta + etichetta,
              // 25 px): i margini negativi lasciano l'impaginazione com'era.
              <button key={l} type="button" onClick={() => vaiFase(i)} className="-my-2 flex min-h-10 flex-col gap-1.5 py-2 text-left">
                <span className={cn('h-[3px] rounded-[2px]', i + 1 <= fase ? 'bg-[oklch(0.58_0.12_180)]' : 'bg-border')} />
                <span className={cn('text-xs', i + 1 === fase ? 'font-semibold' : 'font-medium text-muted-foreground')}>{i + 1} {l}</span>
              </button>
            ))}
          </div>
          <div key={fase} className={cn('flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain px-4 pb-4', animFase)}>
            {fase === 1 && (<>
              {[
                { k: 'fondoI' as Chiave, l: 'Fondo cassa iniziale', ro: fondoBloccato, nota: notaFondo },
                { k: 'contanti' as Chiave, l: 'Contanti' }, { k: 'pos' as Chiave, l: 'POS' }, { k: 'bonifico' as Chiave, l: 'Bonifico' },
                { k: 'coperti' as Chiave, l: 'Coperti', int: true }, { k: 'asporto' as Chiave, l: 'Incasso asporto' },
                { k: 'fondoF' as Chiave, l: 'Fondo cassa finale', ev: true },
              ].map((f, i) => (
                <div key={f.k} className="anim-swapin" style={{ animationDelay: `${i * 70}ms` }}>
                  <CampoCassa etichetta={f.l} nota={f.nota} classeEtichetta="text-[13px]" taglia="s" valore={valori[f.k]} onCambia={imposta(f.k)}
                    variante={f.ro ? 'ro' : 'edit'} decimali={f.int ? 0 : 2} unita={f.int ? 'n.' : '€'} errore={mancanti.has(f.k)} evidenzia={f.ev && valori.fondoF === null} />
                </div>
              ))}
              <CampoCassa etichetta="Totale entrate" classeEtichetta="text-[13px]" taglia="s" valore={totEntrate} variante="auto" />
              <CampoCassa etichetta="Media scontrino" classeEtichetta="text-[13px]" taglia="s" valore={media} variante="auto" />
              <button type="button" onClick={report.apri} className="flex h-12 items-center justify-center rounded-[12px] border border-dashed border-line-strong text-sm font-medium text-muted-foreground active:scale-[0.99]">Leggi gli incassi dal report di cassa</button>
              {pannelloBozze}
            </>)}
            {fase === 2 && (<>
              <div className="flex flex-col overflow-hidden rounded-[14px] border border-border bg-card">
                {spese.length === 0 && <div className="border-b border-border px-3.5 py-5 text-center text-[13px] text-muted-foreground">Nessuna spesa pagata in contanti.</div>}
                {listaSpese(false)}
                <div className="flex h-14 items-center justify-between px-3.5"><span className="text-[15px] font-semibold">Totale spese</span><span className="font-mono text-xl font-semibold">€ {n2(totSpese)}</span></div>
              </div>
              <FormSpesa restaurantId={restaurantId} categorie={categorie} titolo="Nuova spesa" cta="Aggiungi spesa" onSalva={aggiungiSpesa} gestisciCategorie={gestisci} />
            </>)}
            {fase === 3 && (<>
              <div className="flex flex-col rounded-[14px] border border-border bg-card">
                {[['Contanti incassati', v0(valori.contanti)], ['+ Fondo iniziale', v0(valori.fondoI)], ['− Fondo finale', v0(valori.fondoF)], ['− Spese del giorno', totSpese]].map(([l, v], i) => (
                  <div key={l as string} className="anim-swapin flex h-11 items-center justify-between border-b border-border px-3.5" style={{ animationDelay: `${i * 70}ms` }}>
                    <span className="text-sm text-muted-foreground">{l}</span><span className="font-mono text-[15px] font-medium tabular-nums">{n2(v as number)}</span>
                  </div>
                ))}
                <div className="flex h-[52px] items-center justify-between px-3.5"><span className="font-mono text-[11px] font-medium uppercase tracking-[1px]">Banca teorica</span><span className="font-mono text-lg font-semibold">€ {n2(bancaTeorica)}</span></div>
              </div>
              <CampoCassa etichetta="Contanti per banca" classeEtichetta="text-[13px]" taglia="l" valore={valori.cpb} onCambia={imposta('cpb')} errore={mancanti.has('cpb')} evidenzia={valori.cpb === null} />
              <div className={cn('flex flex-col gap-1 rounded-[8px] p-3.5', !diffMostra ? 'bg-[oklch(0.94_0.01_250)] text-muted-foreground dark:bg-secondary' : quadra ? 'bg-ok-tint text-ok' : 'bg-neg-tint text-neg')}>
                <div className="flex items-baseline justify-between"><span className="text-sm font-semibold">{diffMostra && quadra ? 'Differenza · quadra' : 'Differenza'}</span><span className="font-mono text-[26px] font-semibold">{diffMostra ? diffTesto(diff) : '—'}</span></div>
                {diffMostra && !quadra && <span className="text-[13px]">Ricontrolla i contanti o le spese prima di confermare.</span>}
              </div>
            </>)}
          </div>
          <div className="flex flex-none flex-col gap-2.5 border-t border-border bg-card px-4 py-3">
            {fase === 1 && <div className="flex justify-between text-[13px] font-medium text-muted-foreground"><span>Totale incassi</span><span className="font-mono text-[15px] font-semibold text-foreground">€ {n2(totEntrate)}</span></div>}
            <div className={cn('grid gap-2', fase > 1 ? 'grid-cols-[1fr_2fr]' : 'grid-cols-1')}>
              {fase > 1 && <button type="button" onClick={indietro} className="flex h-12 items-center justify-center rounded-[12px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">Indietro</button>}
              <button type="button" onClick={avanti} disabled={invio} className="flex h-12 items-center justify-center rounded-[12px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60">{invio ? 'Invio…' : cta}</button>
            </div>
          </div>
        </div>
      ) : (
        // ── Tablet (Chiusura Tablet v2) ───────────────────────────────
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-h-0 min-w-0 flex-col gap-6 overflow-y-auto overscroll-contain px-12 py-8">
            <span key={`t${fase}`} className={cn('text-[22px] font-semibold tracking-[-0.3px]', animFase)}>{titoli[fase - 1]}</span>
            <div key={fase} className={cn('flex min-h-0 flex-1 flex-col', animFase)}>
              {fase === 1 && (
                <div className="grid min-h-0 flex-1 grid-cols-2 gap-8">
                  <div className="flex flex-col gap-x-6 gap-y-5">
                    <CampoCassa etichetta="Fondo cassa iniziale" nota={notaFondo} valore={valori.fondoI} onCambia={imposta('fondoI')} variante={fondoBloccato ? 'ro' : 'edit'} errore={mancanti.has('fondoI')} />
                    {([['contanti', 'Contanti'], ['pos', 'POS'], ['bonifico', 'Bonifico'], ['asporto', 'Incasso asporto']] as [Chiave, string][]).map(([k, l]) => (
                      <CampoCassa key={k} etichetta={l} valore={valori[k]} onCambia={imposta(k)} errore={mancanti.has(k)} />
                    ))}
                    <CampoCassa etichetta="Coperti" valore={valori.coperti} onCambia={imposta('coperti')} decimali={0} unita="n." errore={mancanti.has('coperti')} />
                    <button type="button" onClick={report.apri} className="flex h-[52px] flex-none items-center justify-center rounded-[12px] border border-dashed border-line-strong text-[15px] font-medium text-muted-foreground active:scale-[0.99]">Leggi gli incassi dal report di cassa</button>
                  </div>
                  {pannelloBozze}
                </div>
              )}
              {fase === 2 && (
                <div className="grid min-h-0 flex-1 grid-cols-2 gap-8">
                  <div className="flex flex-col self-start overflow-hidden rounded-[14px] border border-border bg-card">
                    {spese.length === 0 && <div className="border-b border-border px-[18px] py-6 text-center text-[13px] text-muted-foreground">Nessuna spesa pagata in contanti.</div>}
                    {listaSpese(false)}
                    <div className="flex h-14 items-center justify-between px-[18px]"><span className="text-[15px] font-semibold">Totale spese</span><span className="font-mono text-xl font-semibold">€ {n2(totSpese)}</span></div>
                  </div>
                  <div className="self-start"><FormSpesa restaurantId={restaurantId} categorie={categorie} titolo="Nuova spesa" cta="Aggiungi spesa" onSalva={aggiungiSpesa} gestisciCategorie={gestisci} /></div>
                </div>
              )}
              {fase === 3 && (
                <div className="grid grid-cols-2 items-stretch gap-8">
                  <div className="flex flex-col gap-5">
                    <CampoCassa etichetta="Fondo cassa finale" valore={valori.fondoF} onCambia={imposta('fondoF')} errore={mancanti.has('fondoF')} />
                    <CampoCassa etichetta="Banca teorica" valore={bancaTeorica} variante="auto" />
                    <CampoCassa etichetta="Contanti per banca" valore={valori.cpb} onCambia={imposta('cpb')} errore={mancanti.has('cpb')} evidenzia={valori.cpb === null} />
                  </div>
                  {speseDelGiorno}
                </div>
              )}
            </div>
            <div className="mt-auto flex flex-none justify-end gap-3">
              {fase > 1 && <button type="button" onClick={indietro} className="flex h-[60px] items-center rounded-[12px] border border-line-strong px-7 text-base font-medium active:scale-[0.98]">Indietro</button>}
              <button type="button" onClick={avanti} disabled={invio} className="flex h-[60px] items-center rounded-[12px] bg-primary px-9 text-[17px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60">{invio ? 'Invio…' : cta}</button>
            </div>
          </div>
          <aside className="flex min-h-0 flex-col gap-1 border-l border-border bg-card px-7 py-8">
            <span className="mb-3 text-base font-semibold">Riepilogo</span>
            {riepilogo.map((r, i) => (
              <button key={r.l} type="button" onClick={() => vaiFase(i < 2 ? 0 : i === 2 ? 1 : 2)}
                className="flex h-11 items-center justify-between border-b border-border text-left">
                <span className={cn('text-[15px]', r.v === null && 'text-muted-foreground')}>{r.l}</span>
                <span className={cn('font-mono text-base font-medium', r.v === null && 'text-muted-foreground')}>{r.v ?? '—'}</span>
              </button>
            ))}
            <div className={cn('mt-auto flex flex-col gap-1.5 rounded-[8px] p-5 transition-[background-color] duration-300',
              !diffMostra ? 'bg-[oklch(0.94_0.01_250)] text-muted-foreground dark:bg-secondary' : quadra ? 'bg-ok-tint text-[oklch(0.38_0.08_150)] dark:text-ok' : 'bg-neg-tint text-neg')}>
              <span className="text-sm font-semibold">{diffMostra && quadra ? 'Differenza · quadra' : 'Differenza'}</span>
              <span className="font-mono text-[40px] font-semibold tracking-[-1px]">{diffMostra ? diffTesto(diff) : '—'}</span>
            </div>
          </aside>
        </div>
      )}

      <Foglio aperto={report.aperto} esce={report.esce} onChiudi={report.chiudi} titolo="Report di cassa" sotto="Precompila contanti, POS, bonifico e coperti">
        <ReportChiusuraCapture restaurantId={restaurantId} data={data} onEstratto={handleReport} />
      </Foglio>
    </Contenitore>
  )
}

/** Barra in alto: giorno (sottolineato, apre il calendario), locale, fasi. */
function BarraAlta({ tel, role, locali, restaurantId, data, oggi, calendario, onLocale, onData, fasi }: {
  tel: boolean; role: 'manager' | 'cassiere'; locali: { id: string; nome: string; colore: string }[]; restaurantId: string; data: string; oggi: string
  calendario: ReturnType<typeof useApriChiudi>; onLocale: (id: string) => void; onData: (d: string) => void; fasi?: React.ReactNode
}) {
  const { aperto, esce, chiudi } = calendario
  // Un tocco fuori dal calendario lo chiude (come i pannelli di Analisi).
  useEffect(() => {
    if (!aperto || esce) return
    const h = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('[data-cal]')) chiudi() }
    const id = setTimeout(() => window.addEventListener('pointerdown', h, true), 0)
    return () => { clearTimeout(id); window.removeEventListener('pointerdown', h, true) }
  }, [aperto, esce, chiudi])
  return (
    <div className={cn('relative z-20 flex flex-none flex-wrap items-center gap-3', tel ? 'px-4 pb-3' : 'min-h-[72px] border-b border-border px-8 py-3')}>
      <div className="relative" data-cal>
        <button type="button" onClick={() => (calendario.aperto ? calendario.chiudi() : calendario.apri())}
          className="-my-1 -ml-2 flex min-h-10 items-center gap-1 rounded-[4px] px-2 text-[15px] font-medium underline decoration-[oklch(0.82_0.01_250)] underline-offset-4 active:scale-[0.98]">
          {dataLunga(data)}<IconaGiu />
        </button>
        {calendario.aperto && (
          <div className={cn('absolute left-0 top-[calc(100%+8px)] z-[46] w-[340px] max-w-[calc(100vw-32px)] rounded-[14px] border border-border bg-card p-3 shadow-[0_14px_40px_rgba(20,30,50,.16)]', calendario.esce ? 'anim-swapout' : 'anim-swapin')}>
            <Calendario iniziale={{ a: data, b: data }} ultimo={oggi} riepilogoVuoto="Scegli il giorno della chiusura"
              onApplica={r => { calendario.chiudi(); if (r.b !== data) onData(r.b) }} />
          </div>
        )}
      </div>
      {role === 'manager' && locali.length > 1 && (
        <PilloleLocali locali={locali} selezionati={restaurantId ? [restaurantId] : []} onCambia={x => { if (x[0] && x[0] !== restaurantId) onLocale(x[0]) }}
          className={tel ? 'flex-[1_1_100%]' : 'mx-0 flex-[0_1_auto] px-0'} />
      )}
      {fasi}
    </div>
  )
}
