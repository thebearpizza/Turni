'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { QRScanner } from './QRScanner'
import { AbsenceRequestDialog } from './AbsenceRequestDialog'
import { BulletinDrawer } from './BulletinDrawer'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { LogOut, Camera, UserX, Megaphone, MapPin, ImageOff } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { differenceInSeconds } from 'date-fns'
import { it } from 'date-fns/locale'
import { useRouter } from 'next/navigation'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useGeofence } from '@/hooks/useGeofence'
import { PushNotificationBanner } from '@/components/shared/PushNotificationBanner'
import { compressImage } from '@/lib/compressImage'
import { saveToOfflineQueue } from '@/lib/offlineSync'
import type { Profile, Attendance } from '@/types'

const TZ = 'Europe/Rome'

interface Props {
  profile: Profile & { restaurant?: { id: string; name: string; latitude?: number | null; longitude?: number | null } | null }
  openAttendance: Attendance | null
  userId: string
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function EmployeeHomeClient({ profile, openAttendance, userId }: Props) {
  const [now, setNow]             = useState(new Date())
  const [attendance, setAttendance] = useState<Attendance | null>(openAttendance)
  const [showScanner, setShowScanner] = useState(false)
  const [showAbsence, setShowAbsence] = useState(false)
  const [showBulletin, setShowBulletin] = useState(false)
  const [loading, setLoading]     = useState(false)
  const [message, setMessage]     = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [gpsFailed, setGpsFailed] = useState(false)
  const router = useRouter()

  const { permission: pushPermission, subscribe: subscribePush } = usePushNotifications()
  const { status: geoStatus, check: checkGeo, userCoordsRef } = useGeofence()

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const lastSeen = localStorage.getItem('bulletins_last_seen') ?? '1970-01-01T00:00:00Z'
    const supabase = createClient()
    supabase
      .from('bulletins')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', lastSeen)
      .then(({ count }) => setUnreadCount(count ?? 0))
  }, [])

  const elapsedSeconds = attendance
    ? differenceInSeconds(now, new Date(attendance.check_in))
    : 0

  // Geofence-aware scan trigger — fail-closed
  const handleScanPress = useCallback(async () => {
    setMessage(null)

    const result = await checkGeo(profile.restaurant?.latitude, profile.restaurant?.longitude)

    if (result === 'outside') {
      setMessage({ text: 'Sei troppo lontano dal ristorante per timbrare', type: 'error' })
      return
    }
    if (result === 'denied' || result === 'unsupported') {
      // Fail-closed: no GPS consent or position unavailable → block
      setMessage({ text: 'Devi attivare il GPS per timbrare', type: 'error' })
      setGpsFailed(true)   // ← fallback only: show photo option
      return
    }
    // 'inside' → allow
    setGpsFailed(false)
    setShowScanner(true)
  }, [checkGeo, profile.restaurant])

  const handleScan = useCallback(async (qrSecret: string) => {
    setShowScanner(false)
    setLoading(true)
    setMessage(null)
    // Freeze timestamp NOW — before any async work — so offline queued items
    // carry the real scan time, not the later sync time.
    const frozenAt = new Date().toISOString()

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qr_secret: qrSecret,
          type:      attendance ? 'out' : 'in',
          latitude:  userCoordsRef.current?.latitude,
          longitude: userCoordsRef.current?.longitude,
          frozenAt,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setMessage({ text: data.error || 'Errore durante la timbratura', type: 'error' })
        return
      }

      if (attendance) {
        setAttendance(null)
        setMessage({ text: 'Uscita registrata con successo', type: 'success' })
      } else {
        setAttendance(data.attendance)
        setMessage({
          text: data.splitShift
            ? 'Turno spezzato registrato — il manager ne sarà informato'
            : 'Entrata registrata con successo',
          type: 'success',
        })
      }
      router.refresh()
    } catch (err) {
      if (err instanceof TypeError) {
        // Network unavailable — persist to IndexedDB queue with the frozen timestamp
        await saveToOfflineQueue('clock-in', {
          qr_secret: qrSecret,
          type:      attendance ? 'out' : 'in',
          latitude:  userCoordsRef.current?.latitude  ?? null,
          longitude: userCoordsRef.current?.longitude ?? null,
          frozenAt,
        }).catch(() => {})
        setMessage({
          text: 'Sei offline. Timbratura salvata sul dispositivo, si aggiornerà automaticamente.',
          type: 'success',
        })
      } else {
        setMessage({ text: 'Errore di rete, riprova', type: 'error' })
      }
    } finally {
      setLoading(false)
    }
  }, [attendance, router])

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
      router.refresh()
    } catch {
      setMessage({ text: 'Errore di rete, riprova', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  function handleOpenBulletin() {
    setShowBulletin(true)
    localStorage.setItem('bulletins_last_seen', new Date().toISOString())
    setUnreadCount(0)
  }

  const timeDisplay = formatInTimeZone(now, TZ, 'HH:mm:ss')
  const dateDisplay = formatInTimeZone(now, TZ, "EEEE d MMMM yyyy", { locale: it })
  const isGeoChecking = geoStatus === 'checking'

  return (
    <main className="h-[calc(100dvh-56px)] overflow-hidden bg-background text-foreground flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div>
          <p className="text-muted-foreground text-xs capitalize tracking-wide">{dateDisplay}</p>
          <p className="font-semibold text-sm leading-tight">{profile.full_name}</p>
          {profile.restaurant?.name && (
            <p className="text-muted-foreground text-xs">{profile.restaurant.name}</p>
          )}
        </div>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            onClick={handleOpenBulletin}
            className="relative w-9 h-9 flex items-center justify-center rounded-md bg-card text-muted-foreground hover:bg-accent hover:text-foreground transition-colors border border-border"
            aria-label="Bacheca"
          >
            <Megaphone className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <button
            onClick={handleLogout}
            className="w-9 h-9 flex items-center justify-center rounded-md bg-card text-muted-foreground hover:bg-accent hover:text-foreground transition-colors border border-border"
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      <PushNotificationBanner permission={pushPermission} onSubscribe={subscribePush} />

      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">

        {/* Clock */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-center"
        >
          <div className="text-7xl font-mono font-bold tracking-tight tabular-nums leading-none text-foreground">
            {timeDisplay}
          </div>
          <AnimatePresence>
            {attendance && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
                className="mt-5 text-center overflow-hidden"
              >
                <p className="text-muted-foreground text-xs uppercase tracking-widest mb-1.5">Turno in corso</p>
                <div className="text-4xl font-mono text-emerald-600 dark:text-emerald-400 tabular-nums font-semibold">
                  {formatDuration(elapsedSeconds)}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Feedback messages */}
        <AnimatePresence mode="wait">
          {message && (
            <motion.div
              key={message.text}
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.2 }}
              className={`w-full max-w-xs rounded-md px-4 py-3 text-sm text-center font-medium border ${
                message.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900'
                  : 'bg-destructive/10 text-destructive border-destructive/30'
              }`}
            >
              {message.text}
            </motion.div>
          )}
        </AnimatePresence>

        {/* QR scan button */}
        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleScanPress}
          disabled={loading || isGeoChecking}
          className={`w-full max-w-xs h-14 rounded-md flex items-center justify-center gap-3 text-base font-semibold border transition-colors active:scale-[0.98] disabled:opacity-50 ${
            attendance
              ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600'
              : 'bg-primary hover:bg-primary/90 text-primary-foreground border-primary'
          }`}
        >
          {isGeoChecking
            ? <><MapPin className="w-5 h-5 animate-pulse" /> Verifica posizione...</>
            : loading
            ? 'Elaborazione...'
            : <><Camera className="w-5 h-5" />{attendance ? 'Scansiona Uscita' : 'Scansiona Ingresso'}</>
          }
        </motion.button>

        {process.env.NODE_ENV === 'development' && (
          <button
            onClick={() => handleScan('__SIMULATE__')}
            disabled={loading}
            className="text-xs text-muted-foreground underline"
          >
            [DEV] Simula Scansione
          </button>
        )}

        {/* GPS fallback — shown only when GPS denied/unavailable */}
        {gpsFailed && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-xs"
          >
            <label className={`w-full h-11 rounded-md flex items-center justify-center gap-2.5 text-sm font-medium border cursor-pointer transition-colors
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
            <p className="text-[10px] text-muted-foreground text-center mt-1">
              La timbratura sarà confermata dal Manager
            </p>
          </motion.div>
        )}

        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          onClick={() => setShowAbsence(true)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
        >
          <UserX className="w-4 h-4" />
          Richiedi Assenza
        </motion.button>
      </div>

      {showScanner && <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />}
      {showAbsence && <AbsenceRequestDialog userId={userId} restaurantId={profile.restaurant_id} onClose={() => setShowAbsence(false)} />}
      {showBulletin && <BulletinDrawer userId={userId} onClose={() => setShowBulletin(false)} />}
    </main>
  )
}
