'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

// Animazione del logo a tutto schermo, al posto degli skeleton di caricamento. Parte:
// - all'apertura dell'app, una volta per sessione (sessionStorage) — non a
//   ogni ricarica;
// - quando si entra in una macro area diversa (Turni, Cassa, Acquisti,
//   Consulente) o si torna all'hub. Muoversi fra le pagine della stessa
//   area non la fa ripartire.
// Resta finché la schermata sotto non ha finito di caricare i dati, cioè
// finché ci sono skeleton nel DOM: la durata è variabile. Un minimo evita
// un lampo quando i dati sono già pronti, un massimo evita di restare
// bloccati se una schermata non finisce mai di caricare.
const DURATA_MINIMA_MS = 700
const DURATA_MASSIMA_MS = 12000
// Gli skeleton devono restare assenti per un attimo: fra il loading.tsx
// della rotta e gli skeleton del componente client c'è un istante senza.
const STABILITA_MS = 300
const DISSOLVENZA_MS = 400
const SELETTORE_SKELETON = '.skeleton-shimmer, [data-skeleton], div.bg-muted.animate-pulse'

const PAGINE_TURNI = ['dashboard', 'account-pendenti', 'approvazioni', 'assenze', 'bacheca', 'dipendenti', 'ods', 'presenze', 'report', 'ristoranti', 'turni']

function macroArea(pathname: string): string | null {
  const primo = pathname.split('/')[1] ?? ''
  if (['hub', 'cassa', 'acquisti', 'consulente', 'home'].includes(primo)) return primo
  if (PAGINE_TURNI.includes(primo)) return 'turni'
  return null
}

export function SplashApertura() {
  const pathname = usePathname()
  const areaPrecedente = useRef<string | null | undefined>(undefined)
  const [fase, setFase] = useState<'visibile' | 'uscita' | 'finita'>('visibile')

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
      try { sessionStorage.setItem('splash-mostrata', '1') } catch {}
    } else if (cambioArea) {
      // Lo script inline ha nascosto lo splash via data-splash su un
      // ricaricamento: va tolto, o il nuovo splash resterebbe invisibile.
      delete document.documentElement.dataset.splash
    } else {
      return
    }

    const inizio = Date.now()
    let senzaSkeletonDa: number | null = null
    let chiuso = false
    let tFine: ReturnType<typeof setTimeout> | undefined
    const t0 = setTimeout(() => setFase('visibile'), 0)
    const controlla = setInterval(() => {
      const trascorso = Date.now() - inizio
      const caricando = document.querySelector(SELETTORE_SKELETON) !== null
      if (caricando) senzaSkeletonDa = null
      else if (senzaSkeletonDa === null) senzaSkeletonDa = Date.now()
      const pronta = senzaSkeletonDa !== null && Date.now() - senzaSkeletonDa >= STABILITA_MS
      if ((trascorso >= DURATA_MINIMA_MS && pronta) || trascorso >= DURATA_MASSIMA_MS) {
        clearInterval(controlla)
        chiuso = true
        setFase('uscita')
        tFine = setTimeout(() => setFase('finita'), DISSOLVENZA_MS)
      }
    }, 100)
    return () => {
      clearTimeout(t0)
      clearInterval(controlla)
      if (chiuso) clearTimeout(tFine)
    }
  }, [pathname])

  // Su un ricaricamento nella stessa sessione lo script, eseguito prima del
  // primo disegno, nasconde subito lo splash renderizzato dal server:
  // niente lampo del logo prima che l'effetto lo smonti.
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: "try{if(sessionStorage.getItem('splash-mostrata')==='1')document.documentElement.dataset.splash='no'}catch(e){}",
        }}
      />
      {fase !== 'finita' && (
        <div
          aria-hidden
          id="splash-apertura"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0f1011] transition-opacity ease-out"
          style={{ opacity: fase === 'uscita' ? 0 : 1, transitionDuration: `${DISSOLVENZA_MS}ms` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG animato: next/image non serve e ne perderebbe le animazioni */}
          <img src="/logo-animato.svg" alt="" width={140} height={140} />
        </div>
      )}
    </>
  )
}
