import webpush from 'web-push'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { RUOLI_BACHECA, type PersonaStaff } from '@/components/altro/destinatari'
import { archivioAperto, soloVisibili } from '@/lib/localiVisibili'

// Pezzi comuni delle route della bacheca: chi sta chiamando (con il suo
// perimetro di locali), lo staff che può ricevere i comunicati e l'invio
// della notifica (in-app + push) agli stessi destinatari.

export interface Chiamante {
  id: string
  role: string
  restaurant_id: string | null
  is_direttore: boolean
  can_post_bulletin: boolean
  account_status: string
  managed_restaurant_ids: string[] | null
}

export async function chiamante(): Promise<Chiamante | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: p } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore, can_post_bulletin, account_status, managed_restaurant_ids')
    .eq('id', user.id)
    .single()
  if (!p) return null
  return {
    id: user.id,
    role: p.role,
    restaurant_id: p.restaurant_id ?? null,
    is_direttore: p.is_direttore === true,
    can_post_bulletin: p.can_post_bulletin === true,
    account_status: (p as { account_status?: string }).account_status ?? 'active',
    managed_restaurant_ids: (p as { managed_restaurant_ids?: string[] | null }).managed_restaurant_ids ?? null,
  }
}

/** Può pubblicare: manager, direttore, capo servizio con il permesso bacheca. */
export function puoPubblicare(c: Chiamante): boolean {
  return c.role === 'manager' || (c.role === 'capo_servizio' && (c.is_direttore || c.can_post_bulletin))
}

/** Locali su cui il chiamante può scrivere: null = tutti (proprietario della piattaforma). */
export function localiDi(c: Chiamante): string[] | null {
  if (c.role === 'manager') return c.managed_restaurant_ids
  return c.restaurant_id ? [c.restaurant_id] : []
}

/** Staff che può ricevere i comunicati del chiamante (mai fuori dai suoi locali). */
export async function staffDi(c: Chiamante): Promise<PersonaStaff[]> {
  const admin = createAdminClient()
  let locali = localiDi(c)
  if (c.role === 'manager') {
    // Manager: solo lo staff dei locali attivi, o di quello aperto in
    // archivio. Così un comunicato a "Tutti i locali" (o un sollecito) non
    // notifica chi lavora in un locale nascosto.
    let qv = soloVisibili(admin.from('restaurants').select('id'), await archivioAperto())
    if (locali !== null) {
      if (!locali.length) return []
      qv = qv.in('id', locali)
    } else {
      // Il proprietario della piattaforma non notifica lo staff dei locali demo.
      qv = qv.eq('is_demo', false)
    }
    const { data: visibili } = await qv
    locali = (visibili ?? []).map((r: { id: string }) => r.id)
  }
  if (locali === null || !locali.length) return []
  const q = admin.from('profiles').select('id, full_name, role, is_direttore, restaurant_id, department').in('role', RUOLI_BACHECA).in('restaurant_id', locali)
  const { data } = await q
  return (data ?? []) as PersonaStaff[]
}

/**
 * Notifica in-app + push. Il dipendente apre la bacheca dalla sua Home
 * (/home?bacheca=1); capi servizio e direttori hanno la pagina Bacheca.
 * Best-effort: il comunicato è già salvato, un errore qui non si propaga.
 */
export async function notifica(persone: PersonaStaff[], title: string, message: string): Promise<number> {
  if (!persone.length) return 0
  const link = (p: PersonaStaff) => (p.role === 'dipendente' ? '/home?bacheca=1' : '/bacheca')
  try {
    const admin = createAdminClient()
    const ruoli = new Map(persone.map(p => [p.id, p]))
    const [, { data: subs }] = await Promise.all([
      admin.from('notifications').insert(persone.map(p => ({ user_id: p.id, title, message, link: link(p) }))),
      admin.from('push_subscriptions').select('endpoint, p256dh, auth_key, user_id').in('user_id', persone.map(p => p.id)),
    ])
    if (subs?.length && process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(process.env.VAPID_EMAIL!, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY)
      await Promise.allSettled((subs as { endpoint: string; p256dh: string; auth_key: string; user_id: string }[]).map(async s => {
        const p = ruoli.get(s.user_id)
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
            JSON.stringify({ title, body: message, url: p ? link(p) : '/home?bacheca=1' }),
          )
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode
          if (status === 410 || status === 404) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        }
      }))
    }
  } catch (err) {
    console.error('[bacheca] invio notifica fallito:', err)
  }
  return persone.length
}
