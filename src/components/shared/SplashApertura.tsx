'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

// Animazione del logo a tutto schermo. Parte:
// - all'apertura dell'app, una volta per sessione (sessionStorage) — non a
//   ogni ricarica;
// - quando si entra in una macro area diversa (Turni, Cassa, Acquisti,
//   Consulente) o si torna all'hub. Muoversi fra le pagine della stessa
//   area non la fa ripartire.
// Non blocca il caricamento: la pagina sotto si carica intanto.
const DURATA_APERTURA_MS = 1400
const DURATA_CAMBIO_AREA_MS = 900
const DISSOLVENZA_MS = 400

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

    let durata: number
    if (primoRender) {
      let giaMostrata = false
      try { giaMostrata = sessionStorage.getItem('splash-mostrata') === '1' } catch {}
      if (giaMostrata) {
        const t = setTimeout(() => setFase('finita'), 0)
        return () => clearTimeout(t)
      }
      try { sessionStorage.setItem('splash-mostrata', '1') } catch {}
      durata = DURATA_APERTURA_MS
    } else if (cambioArea) {
      // Lo script inline ha nascosto lo splash via data-splash su un
      // ricaricamento: va tolto, o il nuovo splash resterebbe invisibile.
      delete document.documentElement.dataset.splash
      durata = DURATA_CAMBIO_AREA_MS
    } else {
      return
    }

    const t0 = setTimeout(() => setFase('visibile'), 0)
    const t1 = setTimeout(() => setFase('uscita'), durata)
    const t2 = setTimeout(() => setFase('finita'), durata + DISSOLVENZA_MS)
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2) }
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
