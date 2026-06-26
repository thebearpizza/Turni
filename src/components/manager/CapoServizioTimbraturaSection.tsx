'use client'
import { useState, useEffect, useCallback } from 'react'
import { Camera, ImageOff } from 'lucide-react'
import { differenceInSeconds } from 'date-fns'
import { QRScanner } from '@/components/dipendente/QRScanner'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useGeofence } from '@/hooks/useGeofence'
import { PushNotificationBanner } from '@/components/shared/PushNotificationBanner'
import { compressImage } from '@/lib/compressImage'
import type { Attendance } from '@/types'

interface Props {
  initialOpenAttendance: Attendance | null
  restaurantLat?: number | null
  restaurantLng?: number | null
}

function formatDuration(s: number): string {
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}

export function CapoServizioTimbraturaSection({ initialOpenAttendance, restaurantLat, restaurantLng }: Props) {
  const [attendance, setAttendance] = useState<Attendance | null>(initialOpenAttendance)
  const [showScanner, setShowScanner] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [message, setMessage]         = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [now, setNow]                 = useState(new Date())
  const [gpsFailed, setGpsFailed]     = useState(false)
  const { status: geoStatus, check: checkGeo, userCoordsRef } = useGeofence()

  // Tick only while a shift is open
  useEffect(() => {
    if (!attendance) return
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [attendance])

  const elapsed = attendance ? differenceInSeconds(now, new Date(attendance.check_in)) : 0

  // Geofence-aware scan trigger — fail-closed
  const handleScanPress = useCallback(async () => {
    setMessage(null)
    const result = await checkGeo(restaurantLat, restaurantLng)
    if (result === 'outside') {
      // Parachute: a weak indoor GPS fix can read "too far" even when inside.
      setMessage({ text: 'Posizione troppo lontana. Se sei nel locale, timbra con la foto.', type: 'error' })
      setGpsFailed(true)
      return
    }
    if (result === 'denied' || result === 'unsupported') {
      setMessage({ text: 'Impossibile verificare il GPS. Se sei nel locale, timbra con la foto.', type: 'error' })
      setGpsFailed(true)   // ← fallback only: show photo option
      return
    }
    setGpsFailed(false)
    setShowScanner(true)
  }, [checkGeo, restaurantLat, restaurantLng])

  const handleScan = useCallback(async (qrSecret: string) => {
    setShowScanner(false)
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qr_secret: qrSecret,
          type: attendance ? 'out' : 'in',
          latitude: userCoordsRef.current?.latitude,
          longitude: userCoordsRef.current?.longitude,
          accuracy: userCoordsRef.current?.accuracy,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ text: data.error ?? 'Errore durante la timbratura', type: 'error' })
        return
      }
      if (attendance) {
        setAttendance(null)
        setMessage({ text: 'Uscita registrata con successo', type: 'success' })
      } else {
        setAttendance(data.attendance)
        setMessage({
          text: data.splitShift ? 'Turno spezzato registrato' : 'Entrata registrata con successo',
          type: 'success',
        })
      }
    } catch {
      setMessage({ text: 'Errore di rete, riprova', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [attendance])

  async function handleFallbackPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const photo = e.target.files?.[0]
    if (!photo) return
    e.target.value = ''
    setLoading(true)
    setMessage(null)
    try {
      // Compress to max 800 px / 70 % quality before upload (~200 KB target)
      let compressed = photo
      try { compressed = await compressImage(photo, 800, 0.7) } catch { /* fallback to original */ }

      const fd = new FormData()
      fd.append('photo', compressed)
      fd.append('type', attendance ? 'out' : 'in')
      const res = await fetch('/api/clock-in-fallback', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ text: data.error ?? 'Errore timbratura di emergenza', type: 'error' })
        return
      }
      if (attendance) {
        setAttendance(null)
      } else {
        setAttendance(data.attendance)
      }
      setGpsFailed(false)
      setMessage({ text: 'Timbratura registrata. In attesa di conferma dal Manager.', type: 'success' })
    } catch {
      setMessage({ text: 'Errore di rete, riprova', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const { permission: pushPermission, subscribe: subscribePush } = usePushNotifications()
  const isOut = !!attendance
  const isGeoChecking = geoStatus === 'checking'

  return (
    <>
      <PushNotificationBanner permission={pushPermission} onSubscribe={subscribePush} />
      <div className="mt-4 bg-card border border-border rounded-md p-4 flex items-center gap-4">
        {/* Left: label + status */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold tracking-tight">Timbratura Presenza</p>

          {attendance ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
              Turno in corso · {formatDuration(elapsed)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-0.5">Nessun turno aperto</p>
          )}

          {message && (
            <p className={`text-xs mt-1 font-medium ${
              message.type === 'success'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-destructive'
            }`}>
              {message.text}
            </p>
          )}
        </div>

        {/* Right: action button */}
        <div className="flex items-center gap-2 shrink-0">
          {process.env.NODE_ENV === 'development' && (
            <button
              onClick={() => handleScan('__SIMULATE__')}
              disabled={loading}
              className="text-xs text-muted-foreground underline disabled:opacity-50"
            >
              [DEV]
            </button>
          )}
          <button
            onClick={handleScanPress}
            disabled={loading || isGeoChecking}
            className={`h-10 px-4 rounded-sm flex items-center gap-2 text-sm font-semibold border transition-colors disabled:opacity-50 ${
              isOut
                ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600'
                : 'bg-primary hover:bg-primary/90 text-primary-foreground border-primary'
            }`}
          >
            <Camera className="w-4 h-4" />
            {isGeoChecking ? 'Verifica posizione...' : loading ? 'Elaborazione...' : isOut ? 'Timbra Uscita' : 'Timbra Ingresso'}
          </button>
        </div>
      </div>

      {/* GPS fallback — shown only when GPS denied/unavailable */}
      {gpsFailed && (
        <label className={`mt-2 flex items-center gap-2.5 justify-center h-10 px-4 rounded-sm text-sm font-medium border cursor-pointer transition-colors
          ${loading ? 'opacity-50 pointer-events-none' : ''}
          border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100
          dark:border-amber-600 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50`}
        >
          <ImageOff className="w-4 h-4 shrink-0" />
          Problemi col GPS? Timbra con foto
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handleFallbackPhoto}
            disabled={loading}
          />
        </label>
      )}

      {showScanner && (
        <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
      )}
    </>
  )
}
