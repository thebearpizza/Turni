import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, parseISO } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Single source of truth for user-facing date strings.
 *
 * Accepts an ISO date-only string ("2026-05-25"), ISO datetime ("2026-05-25T18:00:00Z"),
 * or a Date object, and returns the Italian numeric format "dd-MM-yyyy".
 *
 * DO NOT use this for values sent to the database, for <input type="date"> values,
 * or for groupBy/filter keys — those must stay in ISO 8601 ("yyyy-MM-dd").
 */
export function formatDate(input: string | Date): string {
  const d = typeof input === "string" ? parseISO(input) : input
  return format(d, "dd-MM-yyyy")
}
