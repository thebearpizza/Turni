'use client'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { chiudiArchivio } from '@/app/actions/archivio'
import { useTelefono } from '@/hooks/useTelefono'
import { PushNotificationPrompt } from '@/components/shared/PushNotificationPrompt'
import { useIntestazioneDinamica, registraCentroIntestazione } from './intestazioneDinamica'
import { NAVIGAZIONE, sezioniVisibili, trovaPosizione, type Area, type Ruolo, type Sezione } from './navigazione'
import { useContatori } from './useContatori'
import { ricordaSezione, useMemoriaSezioni } from './memoriaSezioni'
import { nomeBreve } from './nomeBreve'
import { Notifiche } from './Notifiche'
import { PannelloProfilo, TendinaProfilo, type RistoranteQr } from './Profilo'
import { Assistente } from './Assistente'
import { Accento, BarraCassaTablet, BarraSchede, ContatoreBadge, DockPillola } from './Dock'
import { StrisciaOffline } from './StrisciaOffline'
import { IconaCampanella, IconaProfilo, IconaScintilla } from './icone'

export type { RistoranteQr } from './Profilo'

// Guscio comune del design Acciaio (Manager/Direttore Smartphone e Tablet,
// Dipendente v2, Capo Servizio, Chiusura Tablet v2): intestazione con
// titolo e sottotitolo, assistente AI, campanella col batacchio e profilo;
// segmenti di sezione (sotto l'intestazione sul telefono, al centro di
// essa sul tablet); dock o barra a schede in basso. La pagina non scorre:
// lo scroll è dentro il contenuto (e, nelle pagine ridisegnate, dentro i
// loro pannelli). A ogni cambio di sezione il contenuto entra con swapin
// sotto lo scheletro a forma di pagina (Splash.dc.html, 3c).

const TZ = 'Europe/Rome'
const maiuscola = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function settimanaCorrente(): string {
  const oggi = new Date(formatInTimeZone(new Date(), TZ, "yyyy-MM-dd'T'12:00:00"))
  const lun = new Date(oggi); lun.setDate(oggi.getDate() - ((oggi.getDay() + 6) % 7))
  const dom = new Date(lun); dom.setDate(lun.getDate() + 6)
  const mese = (d: Date) => formatInTimeZone(d, TZ, 'MMMM', { locale: it })
  return lun.getMonth() === dom.getMonth()
    ? `Settimana ${lun.getDate()}–${dom.getDate()} ${mese(dom)}`
    : `Settimana ${lun.getDate()} ${mese(lun)} – ${dom.getDate()} ${mese(dom)}`
}

function riempi(s: string, locale: string | undefined): string {
  const ora = new Date()
  return s
    .replace('{locale}', locale ?? 'locale')
    .replace('{settimana}', settimanaCorrente())
    .replace('{meseSolo}', maiuscola(formatInTimeZone(ora, TZ, 'MMMM', { locale: it })))
    .replace('{mese}', maiuscola(formatInTimeZone(ora, TZ, 'MMMM yyyy', { locale: it })))
    .replace('{oggi}', maiuscola(formatInTimeZone(ora, TZ, 'EEEE d MMMM', { locale: it })))
}

interface AppShellProps {
  ruolo: Ruolo
  nome: string
  /** Riga sotto il nome nel profilo, es. "Manager · 4 locali". */
  descrizione: string
  /** Nome del locale e "Ruolo · Reparto" (intestazione di capo servizio e dipendente). */
  locale?: { nome: string; sotto: string }
  ristoranti?: RistoranteQr[]
  isPlatformOwner?: boolean
  /** Locale nascosto aperto in archivio (solo manager). */
  archivio?: { id: string; nome: string }
  /** Striscia sopra il contenuto (es. banner della demo). */
  banner?: React.ReactNode
  children: React.ReactNode
}

type Overlay = 'campanella' | 'profilo' | null

// Chiude un pannello al tocco fuori (pointerdown in cattura) e, come nei
// prototipi, quel tocco non attiva ciò che sta sotto: serve solo a chiudere.
function useFuori(aperto: boolean, chiudi: () => void, refs: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!aperto) return
    let blocca = false
    let t: ReturnType<typeof setTimeout> | undefined
    const giu = (e: PointerEvent) => {
      const el = e.target as Element
      if (refs.some(r => r.current?.contains(el))) return
      // Dialoghi aperti dal pannello (es. collegamento Telegram) vivono in
      // un portale: un tocco lì non è "fuori".
      if (el.closest?.('[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper]')) return
      chiudi()
      blocca = true
      clearTimeout(t)
      t = setTimeout(() => { blocca = false }, 500)
    }
    const clic = (e: MouseEvent) => { if (blocca) { blocca = false; e.stopPropagation(); e.preventDefault() } }
    const id = setTimeout(() => {
      window.addEventListener('pointerdown', giu, true)
      window.addEventListener('click', clic, true)
    }, 0)
    return () => {
      clearTimeout(id); clearTimeout(t)
      window.removeEventListener('pointerdown', giu, true)
      // Il click che segue il pointerdown di chiusura arriva dopo lo
      // smontaggio dell'effetto: resta in ascolto ancora un attimo.
      setTimeout(() => window.removeEventListener('click', clic, true), 500)
    }
  }, [aperto, chiudi, refs])
}

export function AppShell({ ruolo, nome, descrizione, locale, ristoranti = [], isPlatformOwner = false, archivio, banner, children }: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const telefono = useTelefono()
  const cfg = NAVIGAZIONE[ruolo]
  const { area, sezione } = trovaPosizione(cfg, pathname)
  const idLocaliManager = useMemo(() => (ruolo === 'manager' ? ristoranti.map(r => r.id) : null), [ruolo, ristoranti])
  const contatori = useContatori(ruolo, isPlatformOwner, idLocaliManager)
  const memoria = useMemoriaSezioni()
  const dinamica = useIntestazioneDinamica()

  const [ov, setOv] = useState<Overlay>(null)
  const [uscita, setUscita] = useState(false)
  const [ai, setAi] = useState<'chiuso' | 'aperto' | 'uscita'>('chiuso')
  const [nonLette, setNonLette] = useState(0)
  const [campanellaVista, setCampanellaVista] = useState(false)
  const idCanale = useId()

  const refHeader = useRef<HTMLElement>(null)
  const refPannello = useRef<HTMLDivElement>(null)
  const timerOv = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const chiudi = useCallback(() => {
    setUscita(true)
    clearTimeout(timerOv.current)
    timerOv.current = setTimeout(() => { setOv(null); setUscita(false) }, 320)
  }, [])
  const apri = useCallback((k: Exclude<Overlay, null>) => {
    if (ov === k && !uscita) return chiudi()
    clearTimeout(timerOv.current)
    setUscita(false)
    setOv(k)
    if (k === 'campanella') setCampanellaVista(true)
  }, [ov, uscita, chiudi])
  const refsFuori = useMemo(() => [refHeader, refPannello], [])
  useFuori(ov !== null && !uscita, chiudi, refsFuori)

  // Cambio pagina: si chiudono i pannelli. Niente scheletro del guscio:
  // copriva la dock e ingoiava i tocchi per un secondo a ogni cambio di
  // scheda, sommandosi al caricamento della rotta e a quello della pagina.
  // Stato derivato durante il render invece di un setState in un effect.
  const [ultimoPath, setUltimoPath] = useState(pathname)
  const [segPremuto, setSegPremuto] = useState<string | null>(null)
  if (ultimoPath !== pathname) {
    setUltimoPath(pathname)
    setSegPremuto(null)
    setOv(null)
    setUscita(false)
  }
  useEffect(() => {
    if (area && sezione && !area.sempreDallaPrima && !sezione.nascosta) ricordaSezione(area.key, sezione.href)
  }, [area, sezione])

  // Notifiche non lette: numero sulla campanella.
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
    // Su un dispositivo condiviso una subscription push lasciata attiva
    // continuerebbe a ricevere le notifiche di questo utente anche dopo che
    // un collega ha fatto l'accesso sullo stesso telefono.
    try {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        // getRegistration e non .ready: senza service worker .ready non si
        // risolve mai e l'uscita resterebbe bloccata.
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = reg ? await reg.pushManager.getSubscription() : null
        if (sub) {
          await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) })
          await sub.unsubscribe()
        }
      }
    } catch { /* non bloccare l'uscita */ }
    // Chiusura Tablet v2 (5f): si torna all'accesso con una conferma che
    // resta qualche secondo (letta dalla pagina di login).
    try { sessionStorage.setItem('inturno-uscita', `Account di ${nomeBreve(nome)} chiuso su questo dispositivo.`) } catch {}
    try { sessionStorage.removeItem('inturno-sezioni') } catch {}
    await createClient().auth.signOut()
    router.push('/login')
  }

  const badgeSezione = (s: Sezione) => (s.badge ? contatori[s.badge] ?? 0 : 0)
  const badgeArea = (a: Area) => sezioniVisibili(a, isPlatformOwner).reduce((t, s) => t + badgeSezione(s), 0)
  const hrefArea = (a: Area) => (!a.sempreDallaPrima && memoria[a.key]) || a.href

  // Titolo e sottotitolo.
  const oggi = maiuscola(formatInTimeZone(new Date(), TZ, 'EEEE d MMMM', { locale: it }))
  let titolo = sezione?.titolo ?? 'inTurno'
  let sottotitolo = riempi((!telefono && sezione?.sottotitoloTablet) || sezione?.sottotitolo || '', locale?.nome)
  if (cfg.intestazioneLocale && locale) { titolo = locale.nome; sottotitolo = locale.sotto }
  // Le approvazioni del direttore stanno sotto Home ma non sono la Home.
  else if (cfg.saluto && area?.key === 'home' && pathname.startsWith('/approvazioni')) { titolo = 'Approvazioni'; sottotitolo = 'Timbrature con foto e richieste' }
  else if (cfg.saluto && area?.key === 'home') {
    titolo = `Ciao, ${nome.split(' ')[0]}`
    sottotitolo = ruolo === 'manager'
      ? `${oggi} · ${ristoranti.length} ${ristoranti.length === 1 ? 'locale' : 'locali'}`
      : `${oggi}${locale ? ` · ${locale.nome}` : ''}`
  }
  if (dinamica.sottotitolo) sottotitolo = dinamica.sottotitolo

  const segmenti = sezioniVisibili(area, isPlatformOwner)
  const conSegmenti = segmenti.length > 1
  const cassaTablet = cfg.stile === 'cassa' && !telefono
  const conCampanella = ruolo !== 'consulente_lavoro' && !cassaTablet
  const pannello = cfg.profilo === 'pannello'
  const conTelegram = ruolo === 'manager' || ruolo === 'direttore' || ruolo === 'capo_servizio'
  // Schede in alto sul telefono: la scheda attiva viene portata in vista e
  // si tiene traccia di quando resta altro da scorrere a destra.
  const [altroASegmenti, setAltroASegmenti] = useState(false)
  const registraSegmenti = useCallback((el: HTMLElement | null) => {
    if (!el) return
    const aggiorna = () => setAltroASegmenti(el.scrollLeft + el.clientWidth < el.scrollWidth - 8)
    const att = el.querySelector<HTMLElement>('[data-attiva]')
    if (att) el.scrollLeft = Math.max(0, att.offsetLeft + att.offsetWidth / 2 - el.clientWidth / 2)
    aggiorna()
    el.addEventListener('scroll', aggiorna, { passive: true })
    return () => el.removeEventListener('scroll', aggiorna)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Sul telefono, scorrendo una lista verso il basso i blocchi marcati
  // data-ritira (filtri, numeri di riepilogo) si ritirano per lasciare
  // spazio al contenuto; tornano scorrendo in su o in cima. Si attiva solo
  // se la lista ha abbastanza da scorrere, altrimenti il ritiro stesso la
  // riporterebbe in cima e i blocchi andrebbero avanti e indietro.
  const registraMain = useCallback((m: HTMLElement | null) => {
    if (!m) return
    const ultimo = new WeakMap<HTMLElement, number>()
    let fermo = 0
    const scorre = (e: Event) => {
      const t = e.target
      if (!(t instanceof HTMLElement) || window.innerWidth >= 640) return
      const y = t.scrollTop, prima = ultimo.get(t) ?? y
      ultimo.set(t, y)
      const ora = e.timeStamp
      if (ora < fermo) return
      const d = y - prima, on = m.hasAttribute('data-compatto')
      if (!on && d > 4 && y > 40 && t.scrollHeight - t.clientHeight > 320) { m.setAttribute('data-compatto', ''); fermo = ora + 450 }
      else if (on && (d < -8 || y <= 2)) { m.removeAttribute('data-compatto'); fermo = ora + 450 }
    }
    m.addEventListener('scroll', scorre, { capture: true, passive: true })
    return () => m.removeEventListener('scroll', scorre, { capture: true })
  }, [])

  const voceDock = () => { if (ov) chiudi() }
  const conDock = cfg.aree.length > 1
  const dockFlottante = conDock && (cfg.stile === 'pillola')
  const vaiXml = () => { chiudi(); setTimeout(() => router.push('/acquisti/fatture?importa=xml'), 200) }
  const apriAssistente = () => {
    if (dinamica.assistente) return dinamica.assistente()
    if (ov) chiudi()
    setAi('aperto')
  }
  const chiudiAssistente = () => { setAi('uscita'); setTimeout(() => setAi('chiuso'), 320) }

  const segmentiEl = conSegmenti && (
    <nav
      ref={telefono ? registraSegmenti : undefined}
      className={cn(
        // Con più schede di quante ne stanno (Altro) il bordo destro sfuma
        // finché c'è altro da scorrere, così si capisce che la barra continua.
        telefono && altroASegmenti && '[mask-image:linear-gradient(to_right,black_calc(100%-36px),transparent)]',
        'flex gap-[3px] border border-border bg-card shadow-[0_4px_20px_rgba(20,30,50,.08)] [scrollbar-width:none]',
        telefono
          ? 'relative z-[29] mx-4 mb-2.5 flex-none overflow-x-auto rounded-[14px] p-1'
          : 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 gap-1 rounded-[16px] p-1.5'
      )}
    >
      {segmenti.map(s => {
        // La scheda toccata si accende subito, senza aspettare il server.
        const att = segPremuto ? s.key === segPremuto : s.key === sezione?.key
        return (
          <Link
            key={s.key}
            href={s.href}
            // Le schede della stessa sezione si precaricano per intero
            // (dati compresi): il passaggio fra loro non aspetta il server.
            prefetch={true}
            onClick={() => setSegPremuto(s.key)}
            aria-current={att ? 'page' : undefined}
            className={cn(
              'relative flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background-color,color] duration-200 active:scale-[0.97]',
              telefono ? cn('h-10 rounded-[10px] px-2.5 text-[13px]', segmenti.length > 4 ? 'flex-none' : 'min-w-0 flex-[1_1_auto]') : 'h-12 w-[112px] rounded-[11px] text-sm',
              att ? 'bg-primary text-primary-foreground' : 'text-foreground'
            )}
            data-attiva={att ? '' : undefined}
          >
            {s.label}
            {att && area && <Accento area={area.key} className="bottom-[5px] w-3.5 sm:bottom-1.5" />}
            <ContatoreBadge n={badgeSezione(s)} invertito={att} />
          </Link>
        )
      })}
    </nav>
  )

  const bottoneCampanella = conCampanella && (
    <button
      type="button"
      aria-label="Notifiche"
      onClick={() => apri('campanella')}
      className={cn('relative flex h-11 w-11 flex-none items-center justify-center rounded-full transition-colors active:scale-[0.96]',
        ov === 'campanella' && (pannello ? 'bg-[oklch(0.93_0.01_250)] dark:bg-secondary' : 'bg-[oklch(0.95_0.01_250)] dark:bg-secondary'))}
    >
      {/* Batacchio: due oscillazioni all'apertura dell'app se c'è qualcosa da leggere. */}
      <IconaCampanella className={cn(pannello && nonLette > 0 && !campanellaVista && 'anim-campanella')} />
      {nonLette > 0 && (
        <span className="absolute right-1.5 top-1.5 box-border flex h-4 min-w-4 items-center justify-center rounded-lg border-2 border-background bg-[oklch(0.55_0.15_25)] px-1 font-mono text-[10px] font-semibold text-white">
          {nonLette > 99 ? '99+' : nonLette}
        </span>
      )}
    </button>
  )

  const bottoneProfilo = (
    <button
      type="button"
      aria-label="Profilo"
      onClick={() => apri('profilo')}
      className={cn('flex h-11 w-11 flex-none items-center justify-center rounded-full transition-colors active:scale-[0.96]',
        ov === 'profilo' && (pannello ? 'bg-[oklch(0.93_0.01_250)] dark:bg-secondary' : 'bg-[oklch(0.94_0.01_250)] dark:bg-secondary'))}
    >
      <IconaProfilo />
    </button>
  )

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
      <div className="h-[env(safe-area-inset-top)] flex-none" />

      <header
        ref={refHeader}
        className={cn(
          'relative z-30 flex flex-none items-center',
          cassaTablet
            ? 'h-[88px] gap-4 border-b border-border px-8'
            : 'min-h-[52px] gap-2 pb-2 pl-5 pr-2.5 pt-1.5 sm:min-h-14 sm:pb-3.5 sm:pl-8 sm:pr-6 sm:pt-2.5',
          sezione?.senzaIntestazione && 'hidden'
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- logo statico, è il bersaglio del volo dello splash */}
        <img data-logo-intestazione="" src="/logo.svg" alt="inTurno" className={cn('flex-none', cassaTablet ? 'h-9 w-9' : 'mr-1 h-7 w-7 sm:h-9 sm:w-9')} />
        <div key={titolo + (sezione?.key ?? '')} data-guscio-entra="" style={{ ['--ritardo' as string]: '60ms' }} className="anim-swapin flex min-w-0 flex-col gap-0.5">
          {/* Titoli lunghi (nome del locale) si rimpiccioliscono invece di
              troncarsi; il sottotitolo sul telefono va su due righe. */}
          <span className={cn('truncate font-semibold leading-tight', cassaTablet ? 'text-[26px] tracking-[-0.6px]' : cn('tracking-[-0.01em] sm:text-[26px]', titolo.length > 20 ? 'text-[17px]' : titolo.length > 15 ? 'text-[19px]' : 'text-[22px]'))}>{titolo}</span>
          {sottotitolo && <span className="line-clamp-2 text-pretty text-[13px] leading-[1.25] text-muted-foreground sm:line-clamp-1 sm:text-sm">{sottotitolo}</span>}
        </div>

        {!telefono && segmentiEl}
        {/* Centro dell'intestazione per le pagine (IntestazioneCentro): le
            fasi della chiusura sul tablet del cassiere. */}
        <div
          ref={registraCentroIntestazione}
          className={cn('hidden min-w-0 items-center justify-center gap-2 sm:flex', cassaTablet ? 'flex-1' : 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2', conSegmenti && !cassaTablet && 'sm:hidden')}
        />
        {!cassaTablet && <span className="flex-1" />}

        <div data-guscio-entra="" style={{ ['--ritardo' as string]: '120ms' }} className="flex flex-none items-center gap-2">
          {cfg.assistente && (
            <button type="button" onClick={apriAssistente} aria-label="Assistente" className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-[oklch(0.45_0.1_180)] active:scale-[0.96] dark:text-[oklch(0.75_0.1_180)]">
              <IconaScintilla />
            </button>
          )}
          {pannello ? (
            <>{bottoneCampanella}{bottoneProfilo}</>
          ) : cassaTablet ? (
            <button type="button" onClick={esci} className="flex h-11 items-center rounded-[12px] border border-border px-3.5 text-sm font-medium text-muted-foreground active:scale-[0.97]">
              Esci · {nomeBreve(nome)}
            </button>
          ) : (
            <>
              {conCampanella && (
                <div className="relative z-[41]">
                  {bottoneCampanella}
                  {ov === 'campanella' && (
                    <div className={cn('absolute right-[-58px] top-[52px] z-50 w-[min(366px,calc(100vw-24px))]', uscita ? 'anim-swapout' : 'anim-swapin')}>
                      <Notifiche tendina onClose={chiudi} className="max-h-[min(520px,calc(100dvh-140px))]" />
                    </div>
                  )}
                </div>
              )}
              <div className="relative z-40">
                {bottoneProfilo}
                {ov === 'profilo' && (
                  <div className={cn('absolute right-0 top-[calc(100%+8px)] z-50', uscita ? 'anim-swapout' : 'anim-swapin')}>
                    <TendinaProfilo nome={nome} descrizione={descrizione} conTelegram={conTelegram} onEsci={esci} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {pannello && ov !== null && (
        <div
          ref={refPannello}
          className={cn(
            'fixed z-50',
            telefono
              ? 'inset-x-3 top-[calc(env(safe-area-inset-top)+54px)]'
              : ov === 'campanella' ? 'right-[76px] top-[calc(env(safe-area-inset-top)+56px)] w-[420px]' : 'right-6 top-[calc(env(safe-area-inset-top)+56px)] w-[340px]',
            uscita ? 'anim-swapout' : 'anim-swapin'
          )}
        >
          {ov === 'campanella'
            ? <Notifiche onClose={chiudi} className={telefono ? 'max-h-[min(600px,calc(100dvh-170px))]' : 'max-h-[min(640px,calc(100dvh-100px))]'} />
            : <PannelloProfilo
                nome={nome} descrizione={descrizione} ristoranti={ristoranti} telefono={telefono}
                conXml={telefono} conTelegram={conTelegram} onEsci={esci} onXml={vaiXml}
                className={telefono ? 'max-h-[min(660px,calc(100dvh-170px))]' : 'max-h-[calc(100dvh-100px)]'}
              />}
        </div>
      )}

      {telefono && segmentiEl}

      {/* Il banner "Attiva le notifiche" compare solo nella Home di manager e
          direttore; il riallineamento della subscription avviene ovunque
          (la Home del dipendente ha il suo banner). */}
      {ruolo !== 'dipendente' && (
        <PushNotificationPrompt
          mostra={(ruolo === 'manager' || ruolo === 'direttore') && area?.key === 'home'}
          chiave={ruolo === 'manager' ? 'mgrPush' : 'dirPush'}
        />
      )}
      {archivio && (
        <div className="mx-4 mb-2 flex flex-none items-center gap-2 rounded-[10px] bg-warn-tint px-3.5 py-1.5 text-warn sm:mx-8">
          <span className="min-w-0 flex-1 text-pretty text-[13px] font-medium">Archivio · stai guardando <b className="font-semibold">{archivio.nome}</b>, locale nascosto</span>
          <button type="button" onClick={async () => { await chiudiArchivio(); router.refresh() }}
            className="flex h-10 flex-none items-center rounded-[8px] border border-current px-3 text-[13px] font-semibold active:scale-[0.97]">Torna ai locali attivi</button>
        </div>
      )}
      {banner}
      <StrisciaOffline />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <main
          ref={registraMain}
          key={pathname}
          data-titolo-shell={cfg.intestazioneLocale ? undefined : '1'}
          // Le pagine a tutto schermo (Contenitore della Cassa) lasciano in
          // fondo lo spazio della dock flottante. Quando la barra in basso
          // sta già sotto <main> (cassiere, dipendente) quello spazio non
          // serve: prima restava una fascia vuota di 104 px sull'iPad.
          style={dockFlottante ? undefined : { ['--spazio-dock' as string]: '0px' }}
          className={cn(
            'anim-entra relative min-h-0 flex-1 overflow-y-auto overscroll-contain',
            dockFlottante ? 'pb-[calc(max(26px,env(safe-area-inset-bottom))+92px)] sm:pb-[calc(max(22px,env(safe-area-inset-bottom))+106px)]' : 'pb-4'
          )}
        >
          {children}
        </main>
      </div>

      {conDock && (
        <>
          {cfg.stile === 'pillola' && <DockPillola aree={cfg.aree} attiva={area?.key ?? null} hrefArea={hrefArea} badgeArea={badgeArea} onVoce={voceDock} />}
          {cfg.stile === 'schede' && (
            <BarraSchede
              aree={cfg.aree} attiva={area?.key ?? null} hrefArea={hrefArea} badgeArea={badgeArea} onVoce={voceDock}
              // Dipendente v2: pallino sull'ODS (notifiche non lette).
              conPallino={a => ruolo === 'dipendente' && a.key === 'ods'}
            />
          )}
          {cfg.stile === 'cassa' && (cassaTablet
            ? <BarraCassaTablet aree={cfg.aree} attiva={area?.key ?? null} hrefArea={hrefArea} badgeArea={badgeArea} onVoce={voceDock} />
            : <DockPillola spente aree={cfg.aree} attiva={area?.key ?? null} hrefArea={hrefArea} badgeArea={badgeArea} onVoce={voceDock} />)}
        </>
      )}

      {ai !== 'chiuso' && (
        <Assistente uscita={ai === 'uscita'} onClose={chiudiAssistente} nome={nome} locale={locale?.nome} singolo={ruolo === 'direttore'} />
      )}
    </div>
  )
}
