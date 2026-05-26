import { useState } from 'react'

const SEDE_LAT   = 41.0229839
const SEDE_LNG   = 9.5282387
const RAGGIO_MAX = 100 // metres

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R  = 6_371_000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export type GeofenceStatus = 'idle' | 'checking' | 'inside' | 'outside' | 'denied' | 'unsupported'

export function useGeofence() {
  const [status, setStatus]     = useState<GeofenceStatus>('idle')
  const [distance, setDistance] = useState<number | null>(null)

  function check(): Promise<GeofenceStatus> {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported')
      return Promise.resolve('unsupported')
    }

    setStatus('checking')
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const dist = haversine(pos.coords.latitude, pos.coords.longitude, SEDE_LAT, SEDE_LNG)
          setDistance(dist)
          const s: GeofenceStatus = dist <= RAGGIO_MAX ? 'inside' : 'outside'
          setStatus(s)
          resolve(s)
        },
        err => {
          if (err.code === err.PERMISSION_DENIED) {
            setStatus('denied')
            resolve('denied')
          } else {
            // Timeout or unavailable — treat as unsupported, allow scan
            setStatus('unsupported')
            resolve('unsupported')
          }
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
      )
    })
  }

  return { status, distance, check }
}
