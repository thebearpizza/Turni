'use client'
import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import {
  getOfflineQueue,
  clearOfflineItem,
  type ClockInPayload,
  type OdsTogglePayload,
} from '@/lib/offlineSync'

type Toast = { text: string; type: 'success' | 'info' }

export function OfflineSyncProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)

  function flash(text: string, type: Toast['type'] = 'success') {
    setToast({ text, type })
    setTimeout(() => setToast(null), 5000)
  }

  const processQueue = useCallback(async () => {
    let queue
    try { queue = await getOfflineQueue() } catch { return }
    if (queue.length === 0) return

    let synced = 0

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
          // 409 = open shift already exists — consider it handled
          if (res.ok || res.status === 409) {
            await clearOfflineItem(item.id)
            synced++
          }
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

    if (synced > 0) flash('Dati offline sincronizzati con successo!')
  }, [])

  useEffect(() => {
    // Flush any queue left from a previous session on first mount
    processQueue()
    window.addEventListener('online', processQueue)
    return () => window.removeEventListener('online', processQueue)
  }, [processQueue])

  return (
    <>
      {children}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.text}
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{    opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-4 py-3 rounded-md text-sm font-medium border shadow-lg max-w-xs w-[calc(100%-2rem)] text-center pointer-events-none ${
              toast.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900'
                : 'bg-primary/10 text-primary border-primary/30'
            }`}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
