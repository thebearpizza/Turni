'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { QRScanner } from './QRScanner'
import { AbsenceRequestDialog } from './AbsenceRequestDialog'
import { BulletinDrawer } from './BulletinDrawer'
import { formatInTimeZone } from 'date-fns-tz'
import { differenceInSeconds } from 'date-fns'
import { it } from 'date-fns/locale'
import { useRouter } from 'next/navigation'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useGeofence } from '@/hooks/useGeofence'
import { PushNotificationBanner } from '@/components/shared/PushNotificationBanner'
import { compressImage } from '@/lib/compressImage'
import { saveToOfflineQueue } from '@/lib/offlineSync'
import type { Profile, Attendance, Turn } from '@/types'
import { raggruppaPerGiornata } from '@/lib/turniGiornata'
import { toast } from '@/hooks/use-toast'
import Link from 'next/link'

const TZ = 'Europe/Rome'

interface Props {
  profile: Profile & { restaurant?: { id: string; name: string; latitude?: number | null; longitude?: number | null } | null }
  openAttendance: Attendance | null
  userId: string
  turni: Turn[]
}

// Un TypeError generico può derivare da un bug (es. accesso a proprietà di
// null) tanto quanto da una fetch fallita per assenza di rete. Solo il
// secondo caso deve attivare la coda offline: i browser usano un messaggio
// riconoscibile per gli errori di rete veri ("Failed to fetch" su Chrome/
// Edge, "NetworkError..." su Firefox, "Load failed" su Safari).
function isNetworkError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false
  const msg = err.message.toLowerCase()
  return msg.includes('fetch') || msg.includes('network') || msg.includes('load failed')
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function EmployeeHomeClient({ profile, openAttendance, userId, turni }: Props) {
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

  const { permission: pushPermission, subscribed: pushSubscribed, subscribe: subscribePush } = usePushNotifications()
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
      // Parachute: GPS may read "too far" even when the employee is inside
      // (weak indoor signal). Offer the photo proof, same as a missing fix.
      setMessage({ text: 'Posizione troppo lontana. Se sei nel locale, timbra con la foto.', type: 'error' })
      setGpsFailed(true)
      return
    }
    if (result === 'denied' || result === 'unsupported') {
      // Fail-closed: no GPS consent or position unavailable → block
      setMessage({ text: 'Impossibile verificare il GPS. Se sei nel locale, timbra con la foto.', type: 'error' })
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
          accuracy:  userCoordsRef.current?.accuracy,
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
      if (isNetworkError(err)) {
        // Network unavailable — persist to IndexedDB queue with the frozen timestamp
        try {
          await saveToOfflineQueue('clock-in', {
            qr_secret: qrSecret,
            type:      attendance ? 'out' : 'in',
            latitude:  userCoordsRef.current?.latitude  ?? null,
            longitude: userCoordsRef.current?.longitude ?? null,
            accuracy:  userCoordsRef.current?.accuracy  ?? null,
            frozenAt,
          })
        } catch {
          setMessage({ text: 'Impossibile salvare la timbratura offline. Riprova.', type: 'error' })
          return
        }
        // Rispecchia lo stato che avrebbe la timbratura online, così il
        // pulsante propone subito 'Scansiona Uscita' e il cronometro parte —
        // altrimenti, restando offline, un secondo tocco manderebbe in coda
        // un'altra entrata invece dell'uscita.
        if (attendance) {
          setAttendance(null)
        } else {
          setAttendance({
            id: `offline-${frozenAt}`,
            user_id: userId,
            restaurant_id: profile.restaurant?.id ?? null,
            check_in: frozenAt,
            check_out: null,
            is_split_shift: false,
            notes: null,
            fallback_photo_path_in: null,
            fallback_photo_path_out: null,
            needs_manager_approval: false,
            created_at: frozenAt,
            updated_at: frozenAt,
          })
        }
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
  }, [attendance, router, userId, profile.restaurant?.id])

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

  function handleOpenBulletin() {
    setShowBulletin(true)
    localStorage.setItem('bulletins_last_seen', new Date().toISOString())
    setUnreadCount(0)
  }

  // Regola unica del design: ogni azione che invia dati mostra il toast
  // (nero, in basso). Il messaggio resta anche sotto il pulsante quando
  // serve un'azione (es. GPS fuori zona → foto).
  useEffect(() => {
    if (!message) return
    toast({ title: message.text, variant: message.type === 'error' ? 'destructive' : 'default' })
  }, [message])

  const oggiStr = formatInTimeZone(now, TZ, 'yyyy-MM-dd')
  const giornate = raggruppaPerGiornata(turni)
  const diOggi = giornate.find(g => g.date === oggiStr)
  const prossime = giornate.filter(g => g.date > oggiStr).slice(0, 3)
  const reparto = diOggi?.reparto ?? profile.department ?? ''
  const isGeoChecking = geoStatus === 'checking'

  const sotto = attendance
    ? `Ingresso ${formatInTimeZone(new Date(attendance.check_in), TZ, 'HH:mm')}${diOggi && !diOggi.riposo ? ` · fine prevista ${diOggi.fasce[diOggi.fasce.length - 1].split('–')[1]}` : ''}`
    : diOggi
      ? diOggi.riposo ? 'Oggi riposo' : `Turno di oggi · ${reparto ? reparto + ' ' : ''}${diOggi.fasce.join(' / ').replace(/–/g, ' – ')}`
      : 'Nessun turno oggi'

  const ICONA_INGRESSO = 'M141.66,133.66l-40,40a8,8,0,0,1-11.32-11.32L116.69,136H24a8,8,0,0,1,0-16h92.69L90.34,93.66a8,8,0,0,1,11.32-11.32l40,40A8,8,0,0,1,141.66,133.66ZM200,32H136a8,8,0,0,0,0,16h56V208H136a8,8,0,0,0,0,16h64a8,8,0,0,0,8-8V40A8,8,0,0,0,200,32Z'
  const ICONA_USCITA = 'M120,216a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V40a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H56V208h56A8,8,0,0,1,120,216Zm109.66-93.66-40-40a8,8,0,0,0-11.32,11.32L204.69,120H112a8,8,0,0,0,0,16h92.69l-26.35,26.34a8,8,0,0,0,11.32,11.32l40-40A8,8,0,0,0,229.66,122.34Z'

  return (
    <div className="flex flex-col pb-6">
      <PushNotificationBanner permission={pushPermission} subscribed={pushSubscribed} onSubscribe={subscribePush} />

      <div className="flex flex-col items-center gap-1.5 px-5 pt-8">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[1px] text-muted-foreground">
          {attendance ? 'In servizio da' : formatInTimeZone(now, TZ, 'EEEE d MMMM', { locale: it })}
        </span>
        <span className="font-mono text-[64px] font-medium leading-none tracking-[-2px] tabular-nums">
          {attendance ? formatDuration(elapsedSeconds).replace(/^0(\d)/, '$1') : formatInTimeZone(now, TZ, 'HH:mm')}
        </span>
        <span className="flex items-center gap-2 text-[15px] text-muted-foreground">
          <span className={`h-2 w-2 rounded-full ${attendance ? 'animate-pulse bg-[oklch(0.55_0.1_150)]' : 'bg-line-strong'}`} />
          {sotto}
        </span>
      </div>

      <div className="flex flex-col gap-2.5 px-4 pt-7">
        <button
          type="button"
          onClick={handleScanPress}
          disabled={loading || isGeoChecking}
          className={`flex h-16 items-center justify-center gap-2.5 rounded-[8px] text-lg font-semibold transition-transform active:scale-[0.98] disabled:opacity-60 ${
            attendance ? 'border-[1.5px] border-primary bg-card text-foreground' : 'bg-primary text-primary-foreground'
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 256 256" fill="currentColor" aria-hidden><path d={attendance ? ICONA_USCITA : ICONA_INGRESSO} /></svg>
          {isGeoChecking ? 'Verifica posizione…' : loading ? 'Invio in corso…' : attendance ? 'Timbra uscita' : 'Timbra ingresso'}
        </button>
        <span className="text-center text-xs text-muted-foreground">
          {geoStatus === 'inside' ? 'Posizione verificata' : isGeoChecking ? 'Verifica della posizione in corso' : 'La posizione si verifica quando timbri'}
        </span>

        {process.env.NODE_ENV === 'development' && (
          <button onClick={() => handleScan('__SIMULATE__')} disabled={loading} className="text-xs text-muted-foreground underline">
            [DEV] Simula Scansione
          </button>
        )}

        {gpsFailed && (
          <div className="anim-swapin flex flex-col gap-1.5">
            {message?.type === 'error' && <p className="text-center text-sm font-medium text-neg">{message.text}</p>}
            <label className={`flex h-12 cursor-pointer items-center justify-center gap-2.5 rounded-[8px] border border-line-strong bg-card text-[15px] font-semibold active:scale-[0.98] ${loading ? 'pointer-events-none opacity-50' : ''}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              Timbra con foto
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleFallbackPhoto} disabled={loading} />
            </label>
            <p className="text-center text-xs text-muted-foreground">La timbratura sarà confermata dal manager</p>
          </div>
        )}
      </div>

      {/* I comunicati restano raggiungibili da qui: compaiono solo se ce
          ne sono di nuovi (le notifiche li segnalano anche nella campanella). */}
      {unreadCount > 0 && (
        <button
          type="button"
          onClick={handleOpenBulletin}
          className="anim-swapin mx-4 mt-6 flex items-center gap-3 rounded-[14px] border border-border bg-card px-3.5 py-3 text-left active:scale-[0.99]"
        >
          <span className="flex-1 text-[15px] font-semibold">Bacheca</span>
          <span className="text-[13px] text-muted-foreground">{unreadCount === 1 ? '1 nuovo comunicato' : `${unreadCount} nuovi comunicati`} →</span>
        </button>
      )}

      <div className="mx-4 mt-6 rounded-[14px] border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
          <span className="text-[15px] font-semibold">Prossimi turni</span>
          <Link href="/home/miei-turni" className="text-[13px] font-medium text-muted-foreground">Tutti →</Link>
        </div>
        {prossime.length === 0 ? (
          <div className="border-b border-border px-3.5 py-3.5 text-sm text-muted-foreground">Nessun turno programmato</div>
        ) : prossime.map((g, i) => (
          <div key={g.date} className="anim-inrise grid min-h-12 grid-cols-[72px_1fr_auto] items-center gap-2 border-b border-border px-3.5" style={{ animationDelay: `${i * 70}ms` }}>
            <span className="font-mono text-[13px] font-medium capitalize text-muted-foreground">{formatInTimeZone(`${g.date}T12:00:00Z`, TZ, 'EEE d', { locale: it })}</span>
            <span className="font-mono text-[15px] font-medium">{g.riposo ? 'Riposo' : g.fasce[0]}</span>
            <span className="text-xs text-muted-foreground">{g.riposo ? '' : g.spezzato ? 'Spezzato' : g.reparto ?? ''}</span>
          </div>
        ))}
        <button type="button" onClick={() => setShowAbsence(true)} className="flex h-12 w-full items-center px-3.5 text-left text-sm font-medium text-muted-foreground active:scale-[0.99]">
          + Richiedi assenza
        </button>
      </div>

      {showScanner && <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />}
      {showAbsence && <AbsenceRequestDialog userId={userId} restaurantId={profile.restaurant_id} onClose={() => setShowAbsence(false)} />}
      {showBulletin && <BulletinDrawer userId={userId} onClose={() => setShowBulletin(false)} />}
    </div>
  )
}
