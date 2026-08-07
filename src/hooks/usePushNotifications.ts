'use client'
import { useEffect, useState, useCallback } from 'react'

export type PushPermission = 'default' | 'granted' | 'denied' | 'unsupported'

// Registra la subscription push presso il server. Da chiamare SEMPRE, anche
// quando il browser ne ha già una locale: il server può non averla più (viene
// cancellata quando il push service risponde 410 Gone, cosa che capita a ogni
// rotazione dell'endpoint), e in quel caso il browser resterebbe convinto di
// essere iscritto mentre in realtà nessuno può più raggiungerlo. È il motivo
// per cui le notifiche funzionavano solo il primo giorno.
async function registraSubscription(): Promise<boolean> {
  const chiave = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!chiave) {
    console.error('[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY assente: impossibile iscriversi alle notifiche')
    return false
  }

  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chiave }))

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  })

  if (!res.ok) {
    console.error('[push] Il server ha rifiutato la subscription:', res.status, await res.text())
    return false
  }
  return true
}

export function usePushNotifications() {
  const [permission, setPermission] = useState<PushPermission>('default')
  // null finché non lo sappiamo ancora; false = permesso concesso ma questo
  // dispositivo non è raggiungibile, lo stato che prima restava invisibile.
  const [subscribed, setSubscribed] = useState<boolean | null>(null)

  // Leggi stato iniziale e registra SW silenziosamente (senza chiedere permesso)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setPermission('unsupported')
      return
    }
    setPermission(Notification.permission as PushPermission)
    // updateViaCache: 'none' → il browser non usa la cache HTTP per sw.js,
    // così una nuova versione del service worker viene scaricata subito;
    // reg.update() forza il controllo aggiornamenti ad ogni apertura.
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then(reg => reg.update())
      .catch(() => {})

    // Quando un nuovo service worker prende il controllo (dopo un deploy),
    // ricarica la pagina UNA volta così i bundle/dati nuovi vengono caricati
    // subito, senza dover chiudere e riaprire l'app più volte. Ricarichiamo
    // solo se una versione precedente era già al controllo (utente che torna):
    // così evitiamo un reload inutile al primissimo install.
    const hadController = !!navigator.serviceWorker.controller
    let refreshing = false
    const onControllerChange = () => {
      if (refreshing || !hadController) return
      refreshing = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
  }, [])

  // Permesso già concesso (utente che ritorna): riallinea il server a ogni
  // apertura. Costa una POST idempotente e mantiene viva la registrazione
  // anche quando l'endpoint viene ruotato dal browser o dal sistema.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return

    registraSubscription()
      .then(setSubscribed)
      .catch(err => {
        console.error('[push] Riallineamento subscription fallito:', err)
        setSubscribed(false)
      })
  }, [])

  // Chiamato esplicitamente dal click dell'utente sul banner
  const subscribe = useCallback(async () => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm as PushPermission)
      if (perm !== 'granted') return
      setSubscribed(await registraSubscription())
    } catch (err) {
      console.error('[push] Attivazione notifiche fallita:', err)
      setSubscribed(false)
    }
  }, [])

  return { permission, subscribed, subscribe }
}
