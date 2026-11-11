'use client'
import { useState, useEffect, useCallback, useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'
import { QRScanner } from './QRScanner'
import { AbsenceRequestDialog } from './AbsenceRequestDialog'
import { BulletinDrawer } from './BulletinDrawer'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { useRouter } from 'next/navigation'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useGeofence } from '@/hooks/useGeofence'
import { PushNotificationBanner } from '@/components/shared/PushNotificationBanner'
import { compressImage } from '@/lib/compressImage'
import { saveToOfflineQueue, getOfflineQueue } from '@/lib/offlineSync'
import type { Profile, Attendance, Turn } from '@/types'
import { raggruppaPerGiornata, orariGiornata, fineGiornata } from '@/lib/turniGiornata'
import { toast } from '@/hooks/use-toast'
import Link from 'next/link'
import { BloccoTimbratura } from '@/components/timbratura/BloccoTimbratura'

const TZ = 'Europe/Rome'

interface Props {
  profile: Profile & { restaurant?: { id: string; name: string; latitude?: number | null; longitude?: number | null } | null }
  openAttendance: Attendance | null
  userId: string
  turni: Turn[]
  /** Apre subito la bacheca (link delle notifiche: /home?bacheca=1). */
  apriBacheca?: boolean
}

// Stato della rete per la fascia "Offline · N timbrature in coda" (3a).
const iscriviRete = (l: () => void) => {
  window.addEventListener('online', l)
  window.addEventListener('offline', l)
  return () => { window.removeEventListener('online', l); window.removeEventListener('offline', l) }
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

export function EmployeeHomeClient({ profile, openAttendance, userId, turni, apriBacheca = false }: Props) {
  const [now, setNow]             = useState(new Date())
  const [attendance, setAttendance] = useState<Attendance | null>(openAttendance)
  const [showScanner, setShowScanner] = useState(false)
  const [showAbsence, setShowAbsence] = useState(false)
  const [showBulletin, setShowBulletin] = useState(apriBacheca)
  const [loading, setLoading]     = useState(false)
  const [message, setMessage]     = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [gpsFailed, setGpsFailed] = useState(false)
  const router = useRouter()

  const { permission: pushPermission, subscribed: pushSubscribed, subscribe: subscribePush } = usePushNotifications()
  const { status: geoStatus, distance: geoDistanza, check: checkGeo, userCoordsRef } = useGeofence()
  const online = useSyncExternalStore(iscriviRete, () => navigator.onLine, () => true)
  const [inCoda, setInCoda] = useState(0)

  // Timbrature salvate offline ancora da inviare: rilette a intervalli
  // perché la coda la svuota OfflineSyncProvider al ritorno della rete.
  const contaCoda = useCallback(async () => {
    try {
      const q = await getOfflineQueue()
      setInCoda(q.filter(i => i.type === 'clock-in').length)
    } catch { /* IndexedDB non disponibile: niente fascia */ }
  }, [])
  useEffect(() => {
    const t0 = setTimeout(contaCoda, 0)
    const t = setInterval(contaCoda, 4000)
    return () => { clearTimeout(t0); clearInterval(t) }
  }, [contaCoda, online])

  // Il design mostra "Posizione verificata · 24 m dal locale" già prima
  // del tocco: se il permesso è già concesso verifichiamo subito (nessuna
  // richiesta di consenso all'apertura); altrimenti si verifica al tocco.
  useEffect(() => {
    let vivo = true
    navigator.permissions?.query({ name: 'geolocation' as PermissionName })
      .then(p => { if (vivo && p.state === 'granted') checkGeo(profile.restaurant?.latitude, profile.restaurant?.longitude) })
      .catch(() => {})
    return () => { vivo = false }
    // Solo all'apertura: le coordinate del locale non cambiano.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    let lastSeen = '1970-01-01T00:00:00Z'
    try { lastSeen = localStorage.getItem('bulletins_last_seen') ?? lastSeen } catch {}
    const supabase = createClient()
    supabase
      .from('bulletins')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', lastSeen)
      .then(({ count }) => setUnreadCount(count ?? 0))
  }, [])

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
        contaCoda()
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
  }, [attendance, router, userId, profile.restaurant?.id, contaCoda])

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
  const fine = diOggi && !diOggi.riposo ? fineGiornata(diOggi) : null
  const sotto = attendance
    ? `Ingresso ${formatInTimeZone(new Date(attendance.check_in), TZ, 'HH:mm')}${fine ? ` · fine prevista ${fine}` : ''}`
    : diOggi
      ? diOggi.riposo ? 'Oggi riposo' : `Turno di oggi · ${reparto ? reparto + ' ' : ''}${orariGiornata(diOggi)}`
      : 'Nessun turno oggi'

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col pb-6">
      {/* Fascia del design 3a: rete assente o timbrature ancora in coda. */}
      {(!online || inCoda > 0) && (
        <div className="anim-swapin flex h-7 flex-none items-center gap-2 bg-warn-tint px-4 text-xs font-medium text-warn">
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-[oklch(0.52_0.08_75)]" />
          {!online ? 'Offline' : 'In attesa di rete'}
          {inCoda > 0 && ` · ${inCoda === 1 ? '1 timbratura' : `${inCoda} timbrature`} in coda`}
        </div>
      )}

      <PushNotificationBanner permission={pushPermission} subscribed={pushSubscribed} onSubscribe={subscribePush} />

      <BloccoTimbratura
        now={now}
        checkIn={attendance?.check_in ?? null}
        sotto={sotto}
        loading={loading}
        geoStatus={geoStatus}
        distanza={geoDistanza}
        onTimbra={handleScanPress}
        gpsFailed={gpsFailed}
        errore={message?.type === 'error' ? message.text : null}
        onFoto={handleFallbackPhoto}
        onSimula={() => handleScan('__SIMULATE__')}
      />

      <div className="mx-4 mt-6 rounded-[14px] border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
          <span className="text-[15px] font-semibold">Prossimi turni</span>
          {/* Link testuale piccolo per disegno: l'area toccabile è 44px, i margini negativi la tengono dentro la riga. */}
          <Link href="/home/miei-turni" className="-my-3 -mr-3.5 flex h-11 min-w-11 items-center justify-end px-3.5 text-[13px] font-medium text-muted-foreground active:scale-[0.97]">Tutti →</Link>
        </div>
        {prossime.length === 0 ? (
          <div className="flex min-h-12 items-center border-b border-border px-3.5 text-sm text-muted-foreground">Nessun turno programmato</div>
        ) : prossime.map((g, i) => (
          <div
            key={g.date}
            className="grid min-h-12 grid-cols-[72px_1fr_auto] items-center gap-2 border-b border-border px-3.5"
            style={{ animation: 'inrise 600ms cubic-bezier(0.16,1,0.3,1) both', animationDelay: `${i * 70}ms` }}
          >
            <span className="font-mono text-[13px] font-medium capitalize text-muted-foreground">{formatInTimeZone(`${g.date}T12:00:00Z`, TZ, 'EEE d', { locale: it })}</span>
            <span className="font-mono text-[15px] font-medium">{g.riposo ? 'Riposo' : g.fasce[0]}</span>
            <span className="text-xs text-muted-foreground">{g.riposo ? '' : g.spezzato ? 'Spezzato' : g.reparto ?? ''}</span>
          </div>
        ))}
        <button type="button" onClick={() => setShowAbsence(true)} className="flex h-12 w-full items-center gap-2 px-3.5 text-left text-sm font-medium text-muted-foreground active:scale-[0.99]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
          Richiedi assenza
        </button>
      </div>

      {/* I comunicati non hanno una schermata nel design del dipendente: ci
          si arriva dalla campanella (link /home?bacheca=1) o da questa riga,
          che compare solo quando ce ne sono di nuovi. */}
      {unreadCount > 0 && (
        <button
          type="button"
          onClick={handleOpenBulletin}
          className="anim-swapin mx-4 mt-3 flex min-h-[52px] items-center gap-3 rounded-[14px] border border-border bg-card px-3.5 text-left active:scale-[0.99]"
        >
          <span className="h-2 w-2 flex-none rounded-full bg-turni" />
          <span className="flex-1 text-[15px] font-semibold">Bacheca</span>
          <span className="text-[13px] font-medium text-muted-foreground">{unreadCount === 1 ? '1 nuovo comunicato' : `${unreadCount} nuovi comunicati`} →</span>
        </button>
      )}

      {showScanner && <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />}
      {showAbsence && <AbsenceRequestDialog userId={userId} restaurantId={profile.restaurant_id} onClose={() => setShowAbsence(false)} />}
      {showBulletin && (
        <BulletinDrawer
          userId={userId}
          onClose={() => {
            setShowBulletin(false)
            setUnreadCount(0)
            // Aperta dal link della notifica: togliamo ?bacheca=1 così un
            // ricaricamento non la riapre.
            if (apriBacheca) router.replace('/home', { scroll: false })
          }}
        />
      )}
    </div>
  )
}
