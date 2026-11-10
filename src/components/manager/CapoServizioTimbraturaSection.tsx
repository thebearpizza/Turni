'use client'
import { useState, useEffect, useCallback } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { QRScanner } from '@/components/dipendente/QRScanner'
import { useGeofence } from '@/hooks/useGeofence'
import { toast } from '@/hooks/use-toast'
import { BloccoTimbratura } from '@/components/timbratura/BloccoTimbratura'
import { compressImage } from '@/lib/compressImage'
import type { Attendance } from '@/types'

interface Props {
  initialOpenAttendance: Attendance | null
  restaurantLat?: number | null
  restaurantLng?: number | null
  /** "grande" per il capo servizio (come il dipendente), "compatta" per il direttore. */
  variante?: 'grande' | 'compatta'
  /** Riga sotto l'ora (turno di oggi), per la variante grande. */
  turnoOggi?: string
}

export function CapoServizioTimbraturaSection({ initialOpenAttendance, restaurantLat, restaurantLng, variante = 'grande', turnoOggi }: Props) {
  const [attendance, setAttendance] = useState<Attendance | null>(initialOpenAttendance)
  const [showScanner, setShowScanner] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [message, setMessage]         = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [now, setNow]                 = useState(new Date())
  const [gpsFailed, setGpsFailed]     = useState(false)
  const { status: geoStatus, distance, check: checkGeo, userCoordsRef } = useGeofence()

  // L'ora (o il tempo in servizio) avanza ogni secondo.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Esiti nel toast unico del design.
  useEffect(() => {
    if (message) toast({ title: message.text, variant: message.type === 'error' ? 'destructive' : 'default' })
  }, [message])

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
  }, [attendance, userCoordsRef])

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

  const sotto = attendance
    ? `Ingresso ${formatInTimeZone(new Date(attendance.check_in), 'Europe/Rome', 'HH:mm')}`
    : turnoOggi ?? 'Nessun turno oggi'

  return (
    <>
      <BloccoTimbratura
        now={now}
        checkIn={attendance?.check_in ?? null}
        sotto={sotto}
        loading={loading}
        geoStatus={geoStatus}
        onTimbra={handleScanPress}
        gpsFailed={gpsFailed}
        errore={message?.type === 'error' ? message.text : null}
        onFoto={handleFallbackPhoto}
        variante={variante}
        onSimula={() => handleScan('__SIMULATE__')}
        distanza={distance}
      />
      {showScanner && <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />}
    </>
  )
}
