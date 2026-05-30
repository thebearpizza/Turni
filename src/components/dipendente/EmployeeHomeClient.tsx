'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { QRScanner } from './QRScanner'
import { AbsenceRequestDialog } from './AbsenceRequestDialog'
import { BulletinDrawer } from './BulletinDrawer'
import { LogOut, Camera, UserX, Megaphone, MapPin } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { differenceInSeconds } from 'date-fns'
import { it } from 'date-fns/locale'
import { useRouter } from 'next/navigation'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useGeofence } from '@/hooks/useGeofence'
import { PushNotificationBanner } from '@/components/shared/PushNotificationBanner'
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
  const [now, setNow] = useState(new Date())
  const [attendance, setAttendance] = useState<Attendance | null>(openAttendance)
  const [showScanner, setShowScanner] = useState(false)
  const [showAbsence, setShowAbsence] = useState(false)
  const [showBulletin, setShowBulletin] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const router = useRouter()

  const { permission: pushPermission, subscribe: subscribePush } = usePushNotifications()
  const { status: geoStatus, check: checkGeo, userCoordsRef } = useGeofence()

  // Clock tick
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Unread bulletins badge (count newer than last open)
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
    const restaurantLat = profile.restaurant?.latitude ?? undefined
    const restaurantLng = profile.restaurant?.longitude ?? undefined
    const result = await checkGeo(restaurantLat, restaurantLng)
    if (result === 'outside') {
      setMessage({ text: 'Sei troppo lontano dalla sede per timbrare', type: 'error' })
      return
    }
    if (result === 'denied') {
      setMessage({ text: 'Devi attivare il GPS per timbrare', type: 'error' })
      return
    }
    // 'inside' → allow
    setShowScanner(true)
  }, [checkGeo, profile.restaurant])

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
    } catch {
      setMessage({ text: 'Errore di rete, riprova', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [attendance, router])

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
    <main className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div>
          <p className="text-muted-foreground text-xs capitalize tracking-wide">{dateDisplay}</p>
          <p className="font-semibold text-sm leading-tight">{profile.full_name}</p>
          {profile.restaurant?.name && (
            <p className="text-muted-foreground text-xs">{profile.restaurant.name}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Pulsante Bacheca */}
          <button
            onClick={handleOpenBulletin}
            className="relative w-10 h-10 flex items-center justify-center rounded-md bg-card text-muted-foreground hover:bg-accent hover:text-foreground transition-colors border border-border"
            aria-label="Bacheca"
          >
            <Megaphone className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Pulsante Logout */}
          <button
            onClick={handleLogout}
            className="w-10 h-10 flex items-center justify-center rounded-md bg-card text-muted-foreground hover:bg-accent hover:text-foreground transition-colors border border-border"
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Banner notifiche push */}
      <PushNotificationBanner permission={pushPermission} onSubscribe={subscribePush} />

      {/* Contenuto centrale */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">

        {/* Orologio */}
        <div className="text-center">
          <div className="text-7xl font-mono font-bold tracking-tight tabular-nums leading-none text-foreground">
            {timeDisplay}
          </div>
          {attendance && (
            <div className="mt-5 text-center">
              <p className="text-muted-foreground text-xs uppercase tracking-widest mb-1.5">Turno in corso</p>
              <div className="text-4xl font-mono text-emerald-600 dark:text-emerald-400 tabular-nums font-semibold">
                {formatDuration(elapsedSeconds)}
              </div>
            </div>
          )}
        </div>

        {/* Feedback */}
        {message && (
          <div className={`w-full max-w-xs rounded-md px-4 py-3 text-sm text-center font-medium border ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900'
              : 'bg-destructive/10 text-destructive border-destructive/30'
          }`}>
            {message.text}
          </div>
        )}

        {/* Pulsante QR principale — touch target h-14 mobile */}
        <button
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
        </button>

        {process.env.NODE_ENV === 'development' && (
          <button
            onClick={() => handleScan('__SIMULATE__')}
            disabled={loading}
            className="text-xs text-muted-foreground underline"
          >
            [DEV] Simula Scansione
          </button>
        )}

        {/* Link assenza */}
        <button
          onClick={() => setShowAbsence(true)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
        >
          <UserX className="w-4 h-4" />
          Richiedi Assenza
        </button>
      </div>

      {showScanner && (
        <QRScanner
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}

      {showAbsence && (
        <AbsenceRequestDialog
          userId={userId}
          restaurantId={profile.restaurant_id}
          onClose={() => setShowAbsence(false)}
        />
      )}

      {showBulletin && (
        <BulletinDrawer userId={userId} onClose={() => setShowBulletin(false)} />
      )}
    </main>
  )
}
