'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ShieldAlert, Image as ImageIcon } from 'lucide-react'
import { ApproveRejectButtons } from '@/components/manager/ApproveRejectButtons'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'

const TZ = 'Europe/Rome'
const BUCKET = 'clock_in_proofs'

export interface PendingItem {
  id: string
  user_id: string
  check_in: string
  check_out: string | null
  fallback_photo_path_in: string | null
  fallback_photo_path_out: string | null
  restaurant_id: string | null
  profile?: { full_name: string } | null
  restaurant?: { name: string } | null
}

interface Props {
  initialPending: PendingItem[]
}

export function FallbackApprovalSection({ initialPending }: Props) {
  const [pending, setPending]           = useState(initialPending)
  const [loadingId, setLoadingId]       = useState<string | null>(null)
  const [previewUrl, setPreviewUrl]     = useState<string | null>(null)
  const [previewLoadId, setPreviewLoadId] = useState<string | null>(null)

  async function handleAction(attendanceId: string, action: 'approve' | 'reject') {
    setLoadingId(attendanceId)
    const res = await fetch('/api/presenze/fallback-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendanceId, action }),
    })
    if (res.ok) {
      setPending(prev => prev.filter(p => p.id !== attendanceId))
    }
    setLoadingId(null)
  }

  async function handlePreview(itemId: string, path: string) {
    if (previewLoadId === itemId) return
    setPreviewLoadId(itemId)
    const supabase = createClient()
    const { data } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 300)
    if (data?.signedUrl) setPreviewUrl(data.signedUrl)
    setPreviewLoadId(null)
  }

  if (pending.length === 0) return null

  return (
    <div className="mb-6 border border-amber-200 dark:border-amber-800 rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 border-b border-amber-200 dark:border-amber-800">
        <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          Timbrature di emergenza in attesa ({pending.length})
        </h2>
      </div>

      <div className="divide-y divide-border">
        {pending.map(item => {
          const isWorking    = loadingId === item.id
          const isLoadingPrev = previewLoadId === item.id
          const checkIn  = formatInTimeZone(new Date(item.check_in), TZ, 'dd/MM/yyyy HH:mm', { locale: it })
          // Un turno può avere entrambe le prove (ingresso e uscita entrambi
          // in emergenza): mostrarle come due link distinti invece di uno
          // solo, altrimenti il manager vede solo l'ultima caricata.
          const photos = [
            item.fallback_photo_path_in  && { path: item.fallback_photo_path_in,  label: 'Vedi foto ingresso' },
            item.fallback_photo_path_out && { path: item.fallback_photo_path_out, label: item.fallback_photo_path_in ? 'Vedi foto uscita' : 'Vedi foto' },
          ].filter((p): p is { path: string; label: string } => !!p)
          const checkOut = item.check_out
            ? formatInTimeZone(new Date(item.check_out), TZ, 'HH:mm', { locale: it })
            : null

          return (
            /* ── Mobile: colonna / Desktop: riga ──────────────────────── */
            <div
              key={item.id}
              className="flex flex-col gap-3 px-4 py-4 bg-background
                         md:flex-row md:items-center md:justify-between md:gap-4"
            >
              {/* Info — occupa tutto su mobile, si restringe su desktop */}
              <div className="min-w-0">
                <p className="text-sm font-medium">{item.profile?.full_name ?? '—'}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {item.restaurant?.name && (
                    <span className="mr-2">{item.restaurant.name}</span>
                  )}
                  {checkOut ? `${checkIn} → ${checkOut}` : `Ingresso ${checkIn}`}
                </p>
              </div>

              {/* Azioni — wrap automatico su mobile */}
              <div className="flex flex-wrap items-center gap-2 md:shrink-0">
                {photos.map(p => (
                  <button
                    key={p.path}
                    onClick={() => handlePreview(item.id, p.path)}
                    disabled={isLoadingPrev}
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    {isLoadingPrev ? 'Caricamento...' : p.label}
                  </button>
                ))}

                <ApproveRejectButtons
                  onApprove={() => handleAction(item.id, 'approve')}
                  onReject={() => handleAction(item.id, 'reject')}
                  disabled={isWorking}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Full-screen photo preview overlay */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="relative max-w-lg w-full"
            onClick={e => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Prova di timbratura"
              className="w-full rounded-lg shadow-2xl"
            />
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shadow-lg text-sm font-bold"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
