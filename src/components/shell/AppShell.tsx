'use client'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useTelefono } from '@/hooks/useTelefono'
import { ScheletroForma } from '@/components/shared/ScheletroForma'
import { PushNotificationPrompt } from '@/components/shared/PushNotificationPrompt'
import { useIntestazioneDinamica, registraCentroIntestazione } from './intestazioneDinamica'
import { NAVIGAZIONE, sezioniVisibili, trovaPosizione, type Area, type Ruolo, type Sezione } from './navigazione'
import { useContatori } from './useContatori'
import { ricordaSezione, useMemoriaSezioni } from './memoriaSezioni'
import { nomeBreve } from './datiShell'
import { Notifiche } from './Notifiche'
import { PannelloProfilo, TendinaProfilo, type RistoranteQr } from './Profilo'
import { Assistente } from './Assistente'
import { BarraCassaTablet, BarraSchede, ContatoreBadge, DockPillola } from './Dock'
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

export function AppShell({ ruolo, nome, descrizione, locale, ristoranti = [], isPlatformOwner = false, banner, children }: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const telefono = useTelefono()
  const cfg = NAVIGAZIONE[ruolo]
  const { area, sezione } = trovaPosizione(cfg, pathname)
  const contatori = useContatori(ruolo, isPlatformOwner)
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

  // Cambio pagina: si chiudono i pannelli, si ricorda la sezione
  // dell'area e il contenuto entra sotto lo scheletro (700 ms + 320 ms di
  // dissolvenza, come nei prototipi). Stato derivato durante il render
  // invece di un setState in un effect.
  const [ultimoPath, setUltimoPath] = useState(pathname)
  const [sk, setSk] = useState<'no' | 'on' | 'out'>('no')
  if (ultimoPath !== pathname) {
    setUltimoPath(pathname)
    setOv(null)
    setUscita(false)
    setSk('on')
  }
  useEffect(() => {
    if (sk === 'no') return
    const t = setTimeout(() => setSk(sk === 'on' ? 'out' : 'no'), sk === 'on' ? 700 : 320)
    return () => clearTimeout(t)
  }, [sk, pathname])
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
  // Tocco su un'altra area: lo scheletro parte subito, senza aspettare la
  // risposta del server, così il tocco ha sempre un riscontro immediato.
  const voceDock = (a: { key: string }) => { if (ov) chiudi(); if (a.key !== area?.key) setSk('on') }
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
      className={cn(
        'flex gap-[3px] border border-border bg-card shadow-[0_4px_20px_rgba(20,30,50,.08)] [scrollbar-width:none]',
        telefono
          ? 'relative z-[29] mx-4 mb-2.5 flex-none overflow-x-auto rounded-[14px] p-1'
          : 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 gap-1 rounded-[16px] p-1.5'
      )}
    >
      {segmenti.map(s => {
        const att = s.key === sezione?.key
        return (
          <Link
            key={s.key}
            href={s.href}
            aria-current={att ? 'page' : undefined}
            className={cn(
              'relative flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background-color,color] duration-200 active:scale-[0.97]',
              telefono ? cn('h-10 rounded-[10px] px-2.5 text-[13px]', segmenti.length > 4 ? 'flex-none' : 'min-w-0 flex-[1_1_auto]') : 'h-12 w-[112px] rounded-[11px] text-sm',
              att ? 'bg-primary text-primary-foreground' : 'text-foreground'
            )}
          >
            {s.label}
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
          <span className={cn('truncate font-semibold leading-tight', cassaTablet ? 'text-[26px] tracking-[-0.6px]' : 'text-[22px] tracking-[-0.01em] sm:text-[26px]')}>{titolo}</span>
          {sottotitolo && <span className="truncate text-[13px] text-muted-foreground sm:text-sm">{sottotitolo}</span>}
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
      {banner}
      <StrisciaOffline />

      <div data-sk-root="" data-sk-on={sk === 'on' ? '1' : undefined} className="relative flex min-h-0 flex-1 flex-col">
        <main
          key={pathname}
          data-titolo-shell={cfg.intestazioneLocale ? undefined : '1'}
          className={cn(
            'anim-swapin relative min-h-0 flex-1 overflow-y-auto overscroll-contain',
            dockFlottante ? 'pb-[calc(max(26px,env(safe-area-inset-bottom))+92px)] sm:pb-[calc(max(22px,env(safe-area-inset-bottom))+106px)]' : 'pb-4'
          )}
        >
          {children}
        </main>
        {sk !== 'no' && <ScheletroForma esce={sk === 'out'} className="absolute inset-0 z-[70] overflow-hidden" />}
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
