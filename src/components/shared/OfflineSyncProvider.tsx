'use client'
import { useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'
import {
  getOfflineQueue,
  clearOfflineItem,
  type ClockInPayload,
  type OdsTogglePayload,
} from '@/lib/offlineSync'

// Al ritorno della rete invia la coda offline (timbrature, ODS) e lo dice
// col toast unico del design: verde se è andata, rosso per ciò che è stato
// scartato. Mentre si è offline la striscia "Offline · N azioni in coda"
// la mostra il guscio (shell/StrisciaOffline).
export function OfflineSyncProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()

  const processQueue = useCallback(async () => {
    let queue
    try { queue = await getOfflineQueue() } catch { return }
    if (queue.length === 0) return

    let synced = 0
    let failed = 0

    for (const item of queue) {
      try {
        if (item.type === 'clock-in') {
          const p = item.payload as ClockInPayload
          const res = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              qr_secret: p.qr_secret,
              type:      p.type,
              latitude:  p.latitude,
              longitude: p.longitude,
              accuracy:  p.accuracy,
              frozenAt:  p.frozenAt,
            }),
          })
          // 409 = open shift already esistente — considerato già gestito.
          if (res.ok || res.status === 409) {
            await clearOfflineItem(item.id)
            synced++
          } else if (res.status !== 408 && res.status !== 429 && res.status < 500) {
            // Errore definitivo (es. "nessun turno aperto trovato" per
            // un'uscita, o il ristorante non esiste più): riprovare non
            // lo risolverebbe, e lasciarlo in coda è pericoloso — al primo
            // turno futuro frozenAt verrebbe scritto lì come check_out.
            // Meglio scartarlo e avvisare, che chiudere un turno sbagliato.
            await clearOfflineItem(item.id)
            failed++
          }
          // 408/429/5xx: temporaneo, resta in coda per il prossimo giro.
        } else if (item.type === 'ods-toggle') {
          const p       = item.payload as OdsTogglePayload
          const supabase = createClient()
          if (p.action === 'uncomplete') {
            const { error } = await supabase
              .from('ods_completions')
              .delete()
              .eq('task_id', p.task_id)
              .eq('user_id',  p.user_id)
            if (!error) { await clearOfflineItem(item.id); synced++ }
          } else {
            const { error } = await supabase
              .from('ods_completions')
              .insert({ task_id: p.task_id, user_id: p.user_id, completed_at: p.frozenAt })
            if (!error) { await clearOfflineItem(item.id); synced++ }
          }
        }
      } catch {
        // Network still down for this item — leave in queue for next 'online' event
      }
    }

    if (synced > 0) {
      toast({ title: synced === 1 ? 'Di nuovo online · 1 azione inviata' : `Di nuovo online · ${synced} azioni inviate` })
      // Lo stato di EmployeeHomeClient (presenza offline "provvisoria",
      // liste ODS) va riletto dal server: senza refresh resterebbe
      // agganciato ai dati ottimistici mostrati mentre si era offline.
      router.refresh()
    }
    if (failed > 0) {
      toast({
        title: failed === 1
          ? 'Una timbratura salvata offline non è stata sincronizzata: verificala con il manager.'
          : `${failed} timbrature salvate offline non sono state sincronizzate: verificale con il manager.`,
        variant: 'destructive',
      })
    }
  }, [router])

  useEffect(() => {
    // Flush any queue left from a previous session on first mount
    processQueue()
    window.addEventListener('online', processQueue)
    return () => window.removeEventListener('online', processQueue)
  }, [processQueue])

  return <>{children}</>
}
