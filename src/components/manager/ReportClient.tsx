'use client'
import { SelettoreMese } from '@/components/shared/SelettoreMese'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { Rotella } from '@/components/ui/rotella'
import { PilloleLocali } from '@/components/shared/PilloleLocali'
import { ScheletroForma } from '@/components/shared/ScheletroForma'
import { useScheletro } from '@/components/shared/useScheletro'
import { coloreLocale } from '@/components/manager/RestaurantFilter'
import {
  calcolaGriglia, giorniDelMese, dataDelGiorno, giornoPresenza, oreBrevi,
  CODICI_ASSENZA, CODICE_DA_TIPO, NOME_ASSENZA, TIPO_DA_CODICE, TZ_REPORT, MINUTI_DOPPIO_TURNO,
} from '@/app/api/report/calcolo'
import type { AssenzaRep, CodiceAssenza, DipendenteRep, Giorno, PresenzaRep } from '@/app/api/report/calcolo'

// Scheda Report del design (MTReport.dc.html): un foglio mensile
// dipendente × giorno con due viste (Foglio ore / Presenze), colonna dei
// totali e riga dei totali di giorno sempre in vista, export Excel e, per
// chi può modificare, il foglio "Salva giorno" che riscrive presenze e
// assenze di quel giorno. La stessa scheda, in sola lettura, è il Report del
// consulente del lavoro.

interface Props {
  restaurants: { id: string; name: string }[]
  /** Un solo locale (direttore, capo servizio): niente pillole dei locali. */
  singolo: boolean
  /** Manager e direttore: tocco sulla cella per modificare il giorno. */
  puoModificare: boolean
  /** Il capo servizio non direttore e il consulente senza permesso vedono solo le presenze. */
  vedeOre: boolean
  utenteId: string
  /** Locale scelto all'apertura (il primo, come nel prototipo). */
  localeIniziale?: string | null
}

type Vista = 'ore' | 'pres'
type Modo = 'work' | 'abs' | 'none'
type Fascia = { a: string; b: string }
interface Editor { empId: string; data: string; modo: Modo; fasce: Fascia[]; ty: CodiceAssenza }
interface Dati { dip: DipendenteRep[]; pres: PresenzaRep[]; ass: AssenzaRep[] }

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const WD = ['D', 'L', 'M', 'M', 'G', 'V', 'S']
const WDL = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']
const capit = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const SWAPIN = 'swapin 680ms cubic-bezier(0.22,1,0.36,1) both'

// Colori del prototipo come variabili, così reggono anche il tema scuro.
const CSS = `
@keyframes tblin{from{opacity:0;filter:blur(8px);transform:translateY(8px)}to{opacity:1;filter:blur(0);transform:none}}
.rep{--r-h:oklch(0.97 0.01 250);--r-we:oklch(0.95 0.01 250);--r-td:oklch(0.94 0.04 180);--r-tdw:oklch(0.4 0.08 180);--r-tdn:oklch(0.35 0.08 180);
--r-ctd:oklch(0.985 0.012 180);--r-cwe:oklch(0.985 0.004 250);--r-hov:oklch(0.95 0.02 180);--r-l1:oklch(0.94 0.01 250);--r-l2:oklch(0.88 0.01 250);
--r-l3:oklch(0.93 0.01 250);--r-tot:oklch(0.975 0.008 250);--r-seg:oklch(0.93 0.01 250);--r-thumb:#fff;--r-leg:oklch(0.35 0.01 250);--r-split:oklch(0.94 0.02 250);
--r-dash:oklch(0.75 0.01 250);--r-teal:oklch(0.58 0.12 180);
--r-P:oklch(0.92 0.04 150);--r-Pf:oklch(0.4 0.08 150);
--r-F:oklch(0.93 0.04 290);--r-Ff:oklch(0.4 0.1 290);--r-Fb:oklch(0.8 0.07 290);
--r-M:oklch(0.93 0.035 250);--r-Mf:oklch(0.38 0.08 250);--r-Mb:oklch(0.8 0.06 250);
--r-R:oklch(0.93 0.04 25);--r-Rf:oklch(0.45 0.1 25);--r-Rb:oklch(0.82 0.07 25);
--r-AI:oklch(0.9 0.02 250);--r-AIf:oklch(0.3 0.01 250);--r-AIb:oklch(0.7 0.02 250)}
.dark .rep{--r-h:oklch(0.21 0.01 250);--r-we:oklch(0.23 0.01 250);--r-td:oklch(0.3 0.05 180);--r-tdw:oklch(0.78 0.08 180);--r-tdn:oklch(0.86 0.08 180);
--r-ctd:oklch(0.21 0.02 180);--r-cwe:oklch(0.195 0.006 250);--r-hov:oklch(0.27 0.04 180);--r-l1:oklch(0.23 0.01 250);--r-l2:oklch(0.3 0.01 250);
--r-l3:oklch(0.25 0.01 250);--r-tot:oklch(0.2 0.008 250);--r-seg:oklch(0.24 0.01 250);--r-thumb:oklch(0.32 0.01 250);--r-leg:oklch(0.8 0.01 250);--r-split:oklch(0.26 0.02 250);
--r-dash:oklch(0.45 0.01 250);--r-teal:oklch(0.7 0.12 180);
--r-P:oklch(0.3 0.04 150);--r-Pf:oklch(0.82 0.08 150);
--r-F:oklch(0.3 0.05 290);--r-Ff:oklch(0.84 0.08 290);--r-Fb:oklch(0.45 0.07 290);
--r-M:oklch(0.3 0.04 250);--r-Mf:oklch(0.84 0.07 250);--r-Mb:oklch(0.45 0.06 250);
--r-R:oklch(0.3 0.05 25);--r-Rf:oklch(0.82 0.09 25);--r-Rb:oklch(0.45 0.07 25);
--r-AI:oklch(0.3 0.02 250);--r-AIf:oklch(0.88 0.01 250);--r-AIb:oklch(0.45 0.02 250)}
.rep-cella:hover{background:var(--r-hov)!important}
`

function useTelefono() {
  return useSyncExternalStore(
    cb => { const mq = window.matchMedia('(max-width: 639px)'); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb) },
    () => window.matchMedia('(max-width: 639px)').matches,
    () => false
  )
}

const oggiRoma = () => formatInTimeZone(new Date(), TZ_REPORT, 'yyyy-MM-dd')
const hm = (iso: string) => formatInTimeZone(new Date(iso), TZ_REPORT, 'HH:mm')
const toM = (s: string) => { const [h, m] = s.split(':').map(Number); return (h % 24) * 60 + (m || 0) }
const piuGiorni = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay()
const reparto = (e: DipendenteRep) => e.role === 'capo_servizio' ? 'Capo servizio' : (e.department ?? '')

/** Ordine delle pillole salvato sul dispositivo (stessa chiave di PilloleLocali). */
function ordinePillole(): string[] {
  try { return JSON.parse(localStorage.getItem('inturno.locOrderL') || '[]') } catch { return [] }
}

// ── Icone del prototipo ────────────────────────────────────────────────
const IconaX = ({ s = 20 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
)

export function ReportClient({ restaurants, singolo, puoModificare, vedeOre, utenteId, localeIniziale }: Props) {
  const tel = useTelefono()
  const [oggi] = useState(oggiRoma)
  const meseCorrente = oggi.slice(0, 7)
  const [mese, setMeseStato] = useState(meseCorrente)
  const [vista, setVistaStato] = useState<Vista>('pres')
  const v: Vista = vedeOre ? vista : 'pres'
  const P = v === 'pres'
  const primo = localeIniziale && restaurants.some(r => r.id === localeIniziale) ? localeIniziale : restaurants[0]?.id
  const [sel, setSelStato] = useState<string[]>(localeIniziale && primo === localeIniziale && restaurants.length > 1 ? [primo] : [])

  const { stato: sk, avvia: avviaScheletro, pronto: scheletroPronto } = useScheletro()
  const [dati, setDati] = useState<Dati>({ dip: [], pres: [], ass: [] })
  const [stato, setStato] = useState<'carica' | 'ok' | 'errore'>('carica')
  const [ultimo, setUltimo] = useState<string | null>(null)
  const [scarica, setScarica] = useState(false)

  const locali = useMemo(() => restaurants.map((r, i) => ({ id: r.id, nome: r.name, colore: coloreLocale(i) })), [restaurants])
  const nomeLoc = useMemo(() => Object.fromEntries(restaurants.map(r => [r.id, r.name])), [restaurants])
  const target = useMemo(() => {
    if (singolo) return restaurants[0] ? [restaurants[0].id] : []
    return sel.length ? restaurants.filter(r => sel.includes(r.id)).map(r => r.id) : restaurants.map(r => r.id)
  }, [singolo, sel, restaurants])
  const chiaveTarget = target.join(',')
  const multi = !singolo && target.length > 1

  const setMese = (m: string) => { if (m === mese) return; avviaScheletro(); setMeseStato(m) }
  const setSel = (x: string[]) => { avviaScheletro(); setSelStato(x) }
  // Cambiare vista non ricarica nulla: lo scheletro passa e si dissolve.
  const setVista = (x: Vista) => { if (x === vista) return; avviaScheletro(); scheletroPronto(); setVistaStato(x) }

  // ── Caricamento ────────────────────────────────────────────────────
  const req = useRef(0)
  const carica = useCallback(async () => {
    const mio = ++req.current
    const ids = chiaveTarget ? chiaveTarget.split(',') : []
    if (!ids.length) { setDati({ dip: [], pres: [], ass: [] }); setStato('ok'); scheletroPronto(); return }
    const nd = giorniDelMese(mese)
    const a = `${mese}-01`, b = `${mese}-${String(nd).padStart(2, '0')}`
    const da = fromZonedTime(`${a}T00:00:00`, TZ_REPORT).toISOString(), aa = fromZonedTime(`${b}T23:59:59`, TZ_REPORT).toISOString()
    const sb = createClient()
    try {
      const [e, p, s] = await Promise.all([
        sb.from('profiles').select('id, full_name, restaurant_id, role, department').in('role', ['dipendente', 'capo_servizio']).in('restaurant_id', ids).order('full_name'),
        sb.from('attendances').select('id, user_id, restaurant_id, check_in, check_out').in('restaurant_id', ids).gte('check_in', da).lte('check_in', aa),
        sb.from('absences').select('id, user_id, restaurant_id, type, start_date, end_date, certificate_code, notes').in('restaurant_id', ids).eq('status', 'approved').lte('start_date', b).gte('end_date', a),
      ])
      if (mio !== req.current) return
      if (e.error || p.error || s.error) throw new Error('caricamento')
      setDati({ dip: (e.data ?? []) as DipendenteRep[], pres: (p.data ?? []) as PresenzaRep[], ass: (s.data ?? []) as AssenzaRep[] })
      setStato('ok')
    } catch {
      if (mio !== req.current) return
      setStato('errore')
    }
    scheletroPronto()
  }, [mese, chiaveTarget, scheletroPronto])

  useEffect(() => { carica() }, [carica])

  // ── Griglia ────────────────────────────────────────────────────────
  const nd = giorniDelMese(mese)
  const giorni = useMemo(() => Array.from({ length: nd }, (_, i) => dataDelGiorno(mese, i + 1)), [mese, nd])
  const griglia = useMemo(() => calcolaGriglia(mese, dati.dip, dati.pres, dati.ass), [mese, dati])
  // Righe raggruppate per locale nell'ordine dei locali, poi per nome.
  const dipendenti = useMemo(() => {
    const ord = new Map(target.map((id, i) => [id, i]))
    return dati.dip.slice().sort((a, b) => (ord.get(a.restaurant_id ?? '') ?? 99) - (ord.get(b.restaurant_id ?? '') ?? 99) || a.full_name.localeCompare(b.full_name))
  }, [dati.dip, target])

  const vis = useMemo(() => {
    const colM = Array(nd).fill(0) as number[]
    const righe = dipendenti.map(e => {
      const gs = griglia.get(e.id) ?? []
      let tot = 0, gg = 0, nab = 0
      const ab: Partial<Record<CodiceAssenza, number>> = {}
      gs.forEach((g, i) => {
        if (!g) return
        if (g.tipo === 'assenza') { nab++; ab[g.codice] = (ab[g.codice] ?? 0) + 1; return }
        tot += g.minuti; gg++; colM[i] += P ? 1 : g.minuti
      })
      const nome = tel ? e.full_name.charAt(0) + '. ' + e.full_name.split(' ').slice(1).join(' ') : e.full_name
      return {
        e, gs, nome, somma: P ? gg : tot,
        rep: multi ? `${nomeLoc[e.restaurant_id ?? ''] ?? ''} · ${reparto(e)}` : reparto(e),
        tot: P ? `${gg} gg` : `${oreBrevi(tot)}h`,
        ass: P ? CODICI_ASSENZA.filter(k => ab[k]).map(k => k + ab[k]).join(' ') : nab ? `${nab} ass.` : '',
      }
    })
    const grand = righe.reduce((x, r) => x + r.somma, 0)
    return { righe, colT: colM.map(x => (x ? (P ? String(x) : oreBrevi(x)) : '')), grand: P ? `${grand} gg` : `${oreBrevi(grand)}h` }
  }, [dipendenti, griglia, nd, P, tel, multi, nomeLoc])

  // ── Export Excel (un foglio per locale, come nel prototipo) ───────
  const [y, m] = mese.split('-').map(Number)
  const etichettaMese = `${capit(MESI[m - 1])} ${y}`
  async function esportaExcel() {
    if (scarica || !restaurants.length) return
    setScarica(true)
    const tipo = P ? 'presenze' : 'ore'
    const o = ordinePillole(), rk = (n: string) => { const i = o.indexOf(n); return i < 0 ? 999 : i }
    // Solo i locali selezionati nelle pillole (Tutti = tutti), nell'ordine delle pillole.
    const ids = singolo ? target : restaurants.filter(r => target.includes(r.id)).map((r, i) => ({ r, i })).sort((a, b) => rk(a.r.name) - rk(b.r.name) || a.i - b.i).map(x => x.r.id)
    try {
      const res = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: mese, restaurantIds: ids, type: tipo }) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast({ title: err.error || 'Export Excel non riuscito', variant: 'destructive' })
        return
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `report-${tipo}-${mese}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      toast({ title: `Excel ${tipo} di ${MESI[m - 1]} ${y} scaricato` })
    } catch {
      toast({ title: 'Export Excel non riuscito. Controlla la connessione', variant: 'destructive' })
    } finally { setScarica(false) }
  }

  // ── Foglio "Salva giorno" ──────────────────────────────────────────
  const [ed, setEd] = useState<Editor | null>(null)
  const [edEsce, setEdEsce] = useState(false)
  const [k, setK] = useState<string | null>(null)
  const [kEsce, setKEsce] = useState(false)
  const [salva, setSalva] = useState(false)
  const tK = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tE = useRef<ReturnType<typeof setTimeout> | null>(null)

  // kRef segue la rotella aperta per gli handler (mai letto durante il render).
  const kRef = useRef<string | null>(null)
  const metK = useCallback((x: string | null) => { kRef.current = x; setK(x) }, [])
  const chiudiK = useCallback(() => {
    if (!kRef.current) return
    setKEsce(true)
    if (tK.current) clearTimeout(tK.current)
    tK.current = setTimeout(() => { metK(null); setKEsce(false) }, 320)
  }, [metK])
  function apriK(key: string) {
    if (kRef.current === key) return
    if (tK.current) clearTimeout(tK.current)
    if (kRef.current) { setKEsce(true); tK.current = setTimeout(() => { metK(key); setKEsce(false) }, 320) }
    else { metK(key); setKEsce(false) }
  }
  // Tocco fuori dalla rotella e dai campi orario: la rotella si chiude
  // mantenendo il valore (come il tastierino del design).
  useEffect(() => {
    if (!k) return
    const h = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('[data-kp]')) chiudiK() }
    window.addEventListener('pointerdown', h, true)
    return () => window.removeEventListener('pointerdown', h, true)
  }, [k, chiudiK])

  const chiudiEd = useCallback(() => {
    if (tK.current) clearTimeout(tK.current)
    metK(null); setKEsce(false)
    setEdEsce(true)
    if (tE.current) clearTimeout(tE.current)
    tE.current = setTimeout(() => { setEd(null); setEdEsce(false) }, 320)
  }, [metK])
  useEffect(() => {
    if (!ed) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !salva) chiudiEd() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [ed, salva, chiudiEd])
  useEffect(() => () => { if (tK.current) clearTimeout(tK.current); if (tE.current) clearTimeout(tE.current) }, [])

  function apriCella(e: DipendenteRep, d: string, g: Giorno) {
    if (!puoModificare) return
    if (tE.current) clearTimeout(tE.current)
    setEdEsce(false); metK(null)
    setEd({
      empId: e.id, data: d,
      modo: g?.tipo === 'assenza' ? 'abs' : 'work',
      fasce: g?.tipo === 'lavoro' ? g.fasce.map(p => ({ a: hm(p.check_in), b: p.check_out ? hm(p.check_out) : '' })) : [{ a: '11:00', b: '15:00' }],
      ty: g?.tipo === 'assenza' ? g.codice : 'R',
    })
  }

  async function salvaGiorno() {
    if (!ed || salva) return
    const e = dati.dip.find(x => x.id === ed.empId)
    if (!e) return
    setSalva(true)
    const sb = createClient()
    const d = ed.data
    const presGiorno = dati.pres.filter(p => p.user_id === e.id && giornoPresenza(p) === d).sort((a, b) => a.check_in.localeCompare(b.check_in))
    const assGiorno = dati.ass.find(a => a.user_id === e.id && a.start_date <= d && a.end_date >= d) ?? null
    const ok = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message) }
    // Toglie il giorno da un'assenza: se è di più giorni la accorcia o la
    // spezza in due, così il resto del periodo resta com'era.
    const liberaGiorno = async (a: AssenzaRep) => {
      if (a.start_date === d && a.end_date === d) ok(await sb.from('absences').delete().eq('id', a.id))
      else if (a.start_date === d) ok(await sb.from('absences').update({ start_date: piuGiorni(d, 1) }).eq('id', a.id))
      else if (a.end_date === d) ok(await sb.from('absences').update({ end_date: piuGiorni(d, -1) }).eq('id', a.id))
      else {
        ok(await sb.from('absences').update({ end_date: piuGiorni(d, -1) }).eq('id', a.id))
        ok(await sb.from('absences').insert({
          user_id: a.user_id, restaurant_id: a.restaurant_id, type: a.type, start_date: piuGiorni(d, 1), end_date: a.end_date,
          certificate_code: a.certificate_code ?? null, notes: a.notes ?? null, status: 'approved', created_by: utenteId,
        }))
      }
    }
    const togliPresenze = async (ids: string[]) => { if (ids.length) ok(await sb.from('attendances').delete().in('id', ids)) }
    const api = async (method: 'POST' | 'PATCH', body: object) => {
      const r = await fetch('/api/presenze', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Salvataggio della presenza non riuscito') }
    }
    try {
      if (ed.modo === 'none') {
        await togliPresenze(presGiorno.map(p => p.id))
        if (assGiorno) await liberaGiorno(assGiorno)
      } else if (ed.modo === 'abs') {
        await togliPresenze(presGiorno.map(p => p.id))
        if (!assGiorno || CODICE_DA_TIPO[assGiorno.type] !== ed.ty) {
          if (assGiorno) await liberaGiorno(assGiorno)
          ok(await sb.from('absences').insert({
            user_id: e.id, restaurant_id: e.restaurant_id, type: TIPO_DA_CODICE[ed.ty], start_date: d, end_date: d,
            status: 'approved', created_by: utenteId,
          }))
        }
      } else {
        if (assGiorno) await liberaGiorno(assGiorno)
        // Le fasce riscrivono le timbrature del giorno nell'ordine: le prime
        // si aggiornano, quelle in più si creano, quelle avanzate si tolgono.
        // L'uscita prima dell'ingresso è oltre mezzanotte (stesso giorno lavorativo).
        for (let i = 0; i < ed.fasce.length; i++) {
          const f = ed.fasce[i], p = presGiorno[i]
          if (p) await api('PATCH', { id: p.id, date: d, checkIn: f.a, checkOut: f.b || null })
          else await api('POST', { userId: e.id, date: d, checkIn: f.a, checkOut: f.b || undefined })
        }
        await togliPresenze(presGiorno.slice(ed.fasce.length).map(p => p.id))
      }
      toast({ title: `Giorno salvato · ${e.full_name}` })
      setUltimo(null)
      chiudiEd()
      await carica()
      // La cella appena salvata entra con swapin, come nel prototipo.
      setUltimo(`${d}|${e.id}`)
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Salvataggio non riuscito', variant: 'destructive' })
      await carica()
    } finally { setSalva(false) }
  }

  // ── Render ─────────────────────────────────────────────────────────
  const Q = tel
    ? { cx: 'px-3', nameW: '84px', cellW: '40px', totW: '92px', nx: 'px-2.5', tp: 'pl-[14px] pr-[6px]' }
    : { cx: 'px-[18px]', nameW: '180px', cellW: '44px', totW: '104px', nx: 'px-3.5', tp: 'pl-[22px] pr-2' }
  const fondo = 'linear-gradient(90deg,transparent,var(--card) 18px)'
  const legenda = [
    P ? { k: 'P', l: 'Presente', bg: 'var(--r-P)', fg: 'var(--r-Pf)' } : { k: '7,5', l: 'Ore', bg: 'transparent', fg: 'var(--foreground)' },
    ...CODICI_ASSENZA.map(c => ({ k: c, l: NOME_ASSENZA[c], bg: `var(--r-${c})`, fg: `var(--r-${c}f)` })),
  ]
  const avanti = mese < meseCorrente
  const spostaMese = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMese(d.toISOString().slice(0, 7)) }
  // Durante il primo caricamento righe segnaposto, così lo scheletro ha la forma della tabella.
  const segnaposto = stato === 'carica' && !vis.righe.length

  return (
    <div data-sk-root="" data-sk-on={sk === 'on' ? '1' : undefined} className="rep relative box-border flex h-full flex-col gap-3 px-4 sm:px-8">
      <style>{CSS}</style>

      <div data-sk-keep="" className="flex flex-none flex-wrap items-center gap-2.5">
        <SelettoreMese etichetta={etichettaMese} onPrec={() => spostaMese(-1)} onSucc={() => spostaMese(1)} succOk={avanti} className={tel ? 'flex-[1_1_0]' : 'w-[220px] flex-none'} />
        {!singolo && restaurants.length > 1 && <>
          {!tel && <span className="mx-1 block h-7 w-px bg-[var(--r-l2)]" />}
          <PilloleLocali multipla tuttiComeVuoto etichettaTutti="Tutti" locali={locali} selezionati={sel} onCambia={setSel}
            className={tel ? 'order-5 flex-[1_1_100%]' : 'mx-0 flex-[0_1_auto] px-0'} />
        </>}
        {!tel && <span className="flex-1" />}
        <button type="button" onClick={esportaExcel} disabled={scarica}
          className={cn('flex h-10 items-center justify-center gap-2 rounded-[8px] border border-line-strong px-[14px] text-sm font-medium transition-transform active:scale-[0.97]', tel ? 'order-6 flex-[1_1_0]' : 'flex-none', scarica && 'opacity-60')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></svg>
          Excel
        </button>
      </div>

      <div key={`${mese}|${chiaveTarget}|${v}`} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-border bg-card"
        style={{ animation: 'tblin 520ms cubic-bezier(0.22,1,0.36,1) backwards' }}>
        <div className={cn('flex flex-none flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-border py-3', Q.cx)}>
          {vedeOre && (
            <div className={cn('relative grid grid-cols-2 rounded-[9px] bg-[var(--r-seg)] p-[3px]', tel ? 'flex-[1_1_100%]' : 'flex-none')}>
              <span className="absolute bottom-[3px] left-[3px] top-[3px] w-[calc(50%-3px)] rounded-[7px] bg-[var(--r-thumb)] shadow-[0_1px_3px_rgba(0,0,0,.1)]"
                style={{ transform: `translateX(${v === 'pres' ? '100%' : '0%'})`, transition: 'transform 480ms cubic-bezier(0.3,1.18,0.5,1)' }} />
              {([['ore', 'Foglio ore'], ['pres', 'Presenze']] as const).map(([key, l]) => (
                <button key={key} type="button" onClick={() => setVista(key)}
                  className={cn('relative z-[1] flex h-[34px] items-center justify-center rounded-[7px] px-4 text-sm font-medium transition-[color,transform] duration-300 active:scale-[0.96]', v === key ? 'text-foreground' : 'text-muted-foreground')}>
                  {l}
                </button>
              ))}
            </div>
          )}
          {puoModificare && !tel && <span className="text-[13px] text-muted-foreground">tocca una cella per modificare il giorno</span>}
          {!tel && <span className="flex-1" />}
          {legenda.map(lg => (
            <span key={lg.k} className="flex items-center gap-1.5 text-xs font-medium text-[var(--r-leg)]">
              <span className="box-border flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] px-[3px] font-mono text-[10px] font-semibold" style={{ background: lg.bg, color: lg.fg }}>{lg.k}</span>
              {lg.l}
            </span>
          ))}
        </div>

        {stato === 'errore' ? (
          <div className="anim-swapin flex flex-1 flex-col items-center justify-center gap-1 px-[18px] py-12 text-center text-pretty">
            <span className="text-[15px] font-semibold text-[oklch(0.45_0.1_25)] dark:text-neg">Caricamento non riuscito</span>
            <span className="text-[13px] text-muted-foreground">Presenze e assenze del mese non disponibili. Riprova.</span>
            <button type="button" onClick={() => { avviaScheletro(); carica() }} className="mt-3 flex h-11 items-center gap-2 rounded-[12px] border border-line-strong bg-card px-[18px] text-sm font-semibold transition-transform duration-150 active:scale-[0.97]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></svg>
              Riprova
            </button>
          </div>
        ) : stato === 'ok' && !vis.righe.length ? (
          <div className="anim-swapin flex flex-1 flex-col items-center justify-center gap-1 px-[18px] py-12 text-center text-pretty">
            <span className="text-[15px] font-semibold">Nessun dipendente</span>
            <span className="text-[13px] text-muted-foreground">{restaurants.length ? 'Nei locali scelti non c’è personale con presenze da riportare.' : 'Nessun locale assegnato al tuo account.'}</span>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto overscroll-none">
            <div className="grid w-max min-w-full" style={{ gridTemplateColumns: `${Q.nameW} repeat(${nd},minmax(${Q.cellW},1fr)) ${Q.totW}` }}>
              <div className={cn('sticky left-0 top-0 z-[4] flex h-11 items-center border-b border-r border-border bg-[var(--r-h)] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground', Q.nx)}>Dipendente</div>
              {giorni.map(d => {
                const w = dow(d), td = d === oggi, we = w === 0 || w === 6
                return (
                  <div key={d} className="sticky top-0 z-[3] flex h-11 flex-col items-center justify-center border-b border-l border-b-border border-l-[var(--r-l1)]"
                    style={{ background: td ? 'var(--r-td)' : we ? 'var(--r-we)' : 'var(--r-h)' }}>
                    <span className="text-[10px] font-medium" style={{ color: td ? 'var(--r-tdw)' : 'var(--muted-foreground)' }}>{WD[w]}</span>
                    <span className="font-mono text-xs font-semibold" style={{ color: td ? 'var(--r-tdn)' : 'var(--foreground)' }}>{Number(d.slice(8))}</span>
                  </div>
                )
              })}
              <div className={cn('sticky right-0 top-0 z-[4] box-border flex h-11 items-center border-b border-border', Q.tp)} style={{ background: fondo }}>
                <div className="flex h-8 flex-1 items-center justify-end rounded-t-[8px] bg-[var(--r-h)] px-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground shadow-[0_0_0_1px_var(--border)]">Totale</div>
              </div>

              {segnaposto ? Array.from({ length: 8 }, (_, i) => (
                <Segnaposto key={i} nd={nd} nx={Q.nx} tp={Q.tp} fondo={fondo} />
              )) : vis.righe.map(r => (
                <RigaDip key={r.e.id}>
                  <div className={cn('sticky left-0 z-[2] flex h-12 min-w-0 flex-col justify-center border-b border-r border-b-[var(--r-l1)] border-r-border bg-card', Q.nx)}>
                    <span className="truncate whitespace-nowrap text-[13.5px] font-medium">{r.nome}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{r.rep}</span>
                  </div>
                  {r.gs.map((g, i) => {
                    const d = giorni[i], w = dow(d)
                    const col = d === oggi ? 'var(--r-ctd)' : (w === 0 || w === 6) ? 'var(--r-cwe)' : 'transparent'
                    const c = cella(g, P)
                    const fresca = ultimo === `${d}|${r.e.id}`
                    const contenuto = (
                      <span className="box-border flex h-6 min-w-7 items-center justify-center rounded-[5px] px-1 font-mono"
                        style={{ background: c.bg, color: c.fg, fontSize: c.fs, fontWeight: c.fw, animation: fresca ? SWAPIN : undefined }}
                        title={g?.tipo === 'lavoro' && g.aperta ? 'Turno in corso' : undefined}>{c.v}</span>
                    )
                    return puoModificare ? (
                      <button key={d} type="button" onClick={() => apriCella(r.e, d, g)} aria-label={`${r.e.full_name}, ${Number(d.slice(8))}`}
                        className="rep-cella flex h-12 cursor-pointer items-center justify-center border-b border-l border-[var(--r-l1)] transition-transform active:scale-[0.94]" style={{ background: col }}>
                        {contenuto}
                      </button>
                    ) : (
                      <div key={d} className="flex h-12 items-center justify-center border-b border-l border-[var(--r-l1)]" style={{ background: col }}>{contenuto}</div>
                    )
                  })}
                  <div className={cn('sticky right-0 z-[2] box-border flex h-12', Q.tp)} style={{ background: fondo }}>
                    <div className="flex flex-1 flex-col items-end justify-center border-b border-[var(--r-l3)] bg-[var(--r-tot)] px-2.5 shadow-[-1px_0_0_var(--border),1px_0_0_var(--border)]">
                      <span className="font-mono text-sm font-semibold">{r.tot}</span>
                      <span className="whitespace-nowrap font-mono text-[10.5px] text-muted-foreground">{r.ass}</span>
                    </div>
                  </div>
                </RigaDip>
              ))}

              <div className={cn('sticky bottom-0 left-0 z-[4] flex h-11 items-center border-r border-t border-r-border border-t-[var(--r-l2)] bg-[var(--r-h)] text-[13px] font-semibold', Q.nx)}>{P ? 'Presenti' : 'Totale giorno'}</div>
              {vis.colT.map((t, i) => (
                <div key={i} className="sticky bottom-0 z-[3] flex h-11 items-center justify-center border-l border-t border-l-[var(--r-l1)] border-t-[var(--r-l2)] bg-[var(--r-h)] font-mono text-[11px] font-semibold text-[var(--r-leg)]">{segnaposto ? '' : t}</div>
              ))}
              <div className={cn('sticky bottom-0 right-0 z-[4] box-border flex h-11 items-center border-t border-[var(--r-l2)]', Q.tp)} style={{ background: fondo }}>
                <div className="flex h-8 flex-1 items-center justify-end rounded-b-[8px] bg-[oklch(0.2_0.01_250)] px-2.5 font-mono text-sm font-bold text-white dark:bg-primary dark:text-primary-foreground">{segnaposto ? '' : vis.grand}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {ed && <FoglioGiorno
        ed={ed} esce={edEsce} tel={tel} k={k} kEsce={kEsce} salva={salva}
        nome={dati.dip.find(x => x.id === ed.empId)?.full_name ?? ''}
        locale={nomeLoc[dati.dip.find(x => x.id === ed.empId)?.restaurant_id ?? ''] ?? ''}
        onCambia={f => setEd(p => (p ? f(p) : p))}
        onApriK={apriK} onChiudiK={chiudiK} onChiudi={() => { if (!salva) chiudiEd() }} onSalva={salvaGiorno}
      />}

      {sk !== 'no' && <ScheletroForma esce={sk === 'out'} />}
    </div>
  )
}

// Una riga della griglia: i figli stanno direttamente nella griglia del foglio.
function RigaDip({ children }: { children: React.ReactNode }) { return <>{children}</> }

function Segnaposto({ nd, nx, tp, fondo }: { nd: number; nx: string; tp: string; fondo: string }) {
  return <>
    <div className={cn('sticky left-0 z-[2] flex h-12 flex-col justify-center border-b border-r border-b-[var(--r-l1)] border-r-border bg-card', nx)}>
      <span className="text-[13.5px] font-medium">Nome Cognome</span>
      <span className="text-[11px] text-muted-foreground">Reparto</span>
    </div>
    {Array.from({ length: nd }, (_, i) => <div key={i} className="h-12 border-b border-l border-[var(--r-l1)]" />)}
    <div className={cn('sticky right-0 z-[2] box-border flex h-12', tp)} style={{ background: fondo }}>
      <div className="flex flex-1 flex-col items-end justify-center border-b border-[var(--r-l3)] bg-[var(--r-tot)] px-2.5"><span className="font-mono text-sm font-semibold">0 gg</span></div>
    </div>
  </>
}

/** Contenuto e colori di una cella, come nel prototipo. */
function cella(g: Giorno, P: boolean): { v: string; bg: string; fg: string; fs: string; fw: number } {
  if (!g) return { v: '', bg: 'transparent', fg: 'var(--muted-foreground)', fs: '11px', fw: 500 }
  if (g.tipo === 'assenza') return { v: g.codice, bg: `var(--r-${g.codice})`, fg: `var(--r-${g.codice}f)`, fs: '11px', fw: 600 }
  if (P) return { v: g.minuti > MINUTI_DOPPIO_TURNO ? 'PP' : 'P', bg: 'var(--r-P)', fg: 'var(--r-Pf)', fs: g.minuti > MINUTI_DOPPIO_TURNO ? '10px' : '11px', fw: 600 }
  // Turno ancora aperto e nessuna fascia chiusa: le ore non si possono ancora contare.
  const v = g.aperta && g.minuti === 0 ? '…' : oreBrevi(g.minuti)
  return { v, bg: g.fasce.length > 1 ? 'var(--r-split)' : 'transparent', fg: 'var(--foreground)', fs: '12px', fw: 500 }
}

// ── Foglio di modifica del giorno ─────────────────────────────────────
function FoglioGiorno({ ed, esce, tel, k, kEsce, salva, nome, locale, onCambia, onApriK, onChiudiK, onChiudi, onSalva }: {
  ed: Editor; esce: boolean; tel: boolean; k: string | null; kEsce: boolean; salva: boolean; nome: string; locale: string
  onCambia: (f: (e: Editor) => Editor) => void; onApriK: (k: string) => void; onChiudiK: () => void; onChiudi: () => void; onSalva: () => void
}) {
  const dd = new Date(ed.data + 'T00:00:00Z')
  const desc = `${capit(WDL[dd.getUTCDay()])} ${dd.getUTCDate()} ${MESI[dd.getUTCMonth()]}${locale ? ' · ' + locale : ''}`
  const fmins = ed.fasce.reduce((s, f) => { if (!f.b) return s; let x = toM(f.b) - toM(f.a); if (x <= 0) x += 1440; return s + x }, 0)
  const notte = ed.fasce.some(f => f.b && toM(f.b) <= toM(f.a))
  const sum = ed.modo === 'work'
    ? `Totale ${Math.floor(fmins / 60)}h ${String(fmins % 60).padStart(2, '0')}m${notte ? ' · uscita dopo mezzanotte, resta su questo giorno' : ''}`
    : ed.modo === 'abs' ? `${NOME_ASSENZA[ed.ty]} per tutto il giorno` : 'Il giorno resterà senza presenze né assenze'
  const bordo = (key: string) => (k === key ? '1.5px solid var(--r-teal)' : '1px solid var(--input)')
  const rv = k ? (ed.fasce[+k[0]]?.[k[1] as 'a' | 'b'] || (k[1] === 'a' ? '11:00' : '23:00')) : '11:00'
  const ANIM = esce ? 'swapout 320ms cubic-bezier(0.4,0,1,1) both' : SWAPIN

  return createPortal(
    <div onClick={onChiudi} className={cn('rep fixed inset-0 z-[70] box-border flex justify-center', tel ? 'items-end pt-[72px]' : 'items-start px-4 pt-[150px]')}
      style={{ background: esce ? 'rgba(15,20,30,0)' : 'rgba(15,20,30,.28)', transition: 'background 320ms' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${nome}, ${desc}`}
        className={cn('box-border flex max-h-full flex-col overflow-y-auto overscroll-contain border border-border bg-card text-foreground shadow-[0_20px_60px_rgba(20,30,50,.18)]',
          tel ? 'w-full rounded-t-[20px] pb-[calc(env(safe-area-inset-bottom)+20px)]' : 'w-[560px] max-w-full rounded-[14px]')}
        style={{ animation: ANIM }}>
        <div className="flex items-center gap-3 border-b border-border px-[22px] py-[18px]">
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-xl font-semibold">{nome}</span>
            <span className="text-sm text-muted-foreground">{desc}</span>
          </div>
          <button type="button" onClick={onChiudi} aria-label="Chiudi" className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-transform active:scale-[0.96]"><IconaX /></button>
        </div>
        <div className="flex flex-col gap-4 px-[22px] py-[18px]">
          <div className="flex gap-[2px] rounded-[9px] bg-[var(--r-seg)] p-[3px]">
            {([['work', 'Lavoro'], ['abs', 'Assenza'], ['none', 'Vuoto']] as const).map(([key, l]) => (
              <button key={key} type="button" onClick={() => { onChiudiK(); onCambia(e => ({ ...e, modo: key })) }}
                className={cn('flex h-10 flex-1 items-center justify-center rounded-[7px] text-sm font-medium transition-[background-color] duration-200', ed.modo === key ? 'bg-[var(--r-thumb)] text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-muted-foreground')}>
                {l}
              </button>
            ))}
          </div>

          {ed.modo === 'work' && (
            <div className="flex flex-col gap-2.5">
              {ed.fasce.map((f, i) => {
                const uno = ed.fasce.length <= 1
                return (
                  <div key={i} className="grid grid-cols-[1fr_1fr_44px] items-end gap-2.5">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[13px] font-medium">{i ? `Ingresso ${i + 1}ª fascia` : 'Ingresso'}</span>
                      <button type="button" data-kp="1" onClick={() => onApriK(i + 'a')} className="box-border flex h-14 items-center justify-center rounded-[6px] font-mono text-[22px] font-medium" style={{ border: bordo(i + 'a') }}>{f.a}</button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[13px] font-medium">Uscita</span>
                      <button type="button" data-kp="1" onClick={() => onApriK(i + 'b')} className={cn('box-border flex h-14 items-center justify-center rounded-[6px] font-mono text-[22px] font-medium', !f.b && 'text-muted-foreground')} style={{ border: bordo(i + 'b') }}>{f.b || '--:--'}</button>
                    </div>
                    <button type="button" disabled={uno} aria-label="Togli fascia"
                      onClick={() => { onChiudiK(); onCambia(e => ({ ...e, fasce: e.fasce.filter((_, j) => j !== i) })) }}
                      className={cn('flex h-14 w-11 items-center justify-center rounded-[6px] text-muted-foreground', uno ? 'cursor-default opacity-25' : 'cursor-pointer')}>
                      <IconaX s={18} />
                    </button>
                  </div>
                )
              })}
              {k && (
                <div data-kp="1" className="flex justify-center">
                  <div key={k} style={{ animation: kEsce ? 'swapout 320ms cubic-bezier(0.4,0,1,1) both' : SWAPIN }}>
                    <Rotella value={rv}
                      onChange={val => onCambia(e => ({ ...e, fasce: e.fasce.map((x, j) => (j === +k[0] ? { ...x, [k[1]]: val } : x)) }))}
                      onDone={onChiudiK} />
                  </div>
                </div>
              )}
              <button type="button" onClick={() => onCambia(e => ({ ...e, fasce: [...e.fasce, { a: '19:00', b: '23:00' }] }))}
                className="flex h-10 items-center gap-1.5 self-start rounded-[8px] border border-dashed border-[var(--r-dash)] px-3 text-[13px] font-medium transition-transform active:scale-[0.97]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M5 12h14" /><path d="M12 5v14" /></svg>
                Aggiungi fascia
              </button>
            </div>
          )}

          {ed.modo === 'abs' && (
            <div className={cn('grid gap-1.5', tel ? 'grid-cols-2' : 'grid-cols-4')}>
              {CODICI_ASSENZA.map(c => {
                const a = ed.ty === c
                return (
                  <button key={c} type="button" onClick={() => onCambia(e => ({ ...e, ty: c }))}
                    className="flex h-12 items-center justify-center rounded-[8px] border text-[13px] font-medium transition-[background-color,transform] duration-200 active:scale-[0.97]"
                    style={{ background: a ? `var(--r-${c})` : 'var(--card)', color: a ? `var(--r-${c}f)` : 'var(--foreground)', borderColor: a ? `var(--r-${c}b)` : 'var(--r-l2)' }}>
                    {NOME_ASSENZA[c]}
                  </button>
                )
              })}
            </div>
          )}

          <span className="text-sm font-medium">{sum}</span>
          <div className="grid grid-cols-[1fr_2fr] gap-2.5">
            <button type="button" onClick={onChiudi} disabled={salva} className="flex h-[52px] items-center justify-center rounded-[6px] border border-line-strong text-[15px] font-medium transition-transform active:scale-[0.98]">Annulla</button>
            <button type="button" onClick={onSalva} disabled={salva}
              className={cn('flex h-[52px] items-center justify-center rounded-[6px] bg-primary text-[15px] font-semibold text-primary-foreground transition-transform active:scale-[0.98]', salva && 'opacity-60')}>
              {salva ? 'Salvataggio…' : 'Salva giorno'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
