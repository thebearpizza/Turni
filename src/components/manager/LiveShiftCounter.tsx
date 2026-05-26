'use client'
import { useState, useEffect } from 'react'
import { differenceInMinutes } from 'date-fns'

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

interface Props {
  checkInTime: string
  baseMinutes?: number
}

export function LiveShiftCounter({ checkInTime, baseMinutes = 0 }: Props) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const elapsed = Math.max(0, differenceInMinutes(now, new Date(checkInTime)))
  return <>{formatDuration(baseMinutes + elapsed)}</>
}
