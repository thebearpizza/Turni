'use client'
import { useEffect, useState } from 'react'

// Animazione di apertura: il logo animato a tutto schermo, una sola volta
// per sessione (sessionStorage) — non a ogni navigazione. Resta visibile
// il tempo di un giro dell'indicatore e poi sfuma, senza bloccare il
// caricamento della pagina sottostante.
const DURATA_MS = 1400
const DISSOLVENZA_MS = 400

export function SplashApertura() {
  const [fase, setFase] = useState<'visibile' | 'uscita' | 'finita'>('visibile')

  useEffect(() => {
    let giaMostrata = false
    try { giaMostrata = sessionStorage.getItem('splash-mostrata') === '1' } catch {}
    if (giaMostrata) {
      const t = setTimeout(() => setFase('finita'), 0)
      return () => clearTimeout(t)
    }
    try { sessionStorage.setItem('splash-mostrata', '1') } catch {}
    const t1 = setTimeout(() => setFase('uscita'), DURATA_MS)
    const t2 = setTimeout(() => setFase('finita'), DURATA_MS + DISSOLVENZA_MS)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  if (fase === 'finita') return null

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
    <div
      aria-hidden
      id="splash-apertura"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0f1011] transition-opacity ease-out"
      style={{ opacity: fase === 'uscita' ? 0 : 1, transitionDuration: `${DISSOLVENZA_MS}ms` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG animato: next/image non serve e ne perderebbe le animazioni */}
      <img src="/logo-animato.svg" alt="" width={140} height={140} />
    </div>
    </>
  )
}
