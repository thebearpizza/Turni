'use client'
import { useEffect, useRef } from 'react'

// Throttle: fire at most once every 3 minutes.
// Listens to mousemove, keydown, touchstart — stops updating when the user is idle.
const THROTTLE_MS = 3 * 60 * 1000

export function useActivityTracker() {
  const lastFiredRef = useRef<number>(0)

  useEffect(() => {
    function handleActivity() {
      const now = Date.now()
      if (now - lastFiredRef.current < THROTTLE_MS) return
      lastFiredRef.current = now
      fetch('/api/activity', { method: 'POST' }).catch(() => undefined)
    }

    const opts = { passive: true } as AddEventListenerOptions
    window.addEventListener('mousemove', handleActivity, opts)
    window.addEventListener('keydown',   handleActivity, opts)
    window.addEventListener('touchstart', handleActivity, opts)

    // Ping on mount so last_active_at is set immediately on page load
    handleActivity()

    return () => {
      window.removeEventListener('mousemove', handleActivity)
      window.removeEventListener('keydown',   handleActivity)
      window.removeEventListener('touchstart', handleActivity)
    }
  }, [])
}
