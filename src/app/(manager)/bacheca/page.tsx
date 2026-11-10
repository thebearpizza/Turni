import { createClient } from '@/lib/supabase/server'
import { BachecaClient, type ComunicatoRiga, type LetturaRiga } from '@/components/manager/BachecaClient'
import { RUOLI_BACHECA, type PersonaStaff } from '@/components/altro/destinatari'

const SELECT = '*, restaurant:restaurants(id, name), author:profiles!created_by(id, full_name, role)'

export default async function BachecaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, can_post_bulletin, is_direttore, department, restaurant:restaurants(id, name, qr_secret)')
    .eq('id', user!.id)
    .single()

  const isManager = profile?.role === 'manager'
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  // Manager e direttore: scheda Bacheca di Altro (MTAltro, il direttore con
  // un solo locale). Capo servizio: Bacheca con QR del locale e messaggi.
  const vista = isManager ? 'manager' : isDirettore ? 'direttore' : 'capo'
  const locale = isManager ? null : profile?.restaurant_id ?? null

  let qRist = supabase.from('restaurants').select('id, name').order('name')
  let qStaff = supabase.from('profiles').select('id, full_name, role, is_direttore, restaurant_id, department').in('role', RUOLI_BACHECA).order('full_name')
  if (locale) { qRist = qRist.eq('id', locale); qStaff = qStaff.eq('restaurant_id', locale) }

  const [{ data: restaurants }, { data: bulletins }, { data: staff }] = await Promise.all([
    qRist,
    supabase.from('bulletins').select(SELECT).order('created_at', { ascending: false }).limit(100),
    qStaff,
  ])

  const ids = (bulletins ?? []).map(b => b.id as string)
  const { data: reads } = ids.length
    ? await supabase.from('bulletin_reads').select('bulletin_id, user_id, read_at').in('bulletin_id', ids)
    : { data: [] }

  const rest = Array.isArray(profile?.restaurant) ? profile?.restaurant[0] : profile?.restaurant
  const canPost = isManager || isDirettore || (profile?.role === 'capo_servizio' && profile.can_post_bulletin === true)

  return (
    <BachecaClient
      vista={vista}
      initialBulletins={(bulletins ?? []) as unknown as ComunicatoRiga[]}
      initialReads={(reads ?? []) as LetturaRiga[]}
      restaurants={restaurants ?? []}
      staff={(staff ?? []) as PersonaStaff[]}
      currentUserId={user!.id}
      currentRestaurantId={locale}
      canPost={canPost}
      qr={rest ? { name: (rest as { name: string }).name, qr_secret: (rest as { qr_secret: string | null }).qr_secret ?? null } : null}
    />
  )
}
