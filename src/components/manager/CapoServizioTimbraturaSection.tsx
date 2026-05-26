'use client'
import { useState, useEffect, useCallback } from 'react'
import { Camera } from 'lucide-react'
import { differenceInSeconds } from 'date-fns'
import { QRScanner } from '@/components/dipendente/QRScanner'
import type { Attendance } from '@/types'

interface Props {
  initialOpenAttendance: Attendance | null
}

function formatDuration(s: number): string {
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}

export function CapoServizioTimbraturaSection({ initialOpenAttendance }: Props) {
  const [attendance, setAttendance] = useState<Attendance | null>(initialOpenAttendance)
  const [showScanner, setShowScanner] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [message, setMessage]         = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [now, setNow]                 = useState(new Date())

  // Tick only while a shift is open
  useEffect(() => {
    if (!attendance) return
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [attendance])

  const elapsed = attendance ? differenceInSeconds(now, new Date(attendance.check_in)) : 0

  const handleScan = useCallback(async (qrSecret: string) => {
    setShowScanner(false)
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_secret: qrSecret, type: attendance ? 'out' : 'in' }),
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

  const isOut = !!attendance

  return (
    <>
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
            onClick={() => setShowScanner(true)}
            disabled={loading}
            className={`h-10 px-4 rounded-sm flex items-center gap-2 text-sm font-semibold border transition-colors disabled:opacity-50 ${
              isOut
                ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600'
                : 'bg-primary hover:bg-primary/90 text-primary-foreground border-primary'
            }`}
          >
            <Camera className="w-4 h-4" />
            {loading ? 'Elaborazione...' : isOut ? 'Timbra Uscita' : 'Timbra Ingresso'}
          </button>
        </div>
      </div>

      {showScanner && (
        <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
      )}
    </>
  )
}
