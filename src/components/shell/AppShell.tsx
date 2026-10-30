'use client'
import { forwardRef, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import QRCodeLib from 'qrcode'
import {
  House, CalendarBlank, Wallet, ShoppingCart, DotsThreeOutline, ListChecks, Megaphone,
  Table, List, Receipt, ListBullets, BookOpenText, ChatsCircle,
} from '@phosphor-icons/react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { LogoAnimato } from '@/components/shared/LogoAnimato'
import type { AppNotification } from '@/types'
import { NAVIGAZIONE, trovaPosizione, type Area, type IconaChiave, type Ruolo, type Sezione } from './navigazione'
import { useContatori } from './useContatori'

// Guscio comune del design Acciaio: intestazione (titolo e sottotitolo,
// assistente AI per il manager, campanella con batacchio, profilo con QR
// del locale ed Esci), segmenti di sezione in alto e barra in basso.
// Lo scroll è solo interno al contenuto: la pagina non scorre.

const TZ = 'Europe/Rome'

const ICONE: Record<IconaChiave, React.ComponentType<{ size?: number; weight?: 'regular' | 'fill' | 'bold' }>> = {
  home: House, turni: CalendarBlank, cassa: Wallet, acquisti: ShoppingCart, altro: DotsThreeOutline,
  ods: ListChecks, bacheca: Megaphone, report: Table, menu: List, chiusura: Receipt, lista: ListBullets,
  prenotazioni: BookOpenText, messaggi: ChatsCircle,
}

export interface RistoranteQr { id: string; name: string; qr_secret: string | null }

interface AppShellProps {
  ruolo: Ruolo
  nome: string
  /** Riga sotto il nome nel menu profilo, es. "Manager · 4 locali". */
  descrizione: string
  /** Per i ruoli con intestazione del locale: nome del locale e "Ruolo · Reparto". */
  locale?: { nome: string; sotto: string }
  ristoranti?: RistoranteQr[]
  isPlatformOwner?: boolean
  /** Striscia sopra il contenuto (es. banner demo, notifiche push). */
  banner?: React.ReactNode
  children: React.ReactNode
}

function Badge({ n, invertito }: { n: number; invertito?: boolean }) {
  if (!n) return null
  return (
    <span className={cn(
      'flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] font-mono text-[10.5px] font-semibold',
      invertito ? 'bg-primary-foreground text-primary' : 'bg-[oklch(0.55_0.15_25)] text-white'
    )}>
      {n > 99 ? '99+' : n}
    </span>
  )
}

const ICONA_CAMPANELLA = (
  <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9zM10 20.5a2.2 2.2 0 0 0 4 0" />
)

// Chiude un pannello flottante al tocco fuori (pointerdown in cattura).
function useFuori(aperto: boolean, chiudi: () => void, refs: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!aperto) return
    const h = (e: PointerEvent) => {
      const t = e.target as Node
      if (refs.some(r => r.current?.contains(t))) return
      chiudi()
    }
    const id = setTimeout(() => window.addEventListener('pointerdown', h, true), 0)
    return () => { clearTimeout(id); window.removeEventListener('pointerdown', h, true) }
  }, [aperto, chiudi, refs])
}

function Pannello({ uscita, className, children, style }: { uscita: boolean; className?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      className={cn('rounded-[16px] border border-border bg-card shadow-[0_20px_60px_rgba(20,30,50,.18)]', uscita ? 'anim-swapout' : 'anim-swapin', className)}
      style={style}
    >
      {children}
    </div>
  )
}

function Notifiche({ onClose, uscita }: { onClose: () => void; uscita: boolean }) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [items, setItems] = useState<AppNotification[] | null>(null)
  useEffect(() => {
    supabase.from('notifications').select('id, user_id, title, message, link, read_at, created_at')
      .order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setItems((data ?? []) as AppNotification[]))
  }, [supabase])
  const nonLette = (items ?? []).filter(n => !n.read_at).length

  async function apri(n: AppNotification) {
    onClose()
    if (!n.read_at) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
    if (n.link) router.push(n.link)
  }
  async function tutteLette() {
    const now = new Date().toISOString()
    await supabase.from('notifications').update({ read_at: now }).is('read_at', null)
    setItems(prev => (prev ?? []).map(n => (n.read_at ? n : { ...n, read_at: now })))
  }

  return (
    <Pannello uscita={uscita} className="flex max-h-[min(600px,70dvh)] flex-col overflow-hidden">
      <div className="flex flex-none items-baseline gap-2.5 border-b border-border px-[18px] pb-3 pt-4">
        <span className="text-[17px] font-semibold">Notifiche</span>
        <span className="flex-1 text-[13px] text-muted-foreground">{items === null ? '' : nonLette ? `${nonLette} da leggere` : 'Tutto letto'}</span>
        {nonLette > 0 && (
          <button type="button" onClick={tutteLette} className="text-[13px] font-medium text-[oklch(0.5_0.11_180)] active:scale-[0.97]">Segna tutte lette</button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {items === null ? (
          <div className="space-y-2 p-3">{[0, 1, 2].map(i => <div key={i} className="skeleton-shimmer h-10 rounded-md" />)}</div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nessuna notifica</p>
        ) : items.map(n => (
          <button
            key={n.id}
            type="button"
            onClick={() => apri(n)}
            className={cn('flex w-full items-start gap-3 rounded-[10px] p-3 text-left transition-colors hover:bg-background active:scale-[0.98]', !n.read_at && 'bg-[oklch(0.97_0.015_180)] dark:bg-[oklch(0.22_0.02_180)]')}
          >
            <span className={cn('mt-[5px] h-2 w-2 flex-none rounded-full bg-[oklch(0.6_0.11_250)]', n.read_at && 'opacity-0')} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn('text-sm', n.read_at ? 'font-normal' : 'font-semibold')}>{n.title}</span>
              <span className="line-clamp-2 text-[13px] text-muted-foreground">{n.message}</span>
            </span>
            <span className="flex-none font-mono text-[11px] font-medium text-[oklch(0.55_0.01_250)]">
              {formatInTimeZone(new Date(n.created_at), TZ, 'dd/MM HH:mm', { locale: it })}
            </span>
          </button>
        ))}
      </div>
    </Pannello>
  )
}

function Profilo({ nome, descrizione, ristoranti, uscita, voci, onEsci, onVoce }: {
  nome: string; descrizione: string; ristoranti: RistoranteQr[]; uscita: boolean
  voci: Sezione[]; onEsci: () => void; onVoce: () => void
}) {
  const conQr = ristoranti.filter(r => r.qr_secret)
  const [sel, setSel] = useState(0)
  const [qr, setQr] = useState<string | null>(null)
  const { theme, setTheme } = useTheme()
  const scelto = conQr[Math.min(sel, conQr.length - 1)]

  useEffect(() => {
    if (!scelto?.qr_secret) return
    QRCodeLib.toDataURL(scelto.qr_secret, { width: 368, margin: 1, color: { dark: '#14161a', light: '#ffffff' } }).then(setQr)
  }, [scelto?.qr_secret])

  function scarica() {
    if (!qr || !scelto) return
    const a = document.createElement('a')
    a.href = qr
    a.download = `QR-${scelto.name.replace(/\s+/g, '-')}.png`
    a.click()
  }

  return (
    <Pannello uscita={uscita} className="flex max-h-[min(680px,78dvh)] flex-col overflow-y-auto overscroll-contain">
      <div className="flex flex-col gap-0.5 border-b border-border px-[18px] py-4">
        <span className="text-base font-semibold">{nome}</span>
        <span className="text-[13px] text-muted-foreground">{descrizione}</span>
      </div>
      {conQr.length > 0 && (
        <div className="flex flex-col gap-2.5 border-b border-border px-[18px] py-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">QR timbratura del locale</span>
          {conQr.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {conQr.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSel(i)}
                  className={cn('flex h-9 items-center rounded-full border px-3 text-[13px] font-medium transition-colors active:scale-[0.97]',
                    i === sel ? 'border-primary bg-primary text-primary-foreground' : 'border-line-strong bg-card')}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex h-[184px] w-[184px] items-center justify-center self-center rounded-[12px] border border-border bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR generato in locale come data URL */}
            {qr ? <img src={qr} alt={`QR ${scelto?.name ?? ''}`} className="h-full w-full" /> : <div className="skeleton-shimmer h-full w-full rounded" />}
          </div>
          <span className="self-center text-xs text-muted-foreground">Da mostrare a chi timbra senza GPS</span>
          <button type="button" onClick={scarica} className="flex h-11 items-center justify-center gap-2 rounded-[8px] border border-line-strong text-sm font-medium active:scale-[0.98]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></svg>
            Scarica il QR da stampare
          </button>
        </div>
      )}
      {voci.map(v => (
        <Link key={v.key} href={v.href} onClick={onVoce} className="flex h-[52px] flex-none items-center gap-2.5 border-b border-border px-[18px] text-[15px] font-medium hover:bg-background active:scale-[0.98]">
          <span className="flex-1">{v.titolo}</span>
          {v.sottotitolo && <span className="text-[13px] font-normal text-muted-foreground">{v.sottotitolo}</span>}
        </Link>
      ))}
      <div className="flex h-[52px] flex-none items-center gap-2.5 border-b border-border px-[18px] text-[15px] font-medium">
        <span className="flex-1">Tema</span>
        <div className="flex gap-0.5 rounded-[10px] bg-secondary p-0.5">
          {([['light', 'Chiaro'], ['dark', 'Scuro'], ['system', 'Auto']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTheme(k)} className={cn('h-8 rounded-[8px] px-2.5 text-[13px]', theme === k ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground')}>{l}</button>
          ))}
        </div>
      </div>
      <button type="button" onClick={onEsci} className="flex h-[52px] flex-none items-center gap-2.5 px-[18px] text-left text-[15px] font-medium text-neg hover:bg-background active:scale-[0.98]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" /><path d="M14 8l4 4-4 4" /><path d="M18 12H9" /></svg>
        Esci
      </button>
    </Pannello>
  )
}

type Overlay = 'campanella' | 'profilo' | 'menu' | null

export function AppShell({ ruolo, nome, descrizione, locale, ristoranti = [], isPlatformOwner = false, banner, children }: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const cfg = NAVIGAZIONE[ruolo]
  const { area, sezione } = trovaPosizione(cfg, pathname)
  const contatori = useContatori(ruolo, isPlatformOwner)
  const [ov, setOv] = useState<Overlay>(null)
  const [uscita, setUscita] = useState(false)
  const [nonLette, setNonLette] = useState(0)
  const [campanellaVista, setCampanellaVista] = useState(false)
  const idCanale = useId()

  const refHeader = useRef<HTMLDivElement>(null)
  const refPannello = useRef<HTMLDivElement>(null)
  const refDock = useRef<HTMLDivElement>(null)

  const chiudi = useCallback(() => {
    setUscita(true)
    setTimeout(() => { setOv(null); setUscita(false) }, 320)
  }, [])
  const apri = useCallback((k: Overlay) => {
    if (ov === k) return chiudi()
    setUscita(false)
    setOv(k)
    if (k === 'campanella') setCampanellaVista(true)
  }, [ov, chiudi])
  const refsFuori = useMemo(() => [refHeader, refPannello, refDock], [])
  useFuori(ov !== null && !uscita, chiudi, refsFuori)

  // Chiude i pannelli quando si cambia pagina.
  const ultimoPath = useRef(pathname)
  useEffect(() => {
    if (ultimoPath.current === pathname) return
    ultimoPath.current = pathname
    const t = setTimeout(() => { setOv(null); setUscita(false) }, 0)
    return () => clearTimeout(t)
  }, [pathname])

  // Notifiche non lette per il pallino della campanella.
  useEffect(() => {
    const supabase = createClient()
    const f = async () => {
      const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
      setNonLette(count ?? 0)
    }
    f()
    const ch = supabase.channel(`shell_campanella_${idCanale}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, f).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [idCanale])

  async function esci() {
    await createClient().auth.signOut()
    router.push('/login')
  }

  const badgeSezione = (s: Sezione) => (s.badge ? contatori[s.badge] ?? 0 : 0)
  const badgeArea = (a: Area) => a.sezioni.reduce((t, s) => t + badgeSezione(s), 0)

  // Titolo e sottotitolo dell'intestazione.
  const oggi = formatInTimeZone(new Date(), TZ, 'EEEE d MMMM', { locale: it })
  let titolo = sezione?.titolo ?? 'inTurno'
  let sottotitolo = sezione?.sottotitolo ?? ''
  if (cfg.intestazioneLocale && locale) { titolo = locale.nome; sottotitolo = locale.sotto }
  else if (ruolo === 'manager' && area?.key === 'home') {
    titolo = `Ciao, ${nome.split(' ')[0]}`
    sottotitolo = `${oggi.charAt(0).toUpperCase()}${oggi.slice(1)} · ${ristoranti.length} ${ristoranti.length === 1 ? 'locale' : 'locali'}`
  } else if (!sottotitolo && (ruolo === 'cassiere' || ruolo === 'hostess')) {
    sottotitolo = `${oggi.charAt(0).toUpperCase()}${oggi.slice(1)}`
  }

  // Segmenti: le sezioni dell'area corrente (mai per le aree-menu dei ruoli a schede).
  const segmenti = area && area.sezioni.length > 1 && !(cfg.stile === 'schede' && area.menu) ? area.sezioni.filter(s => s.key !== 'account' || isPlatformOwner) : []
  const vociMenu = (cfg.aree.find(a => a.menu)?.sezioni ?? []).filter(s => s.key !== 'account' || isPlatformOwner)
  const vociProfilo: Sezione[] = ruolo === 'capo_servizio' ? [{ key: 'report', label: 'Report', href: '/report', titolo: 'Report', sottotitolo: 'Presenze e ore' }] : []

  const conCampanella = ruolo !== 'consulente_lavoro'

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <div className="h-[env(safe-area-inset-top)] flex-none" />
      <header ref={refHeader} className="relative z-30 flex min-h-[52px] flex-none items-center gap-2 pb-2 pl-5 pr-2.5 pt-1.5">
        <LogoAnimato size={28} className="mr-1 rounded-[6px]" />
        <div key={titolo + sottotitolo} className="anim-swapin flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[22px] font-semibold leading-tight tracking-[-0.01em]">{titolo}</span>
          {sottotitolo && <span className="truncate text-[13px] text-muted-foreground">{sottotitolo}</span>}
        </div>
        <span className="flex-1" />
        {cfg.assistente && (
          <Link href="/hub/assistente" aria-label="Assistente" className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-[oklch(0.45_0.1_180)] active:scale-[0.96] dark:text-[oklch(0.75_0.1_180)]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
          </Link>
        )}
        {conCampanella && (
          <button
            type="button"
            aria-label="Notifiche"
            onClick={() => apri('campanella')}
            className={cn('relative flex h-11 w-11 flex-none items-center justify-center rounded-full active:scale-[0.96]', ov === 'campanella' && 'bg-secondary')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden
              className={cn('origin-[12px_3px]', nonLette > 0 && !campanellaVista && 'anim-campanella')}>
              {ICONA_CAMPANELLA}
            </svg>
            {nonLette > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-background bg-[oklch(0.55_0.15_25)] px-1 font-mono text-[10px] font-semibold text-white">
                {nonLette > 9 ? '9+' : nonLette}
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          aria-label="Profilo"
          onClick={() => apri('profilo')}
          className={cn('flex h-11 w-11 flex-none items-center justify-center rounded-full active:scale-[0.96]', ov === 'profilo' && 'bg-secondary')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
        </button>
      </header>

      {(ov === 'campanella' || ov === 'profilo') && (
        <div ref={refPannello} className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+64px)] z-50 sm:left-auto sm:w-[400px]">
          {ov === 'campanella'
            ? <Notifiche onClose={chiudi} uscita={uscita} />
            : <Profilo nome={nome} descrizione={descrizione} ristoranti={ristoranti} uscita={uscita} voci={vociProfilo} onEsci={esci} onVoce={chiudi} />}
        </div>
      )}

      {segmenti.length > 0 && (
        <nav className="relative z-[29] mx-4 mb-2.5 flex flex-none gap-[3px] overflow-x-auto rounded-[14px] border border-border bg-card p-1 shadow-[0_4px_20px_rgba(20,30,50,.08)] [scrollbar-width:none] sm:mx-auto sm:w-fit sm:min-w-[480px]">
          {segmenti.map(s => {
            const att = s.key === sezione?.key
            const b = badgeSezione(s)
            return (
              <Link
                key={s.key}
                href={s.href}
                className={cn('flex h-10 min-w-0 flex-[1_1_auto] items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-2.5 text-[13px] font-medium transition-colors duration-200 active:scale-[0.97]',
                  att ? 'bg-primary text-primary-foreground' : 'text-foreground')}
              >
                {s.label}
                <Badge n={b} invertito={att} />
              </Link>
            )
          })}
        </nav>
      )}

      {banner}

      <main className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+104px)]">
        {children}
      </main>

      <Dock
        ref={refDock}
        stile={cfg.stile}
        aree={cfg.aree}
        attiva={area?.key ?? null}
        menuAperto={ov === 'menu'}
        uscitaMenu={uscita}
        onMenu={() => apri('menu')}
        badgeArea={badgeArea}
        badgeSezione={badgeSezione}
        vociMenu={vociMenu}
        sezioneAttiva={sezione?.key ?? null}
        nome={nome}
        descrizione={descrizione}
        onEsci={esci}
        onChiudi={chiudi}
      />
    </div>
  )
}


interface DockProps {
  stile: 'pillola' | 'schede'
  aree: Area[]
  attiva: string | null
  menuAperto: boolean
  uscitaMenu: boolean
  onMenu: () => void
  onChiudi: () => void
  badgeArea: (a: Area) => number
  badgeSezione: (s: Sezione) => number
  vociMenu: Sezione[]
  sezioneAttiva: string | null
  nome: string
  descrizione: string
  onEsci: () => void
}

const Dock = forwardRef<HTMLDivElement, DockProps>(function Dock(
  { stile, aree, attiva, menuAperto, uscitaMenu, onMenu, onChiudi, badgeArea, badgeSezione, vociMenu, sezioneAttiva, nome, descrizione, onEsci }, ref
) {
  if (stile === 'pillola') {
    return (
      <div ref={ref} className="pointer-events-none absolute inset-x-0 bottom-0 z-[35] flex justify-center pb-[calc(env(safe-area-inset-bottom)+14px)] pt-3"
        style={{ background: 'linear-gradient(to top, var(--background) 45%, color-mix(in oklch, var(--background) 0%, transparent))' }}>
        <div className="pointer-events-auto relative flex gap-1 rounded-[16px] border border-border bg-card p-1.5 shadow-[0_4px_20px_rgba(20,30,50,.08)]">
          {aree.map(a => {
            const att = a.key === attiva || (a.menu && menuAperto)
            const b = badgeArea(a)
            const cls = cn(
              'relative flex h-[52px] items-center justify-center gap-1.5 rounded-[11px] px-2 text-[13px] font-medium transition-colors duration-200 active:scale-[0.97] md:h-14 md:w-[112px] md:text-[15px]',
              aree.length > 3 ? 'w-[66px]' : 'min-w-[104px] px-4',
              att ? 'bg-primary text-primary-foreground' : 'text-foreground'
            )
            const badge = b > 0 && !att && (
              <span className="absolute right-1 top-1 md:static"><Badge n={b} /></span>
            )
            return a.menu ? (
              <button key={a.key} type="button" onClick={onMenu} className={cls}>{a.label}{badge}</button>
            ) : (
              <Link key={a.key} href={a.href} className={cls}>{a.label}{badge}</Link>
            )
          })}
          {menuAperto && (
            <div className={cn('absolute bottom-[calc(100%+10px)] right-0 grid w-[min(360px,calc(100vw-24px))] grid-cols-2 gap-1.5 rounded-[16px] border border-border bg-card p-2 shadow-[0_14px_40px_rgba(20,30,50,.16)]', uscitaMenu ? 'anim-swapout' : 'anim-swapin')}>
              {vociMenu.map(s => (
                <Link
                  key={s.key}
                  href={s.href}
                  onClick={onChiudi}
                  className={cn('flex min-h-[72px] flex-col justify-center gap-[3px] rounded-[11px] px-3.5 py-3 transition-colors hover:bg-background active:scale-[0.97]',
                    s.key === sezioneAttiva && 'bg-[oklch(0.96_0.02_180)] dark:bg-[oklch(0.24_0.03_180)]')}
                >
                  <span className="flex items-center gap-1.5 text-[15px] font-semibold">{s.label}<Badge n={badgeSezione(s)} /></span>
                  {s.sottotitolo && <span className="text-[12.5px] text-muted-foreground">{s.sottotitolo}</span>}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Barra a schede (dipendente, capo servizio, direttore): icona Phosphor
  // e etichetta, voce attiva nel colore dell'area.
  return (
    <div ref={ref} className="absolute inset-x-0 bottom-0 z-[35]">
      {menuAperto && (
        <>
          <div className={cn('fixed inset-0 z-[-1] bg-[oklch(0.2_0.01_250/0.38)] transition-opacity', uscitaMenu ? 'opacity-0' : 'opacity-100')} onClick={onChiudi} />
          <div className={cn('mx-auto mb-0 flex max-w-xl flex-col gap-3 rounded-t-[18px] border border-b-0 border-border bg-card px-4 pb-4 pt-2 shadow-[0_-8px_28px_rgba(20,30,50,.10)]', uscitaMenu ? 'anim-swapout' : 'anim-swapin')}>
            <div className="mx-auto h-1 w-9 rounded-full bg-line-strong" />
            <div className="flex items-center justify-between">
              <span className="text-[17px] font-semibold">Menu</span>
              <button type="button" onClick={onChiudi} aria-label="Chiudi" className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="overflow-hidden rounded-[12px] border border-border">
              {vociMenu.map(s => (
                <Link key={s.key} href={s.href} onClick={onChiudi} className="flex h-[52px] items-center gap-3 border-b border-border px-4 text-[15px] last:border-b-0 hover:bg-background active:scale-[0.99]">
                  <span className="flex-1">{s.label}</span>
                  {badgeSezione(s) > 0 && <span className="font-mono text-[12px] text-muted-foreground">{badgeSezione(s)} nuovi</span>}
                </Link>
              ))}
            </div>
            <div className="flex items-center gap-3 px-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">{nome}</span>
                <span className="truncate text-xs text-muted-foreground">{descrizione}</span>
              </div>
              <button type="button" onClick={onEsci} className="h-10 rounded-[10px] bg-neg-tint px-4 text-sm font-semibold text-neg active:scale-[0.97]">Esci</button>
            </div>
          </div>
        </>
      )}
      <nav className="flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" style={{ ['--tono' as string]: 'var(--turni)' }}>
        {aree.map(a => {
          const att = a.key === attiva || (a.menu && menuAperto)
          const Icona = ICONE[a.icona]
          const b = badgeArea(a)
          const contenuto = (
            <>
              <span className="relative">
                <Icona size={24} weight={att ? 'fill' : 'regular'} />
                {b > 0 && <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-[oklch(0.55_0.15_25)] ring-2 ring-card" />}
              </span>
              <span className={cn('text-[11px]', att ? 'font-semibold' : 'font-medium')}>{a.label}</span>
            </>
          )
          const cls = cn('flex h-[60px] flex-1 flex-col items-center justify-center gap-1 transition-colors active:scale-[0.97]', att ? 'text-[var(--tono)]' : 'text-muted-foreground')
          return a.menu ? (
            <button key={a.key} type="button" onClick={onMenu} className={cls}>{contenuto}</button>
          ) : (
            <Link key={a.key} href={a.href} className={cls}>{contenuto}</Link>
          )
        })}
      </nav>
    </div>
  )
})
