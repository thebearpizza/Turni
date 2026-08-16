'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const REFRESH_MARGIN_MS = 5 * 60 * 1000

// Sui tablet di cassa/manager la sessione resta aperta per settimane — se il
// tab passa ore in background (schermo spento, PWA sospesa su iOS), il timer
// di refresh automatico di supabase-js può non scattare in tempo: al ritorno
// in primo piano il token è scaduto, ma la pagina resta visivamente
// "loggata". Le letture falliscono in silenzio (nessun dato, nessun errore
// visibile) e il primo segnale reale arriva solo alla prima scrittura, con
// un errore RLS incomprensibile per chi usa l'app (vedi friendlyError.ts).
// Qui si forza un refresh esplicito ogni volta che il tab torna in primo
// piano, se il token è vicino alla scadenza o già scaduto; se anche il
// refresh fallisce (sessione davvero non recuperabile), si manda l'utente
// al login con un messaggio chiaro invece di lasciarlo bloccato in silenzio.
export function SessionGuardian() {
  const router = useRouter()
  const checking = useRef(false)

  useEffect(() => {
    async function checkSession() {
      if (checking.current) return
      checking.current = true
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const expiresAtMs = (session.expires_at ?? 0) * 1000
        if (expiresAtMs - Date.now() > REFRESH_MARGIN_MS) return

        const { error } = await supabase.auth.refreshSession()
        if (error) router.push('/login?sessione_scaduta=1')
      } finally {
        checking.current = false
      }
    }

    checkSession()

    function onVisible() {
      if (document.visibilityState === 'visible') checkSession()
    }

    window.addEventListener('focus', checkSession)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', checkSession)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [router])

  return null
}
