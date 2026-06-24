import { useRef, useState } from 'react'

const RAGGIO_MAX = 100 // metres

// Indoors the GPS signal is weak and the device falls back to Wi-Fi/cell
// positioning, which reports a position with a large uncertainty radius
// (`coords.accuracy`). Ignoring that radius is what makes a person standing
// *inside* the restaurant read as "too far". We treat the timbratura as valid
// when the geofence circle and the GPS uncertainty circle overlap — i.e. the
// reported distance, minus the accuracy radius, is still within RAGGIO_MAX.
// The buffer is capped so a hopeless fix (accuracy of several km) can't let
// someone timbrare from anywhere.
const ACCURACY_BUFFER_MAX = 250 // metres

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
  // Last device coordinates obtained — forwarded to the server for validation
  const userCoordsRef = useRef<{ latitude: number; longitude: number; accuracy: number | null } | null>(null)

  function check(restaurantLat?: number | null, restaurantLng?: number | null): Promise<GeofenceStatus> {
    // Fail-closed: no geolocation API → block the action
    if (!('geolocation' in navigator)) {
      setStatus('denied')
      return Promise.resolve('denied')
    }

    setStatus('checking')
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        pos => {
          userCoordsRef.current = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
          }

          if (restaurantLat != null && restaurantLng != null) {
            const dist = haversine(pos.coords.latitude, pos.coords.longitude, restaurantLat, restaurantLng)
            setDistance(dist)
            // Give credit for GPS uncertainty (capped) so a weak indoor fix
            // doesn't reject someone who is actually inside.
            const buffer = Math.min(pos.coords.accuracy ?? 0, ACCURACY_BUFFER_MAX)
            const s: GeofenceStatus = dist <= RAGGIO_MAX + buffer ? 'inside' : 'outside'
            setStatus(s)
            resolve(s)
          } else {
            // No restaurant coordinates configured — position obtained, allow
            setDistance(null)
            setStatus('inside')
            resolve('inside')
          }
        },
        () => {
          // Fail-closed: permission denied, timeout, or position unavailable
          // all block the scan.
          setStatus('denied')
          resolve('denied')
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
      )
    })
  }

  return { status, distance, check, userCoordsRef }
}
