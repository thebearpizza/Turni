'use client'
import { useCallback, useRef, useState } from 'react'

/**
 * Tempi dello scheletro del design: `avvia()` a ogni cambio di filtro lo
 * accende per almeno 700 ms; `pronto()` quando i dati sono arrivati. Si
 * spegne con una dissolvenza di 320 ms appena valgono entrambe le cose.
 */
export function useScheletro(iniziale = true) {
  const [stato, setStato] = useState<'on' | 'out' | 'no'>(iniziale ? 'on' : 'no')
  const corrente = useRef<'on' | 'out' | 'no'>(iniziale ? 'on' : 'no')
  const inizio = useRef(-1e9)
  const caricato = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>[]>([])

  const metti = useCallback((x: 'on' | 'out' | 'no') => { corrente.current = x; setStato(x) }, [])
  const prova = useCallback(() => {
    if (corrente.current !== 'on' || !caricato.current || performance.now() - inizio.current < 700) return
    metti('out')
    timer.current.push(setTimeout(() => metti('no'), 320))
  }, [metti])
  const avvia = useCallback(() => {
    timer.current.forEach(clearTimeout)
    timer.current = []
    inizio.current = performance.now()
    caricato.current = false
    metti('on')
    timer.current.push(setTimeout(prova, 700))
  }, [metti, prova])
  const pronto = useCallback(() => { caricato.current = true; prova() }, [prova])

  return { stato, avvia, pronto }
}
