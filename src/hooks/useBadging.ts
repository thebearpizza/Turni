import { useEffect } from 'react'

type BadgingNavigator = Navigator & {
  setAppBadge?(count?: number): Promise<void>
  clearAppBadge?(): Promise<void>
}

export function useBadging(count: number) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const nav = navigator as BadgingNavigator
    if (!nav.setAppBadge) return
    if (count > 0) {
      nav.setAppBadge(count).catch(() => {})
    } else {
      nav.clearAppBadge?.().catch(() => {})
    }
  }, [count])
}
