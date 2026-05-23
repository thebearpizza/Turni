'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { QRScanner } from './QRScanner'
import { AbsenceRequestDialog } from './AbsenceRequestDialog'
import { Button } from '@/components/ui/button'
import { LogOut, Camera, Clock, UserX } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { differenceInSeconds } from 'date-fns'
import { useRouter } from 'next/navigation'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import type { Profile, Attendance } from '@/types'

const TZ = 'Europe/Rome'

interface Props {
  profile: Profile & { restaurant?: { id: string; name: string } | null }
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
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const router = useRouter()

  usePushNotifications()

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const elapsedSeconds = attendance
    ? differenceInSeconds(now, new Date(attendance.check_in))
    : 0

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
        setMessage({ text: 'Entrata registrata con successo', type: 'success' })
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

  const timeDisplay = formatInTimeZone(now, TZ, 'HH:mm:ss')
  const dateDisplay = formatInTimeZone(now, TZ, "EEEE d MMMM yyyy")

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pt-safe">
        <div>
          <p className="text-slate-400 text-sm capitalize">{dateDisplay}</p>
          <p className="font-semibold">{profile.full_name}</p>
        </div>
        <button
          onClick={handleLogout}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
          aria-label="Logout"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {/* Orologio grande */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6">
        <div className="text-center">
          <div className="text-7xl font-mono font-bold tracking-tight tabular-nums">
            {timeDisplay}
          </div>
          {attendance && (
            <div className="mt-4 text-center">
              <p className="text-slate-400 text-sm mb-1">Turno in corso</p>
              <div className="text-3xl font-mono text-emerald-400 tabular-nums">
                {formatDuration(elapsedSeconds)}
              </div>
            </div>
          )}
        </div>

        {/* Messaggio feedback */}
        {message && (
          <div className={`w-full max-w-xs rounded-xl px-4 py-3 text-sm text-center font-medium ${
            message.type === 'success'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}>
            {message.text}
          </div>
        )}

        {/* Pulsante principale QR */}
        <button
          onClick={() => setShowScanner(true)}
          disabled={loading}
          className={`w-full max-w-xs py-5 rounded-2xl flex items-center justify-center gap-3 text-lg font-semibold transition-all active:scale-95 ${
            attendance
              ? 'bg-amber-500 hover:bg-amber-400 text-black'
              : 'bg-emerald-500 hover:bg-emerald-400 text-black'
          } disabled:opacity-50`}
        >
          <Camera className="w-6 h-6" />
          {loading
            ? 'Elaborazione...'
            : attendance
            ? 'Scansiona Uscita'
            : 'Scansiona Ingresso'}
        </button>

        {/* In development: simula scansione */}
        {process.env.NODE_ENV === 'development' && (
          <button
            onClick={() => handleScan('__SIMULATE__')}
            disabled={loading}
            className="text-xs text-slate-600 underline"
          >
            [DEV] Simula Scansione
          </button>
        )}

        {/* Pulsante assenza */}
        <button
          onClick={() => setShowAbsence(true)}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-300 transition-colors text-sm"
        >
          <UserX className="w-4 h-4" />
          Richiedi Assenza
        </button>
      </div>

      {/* Scanner QR */}
      {showScanner && (
        <QRScanner
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Dialog assenza */}
      {showAbsence && (
        <AbsenceRequestDialog
          userId={userId}
          restaurantId={profile.restaurant_id}
          onClose={() => setShowAbsence(false)}
        />
      )}
    </main>
  )
}
