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

  // Le presenze inserite o corrette a mano dal manager non si chiudono da
  // sole: un ingresso senza uscita lì è voluto. Prima un ingresso inserito
  // a mano alle 16:30 diventava un'uscita alle 23:30 senza che nessuno la
  // mettesse. Senza la colonna (migrazione non applicata) si ripiega sul
  // comportamento di prima.
  const leggi = (conFiltro: boolean) => {
    let query = client
      .from('attendances')
      .select('id, check_in')
      .is('check_out', null)
      .lt('check_in', cutoffIso)
    if (conFiltro) query = query.eq('inserita_a_mano', false)
    if (userId) query = query.eq('user_id', userId)
    return query
  }

  let { data: stale, error } = await leggi(true)
  if (error && (/inserita_a_mano/.test(error.message ?? '') || error.code === '42703')) ({ data: stale, error } = await leggi(false))
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
