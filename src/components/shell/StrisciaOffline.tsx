'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { getOfflineQueue } from '@/lib/offlineSync'

// Fondamenta, decisione 2: offline una striscia sottile sotto la barra in
// alto ("Offline · N azioni in coda"); al ritorno della rete il toast verde
// lo dà OfflineSyncProvider quando la coda è stata inviata.

function iscrivi(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb) }
}

export function StrisciaOffline() {
  const offline = useSyncExternalStore(iscrivi, () => !navigator.onLine, () => false)
  const [inCoda, setInCoda] = useState(0)

  useEffect(() => {
    if (!offline) return
    let vivo = true
    const conta = () => getOfflineQueue().then(q => { if (vivo) setInCoda(q.length) }).catch(() => {})
    conta()
    // Le timbrature e gli ODS messi in coda mentre si è offline.
    const id = setInterval(conta, 3000)
    return () => { vivo = false; clearInterval(id) }
  }, [offline])

  if (!offline) return null
  return (
    <div role="status" className="anim-swapin relative z-[28] mx-4 mb-2.5 flex flex-none items-center gap-2.5 rounded-[8px] border border-border bg-card px-3.5 py-2.5 sm:mx-8">
      <span className="h-2 w-2 flex-none rounded-full bg-warn" />
      <span className="flex-1 text-[13px] font-medium">
        Offline{inCoda > 0 ? ` · ${inCoda} ${inCoda === 1 ? 'azione' : 'azioni'} in coda` : ''}
      </span>
    </div>
  )
}
