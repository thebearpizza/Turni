import type { SupabaseClient } from '@supabase/supabase-js'

// When an employee forgets to timbrare l'uscita, the shift stays open
// indefinitely (running counter, blocked next check-in, wrong report hours).
// We detect a forgotten check-out as a shift left open for more than
// STALE_AFTER_HOURS, and close it automatically at check_in + AUTO_DURATION_HOURS.
const STALE_AFTER_HOURS   = 16
const AUTO_DURATION_HOURS  = 7

/**
 * Auto-close shifts left open past the stale threshold.
 *
 * @param client    Supabase client. Pass an admin client to sweep all users,
 *                  or a user-scoped client (RLS) to close only the caller's own.
 * @param userId    Optional — restrict the sweep to a single employee.
 * @returns number of shifts closed.
 */
export async function autoCloseStaleShifts(
  client: SupabaseClient,
  userId?: string,
): Promise<number> {
  const cutoffIso = new Date(Date.now() - STALE_AFTER_HOURS * 3_600_000).toISOString()

  let query = client
    .from('attendances')
    .select('id, check_in')
    .is('check_out', null)
    .lt('check_in', cutoffIso)

  if (userId) query = query.eq('user_id', userId)

  const { data: stale, error } = await query
  if (error || !stale || stale.length === 0) return 0

  await Promise.all(
    stale.map(row => {
      const checkOut = new Date(
        new Date(row.check_in).getTime() + AUTO_DURATION_HOURS * 3_600_000,
      ).toISOString()
      return client.from('attendances').update({ check_out: checkOut }).eq('id', row.id)
    }),
  )

  return stale.length
}
