'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

// Animazione del logo a tutto schermo, al posto degli skeleton di
// caricamento. Parte:
// - all'apertura dell'app, una volta per sessione (sessionStorage) — non a
//   ogni ricarica;
// - quando si entra in una macro area diversa (Turni, Cassa, Acquisti,
//   Consulente) o si torna all'hub. Muoversi fra le pagine della stessa
//   area — compresi i redirect interni, es. /cassa → /cassa/analisi — non
//   la fa ripartire né la interrompe.
// Resta finché la schermata sotto ha skeleton nel DOM: durata variabile.
// La sequenza d'ingresso (globals.css) si completa in circa 1,6 s: la
// "it" compare verso 1,1 s. Sotto questa soglia lo splash la tronca.
// Il conteggio parte dall'effetto, cioè dopo l'idratazione, ma la
// sequenza CSS parte già dal primo disegno della pagina: il margine
// copre anche il caso in cui l'idratazione arrivi prestissimo.
const DURATA_MINIMA_MS = 2000
// All'apertura il conto parte da quando gli strati del logo sono caricati
// (la sequenza, già in corso dal primo disegno, a quel punto può averli
// mostrati solo in quel momento): abbastanza perché la "it" si veda.
const DURATA_MINIMA_APERTURA_MS = 1400
const DURATA_MASSIMA_MS = 12000
// Gli skeleton devono restare assenti per un attimo: fra il loading.tsx
// della rotta e gli skeleton del componente client c'è un istante senza.
const STABILITA_MS = 300
const DISSOLVENZA_MS = 400
const RITARDO_INDIETRO_MS = 3000
const SELETTORE_SKELETON = '.skeleton-shimmer, [data-skeleton], div.bg-muted.animate-pulse'

const PAGINE_TURNI = ['dashboard', 'account-pendenti', 'approvazioni', 'assenze', 'bacheca', 'dipendenti', 'ods', 'presenze', 'report', 'ristoranti', 'turni']

function macroArea(pathname: string): string | null {
  const primo = pathname.split('/')[1] ?? ''
  if (['hub', 'cassa', 'acquisti', 'consulente', 'home'].includes(primo)) return primo
  if (PAGINE_TURNI.includes(primo)) return 'turni'
  return null
}

type Fase = 'visibile' | 'uscita' | 'finita'

export function SplashApertura() {
  const pathname = usePathname()
  const router = useRouter()
  const areaPrecedente = useRef<string | null | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout>[]>([])
  const intervallo = useRef<ReturnType<typeof setInterval> | null>(null)
  const saltaProssimo = useRef(false)
  const [fase, setFase] = useState<Fase>('visibile')
  const [mostraIndietro, setMostraIndietro] = useState(false)
  const [pronto, setPronto] = useState(true)
  const [giro, setGiro] = useState(0)
  const logoRef = useRef<HTMLDivElement | null>(null)
  const [conIndietro, setConIndietro] = useState(false)

  const ferma = useCallback(() => {
    timer.current.forEach(clearTimeout)
    timer.current = []
    if (intervallo.current) clearInterval(intervallo.current)
    intervallo.current = null
  }, [])

  const chiudi = useCallback(() => {
    // Segnata come vista solo quando si chiude davvero: se l'app si
    // ricarica o il componente si rimonta durante l'apertura (redirect
    // dopo il login, ricarica del service worker), lo splash riparte da
    // capo invece di sparire a metà sequenza.
    try { sessionStorage.setItem('splash-mostrata', '1') } catch {}
    ferma()
    setFase('uscita')
    timer.current.push(setTimeout(() => setFase('finita'), DISSOLVENZA_MS))
  }, [ferma])

  const avvia = useCallback((indietroPossibile: boolean) => {
    ferma()
    setFase('visibile')
    setMostraIndietro(false)
    setConIndietro(indietroPossibile)
    if (indietroPossibile) {
      timer.current.push(setTimeout(() => setMostraIndietro(true), RITARDO_INDIETRO_MS))
    }
    // Cambio area: nuova chiave, il logo si rimonta e la sequenza CSS
    // riparte da capo, in pausa finché gli strati non sono caricati.
    // All'apertura invece la sequenza è già partita col primo disegno
    // della pagina renderizzata dal server: non va interrotta.
    const apertura = !indietroPossibile
    if (!apertura) {
      setGiro(g => g + 1)
      setPronto(false)
    }
    const minima = apertura ? DURATA_MINIMA_APERTURA_MS : DURATA_MINIMA_MS
    const avviato = Date.now()
    let inizio: number | null = null
    let senzaSkeletonDa: number | null = null
    intervallo.current = setInterval(() => {
      // La sequenza resta in pausa finché tutti gli strati del logo non
      // sono caricati (primo avvio, rete lenta): altrimenti partirebbe
      // senza la "it" e lo splash potrebbe chiudersi prima di mostrarla.
      if (inizio === null) {
        const immagini = Array.from(logoRef.current?.querySelectorAll('img') ?? [])
        const caricate = immagini.length > 0 && immagini.every(i => i.complete)
        // Immagini bloccate (rete assente): non restare in pausa per sempre.
        if (!caricate && Date.now() - avviato < 4000) return
        setPronto(true)
        inizio = Date.now()
      }
      const trascorso = Date.now() - inizio
      if (document.querySelector(SELETTORE_SKELETON)) senzaSkeletonDa = null
      else if (senzaSkeletonDa === null) senzaSkeletonDa = Date.now()
      const pronta = senzaSkeletonDa !== null && Date.now() - senzaSkeletonDa >= STABILITA_MS
      if ((trascorso >= minima && pronta) || trascorso >= DURATA_MASSIMA_MS) chiudi()
    }, 100)
  }, [ferma, chiudi])

  // Il ciclo di vita dello splash non dipende dal pathname: i timer si
  // fermano solo allo smontaggio o quando lo splash stesso si chiude.
  useEffect(() => ferma, [ferma])

  useEffect(() => {
    const area = macroArea(pathname)
    const primoRender = areaPrecedente.current === undefined
    const cambioArea = !primoRender && area !== null && area !== areaPrecedente.current
    areaPrecedente.current = area

    if (primoRender) {
      let giaMostrata = false
      try { giaMostrata = sessionStorage.getItem('splash-mostrata') === '1' } catch {}
      if (giaMostrata) {
        const t = setTimeout(() => setFase('finita'), 0)
        return () => clearTimeout(t)
      }
      const t = setTimeout(() => avvia(false), 0)
      return () => clearTimeout(t)
    }
    if (!cambioArea) return
    if (saltaProssimo.current) { saltaProssimo.current = false; return }
    // Lo script inline ha nascosto lo splash via data-splash su un
    // ricaricamento: va tolto, o il nuovo splash resterebbe invisibile.
    delete document.documentElement.dataset.splash
    const t = setTimeout(() => avvia(true), 0)
    return () => clearTimeout(t)
  }, [pathname, avvia])

  function tornaIndietro() {
    saltaProssimo.current = true
    chiudi()
    router.back()
  }

  // Su un ricaricamento nella stessa sessione lo script, eseguito prima del
  // primo disegno, nasconde subito lo splash renderizzato dal server:
  // niente lampo del logo prima che l'effetto lo smonti.
  //
  // Il logo è diviso in strati (vedi scripts/genera-logo.py) animati con
  // CSS sugli <img> interi: il browser li esegue fuori dal thread
  // principale, quindi restano fluidi anche mentre l'app è occupata a
  // idratarsi e caricare dati. Le animazioni interne all'SVG si
  // bloccherebbero proprio in quei momenti. Sequenza in globals.css.
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: "try{if(sessionStorage.getItem('splash-mostrata')==='1')document.documentElement.dataset.splash='no'}catch(e){}",
        }}
      />
      {fase !== 'finita' && (
        <div
          id="splash-apertura"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-10 bg-[#0f1011] transition-opacity ease-out"
          style={{
            opacity: fase === 'uscita' ? 0 : 1,
            pointerEvents: fase === 'uscita' ? 'none' : 'auto',
            transitionDuration: `${DISSOLVENZA_MS}ms`,
          }}
        >
          <div key={giro} ref={logoRef} aria-hidden className={`splash-logo ${pronto ? 'splash-pronto' : ''}`}>
            <div className="splash-alone" />
            <div className="splash-onda" />
            {/* eslint-disable @next/next/no-img-element -- SVG statici a strati animati via CSS, next/image non serve */}
            <img src="/logo-animato-fondo.svg" alt="" className="splash-strato" />
            <img src="/logo-animato-interno.svg" alt="" className="splash-strato splash-interno" />
            <img src="/logo-animato-lettere.svg" alt="" className="splash-strato splash-lettere" />
            <img src="/logo-animato-esterno.svg" alt="" className="splash-strato splash-esterno" />
            <img src="/logo-animato-riflessi.svg" alt="" className="splash-strato splash-riflessi" />
            {/* eslint-enable @next/next/no-img-element */}
            <div className="splash-riflesso" />
          </div>
          {conIndietro && (
            <button
              type="button"
              onClick={tornaIndietro}
              className="flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-sm text-white/80 transition-opacity duration-300 active:bg-white/10"
              style={{ opacity: mostraIndietro ? 1 : 0, pointerEvents: mostraIndietro ? 'auto' : 'none' }}
            >
              <ArrowLeft className="h-4 w-4" /> Torna indietro
            </button>
          )}
        </div>
      )}
    </>
  )
}
