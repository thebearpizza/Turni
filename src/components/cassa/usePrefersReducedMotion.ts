'use client'
import { useEffect, useState } from 'react'

// Le animazioni recharts sono guidate via JS (react-smooth), non transizioni
// CSS: la regola @media (prefers-reduced-motion) in globals.css non le
// copre, quindi i grafici Cassa la leggono qui per disattivare isAnimationActive.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return reduced
}
