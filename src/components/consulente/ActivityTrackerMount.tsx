'use client'
import { useActivityTracker } from '@/hooks/useActivityTracker'

// Invisible client component that mounts the activity tracker in the consulente layout.
export function ActivityTrackerMount() {
  useActivityTracker()
  return null
}
