'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { COOKIE_ARCHIVIO } from '@/lib/localiVisibili'

// Archivio dei locali nascosti: aprire/chiudere l'archivio (cookie letto
// dalle pagine lato server) e nascondere/riattivare un locale. Solo manager
// e solo sui locali che gestisce (la lettura/scrittura passa da RLS).

async function manager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return p?.role === 'manager' ? supabase : null
}

export async function apriArchivio(restaurantId: string): Promise<{ error?: string }> {
  const supabase = await manager()
  if (!supabase) return { error: 'Non autorizzato' }
  const { data: r } = await supabase.from('restaurants').select('id, nascosto').eq('id', restaurantId).maybeSingle()
  if (!r) return { error: 'Locale non trovato' }
  if (!r.nascosto) return { error: 'Il locale è attivo: lo trovi già fra i locali' }
  // Cookie di sessione: chiudendo l'app si torna ai locali attivi.
  ;(await cookies()).set(COOKIE_ARCHIVIO, r.id, { path: '/', sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production' })
  revalidatePath('/', 'layout')
  return {}
}

export async function chiudiArchivio(): Promise<void> {
  ;(await cookies()).delete(COOKIE_ARCHIVIO)
  revalidatePath('/', 'layout')
}

export async function impostaNascosto(restaurantId: string, nascosto: boolean): Promise<{ error?: string }> {
  const supabase = await manager()
  if (!supabase) return { error: 'Non autorizzato' }
  const { data, error } = await supabase.from('restaurants').update({ nascosto }).eq('id', restaurantId).select('id').maybeSingle()
  if (error || !data) return { error: error?.message ?? 'Locale non trovato' }
  // Riattivandolo non ha più senso tenerlo aperto in archivio.
  const jar = await cookies()
  if (!nascosto && jar.get(COOKIE_ARCHIVIO)?.value === restaurantId) jar.delete(COOKIE_ARCHIVIO)
  revalidatePath('/', 'layout')
  return {}
}
