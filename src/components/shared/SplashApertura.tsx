'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

// Apertura dell'app (Splash.dc.html, variante 3a "Scuro, alone chiaro"):
// solo al primo avvio della sessione. Il logo a strati resta finché la
// Home è pronta (minimo 1,4 s, massimo 12 s), poi rimpicciolisce e si
// posa sul logo dell'intestazione mentre il fondo sfuma; gli anelli
// rallentano fino a fermarsi dritti, così l'atterraggio combacia col logo
// statico. Nei cambi di tab e di area niente splash: il contenuto mostra
// lo scheletro della pagina (AppShell).
//
// Il logo è diviso in strati (vedi scripts/genera-logo.py) animati con CSS
// sugli <img> interi: il browser li esegue fuori dal thread principale,
// quindi restano fluidi anche mentre l'app si idrata e carica i dati.

const DURATA_MINIMA_MS = 1400
const DURATA_MASSIMA_MS = 12000
// Gli skeleton devono restare assenti per un attimo: fra il loading.tsx
// della rotta e gli skeleton del componente client c'è un istante senza.
const STABILITA_MS = 300
const SELETTORE_SKELETON = '.skeleton-shimmer, [data-skeleton], [data-sk-layer], div.bg-muted.animate-pulse'
const FONDO = 'oklch(0.17 0.008 250)'

type Fase = 'visibile' | 'volo' | 'finita'

function segna(v: 'on' | 'volo' | 'no') {
  document.documentElement.dataset.splash = v
}

// Ferma gli anelli senza scatti (prototipo: settle): ognuno completa il
// giro in corso alla sua velocità e si posa a 0°; la "it" torna dritta.
// Restituisce quanto dura l'assestamento più lungo.
function assesta(radice: HTMLElement | null): number {
  let massimo = 680
  radice?.querySelectorAll<HTMLImageElement>('img[data-r]').forEach(img => {
    const m = getComputedStyle(img).transform
    const verso = img.dataset.r
    img.style.animation = 'none'
    if (verso === 'f') {
      img.style.transform = m && m !== 'none' ? m : 'none'
      void img.offsetWidth
      img.style.transition = 'transform 680ms cubic-bezier(0.22,1,0.36,1)'
      img.style.transform = 'none'
      return
    }
    const q = m && m.match(/matrix\(([^)]+)\)/)
    let a = 0
    if (q) { const p = q[1].split(',').map(Number); a = Math.atan2(p[1], p[0]) * 180 / Math.PI }
    const orario = verso === 'cw'
    const da = orario ? (a < 0 ? a + 360 : a) : (a > 0 ? a - 360 : a)
    const resto = orario ? 360 - da : 360 + da
    const durata = Math.round(Math.min(1100, Math.max(450, 3000 * resto / (orario ? 112.5 : 75))))
    img.style.transform = `rotate(${da}deg)`
    void img.offsetWidth
    img.style.transition = `transform ${durata}ms cubic-bezier(0.33,1,0.68,1)`
    img.style.transform = `rotate(${orario ? 360 : -360}deg)`
    massimo = Math.max(massimo, durata)
  })
  return massimo
}

export function SplashApertura() {
  const timer = useRef<ReturnType<typeof setTimeout>[]>([])
  const intervallo = useRef<ReturnType<typeof setInterval> | null>(null)
  const [fase, setFase] = useState<Fase>('visibile')
  // Ferma (primo fotogramma, invisibile) finché tutti gli strati del logo
  // non sono caricati. Prima partiva subito dalla pagina del server e dopo
  // 0,1 s si metteva in pausa ad aspettare le immagini: sul telefono si
  // vedeva un mezzo logo fermarsi e ripartire, come un doppio avvio.
  const [pronto, setPronto] = useState(false)
  const logoRef = useRef<HTMLDivElement | null>(null)
  const voloRef = useRef<HTMLDivElement | null>(null)
  const [posa, setPosa] = useState<{ x: number; y: number; s: number } | null>(null)

  const ferma = useCallback(() => {
    timer.current.forEach(clearTimeout)
    timer.current = []
    if (intervallo.current) clearInterval(intervallo.current)
    intervallo.current = null
  }, [])

  const chiudi = useCallback(() => {
    // Segnata come vista solo quando si chiude davvero: se l'app si
    // ricarica durante l'apertura (redirect dopo il login, ricarica del
    // service worker) lo splash riparte da capo invece di sparire a metà.
    try { sessionStorage.setItem('splash-mostrata', '1') } catch {}
    ferma()
    const ridotto = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const bersaglio = document.querySelector('[data-logo-intestazione]')?.getBoundingClientRect()
    const da = voloRef.current?.getBoundingClientRect()
    let fine = 480
    if (bersaglio && da && bersaglio.width > 0 && !ridotto) {
      setPosa({
        x: bersaglio.left + bersaglio.width / 2 - (da.left + da.width / 2),
        y: bersaglio.top + bersaglio.height / 2 - (da.top + da.height / 2),
        s: bersaglio.width / da.width,
      })
      fine = assesta(logoRef.current) + 40
    }
    segna('volo')
    setFase('volo')
    timer.current.push(setTimeout(() => { segna('no'); setFase('finita') }, fine))
  }, [ferma])

  const avvia = useCallback(() => {
    ferma()
    segna('on')
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
        if (!caricate && Date.now() - avviato < 4000) return
        setPronto(true)
        inizio = Date.now()
      }
      const trascorso = Date.now() - inizio
      if (document.querySelector(SELETTORE_SKELETON)) senzaSkeletonDa = null
      else if (senzaSkeletonDa === null) senzaSkeletonDa = Date.now()
      const pronta = senzaSkeletonDa !== null && Date.now() - senzaSkeletonDa >= STABILITA_MS
      if ((trascorso >= DURATA_MINIMA_MS && pronta) || trascorso >= DURATA_MASSIMA_MS) chiudi()
    }, 50)
  }, [ferma, chiudi])

  useEffect(() => {
    let giaMostrata = false
    try { giaMostrata = sessionStorage.getItem('splash-mostrata') === '1' } catch {}
    const t = setTimeout(() => {
      if (giaMostrata) { segna('no'); setFase('finita') } else avvia()
    }, 0)
    return () => { clearTimeout(t); ferma() }
  }, [avvia, ferma])

  const volo = fase === 'volo'
  const sfuma = (ms: number): React.CSSProperties => ({ opacity: volo ? 0 : 1, transition: `opacity ${ms}ms ease-out` })

  // Su un ricaricamento nella stessa sessione lo script, eseguito prima del
  // primo disegno, nasconde subito lo splash renderizzato dal server.
  return (
    <>
      {/* Strati del logo richiesti subito, insieme alla pagina. */}
      {['fondo', 'interno', 'lettere', 'esterno', 'riflessi'].map(k => <link key={k} rel="preload" as="image" href={`/logo-animato-${k}.svg`} />)}
      <script
        dangerouslySetInnerHTML={{
          __html: "try{document.documentElement.dataset.splash=sessionStorage.getItem('splash-mostrata')==='1'?'no':'on'}catch(e){}",
        }}
      />
      {fase !== 'finita' && (
        <div id="splash-apertura" aria-hidden className="fixed inset-0 z-[100]" style={{ pointerEvents: volo ? 'none' : 'auto' }}>
          <div className="absolute inset-0" style={{ background: FONDO, opacity: volo ? 0 : 1, transition: 'opacity 460ms cubic-bezier(0.4,0,0.2,1)' }} />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-[26px] sm:gap-[30px]">
            <div
              ref={voloRef}
              className="relative"
              style={{
                transform: volo && posa ? `translate(${posa.x}px, ${posa.y}px) scale(${posa.s})` : undefined,
                opacity: volo && !posa ? 0 : 1,
                transition: 'transform 680ms cubic-bezier(0.22,1,0.36,1), opacity 320ms ease-out',
              }}
            >
              {/* Contenitori di dissolvenza: l'opacità degli strati è già
                  animata, quindi la sfumatura del volo sta su un genitore. */}
              <div className="absolute inset-0" style={sfuma(260)}><div className="splash-alone" /></div>
              <div className="absolute inset-0" style={sfuma(200)}><div className="splash-onda" /></div>
              <div ref={logoRef} className={`splash-logo ${pronto ? 'splash-pronto' : ''}`}>
                {/* eslint-disable @next/next/no-img-element -- SVG statici a strati animati via CSS, next/image non serve */}
                <img src="/logo-animato-fondo.svg" alt="" draggable={false} className="splash-strato" />
                <img src="/logo-animato-interno.svg" alt="" draggable={false} data-r="ccw" className="splash-strato splash-interno" />
                <img src="/logo-animato-lettere.svg" alt="" draggable={false} data-r="f" className="splash-strato splash-lettere" />
                <img src="/logo-animato-esterno.svg" alt="" draggable={false} data-r="cw" className="splash-strato splash-esterno" />
                <img src="/logo-animato-riflessi.svg" alt="" draggable={false} className="splash-strato splash-riflessi" />
                {/* eslint-enable @next/next/no-img-element */}
                <div className="absolute inset-0" style={sfuma(200)}><div className="splash-riflesso" /></div>
              </div>
            </div>
            {/* Marchio sotto il logo: sfuma col fondo quando il logo vola. */}
            <span style={{ opacity: volo ? 0 : 1, transition: 'opacity 460ms cubic-bezier(0.4,0,0.2,1)' }}>
              <span className="splash-marchio block text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-[oklch(0.97_0.005_250)] sm:text-[32px]">
                inTurno
              </span>
            </span>
          </div>
        </div>
      )}
    </>
  )
}
