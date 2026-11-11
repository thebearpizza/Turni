import { createClient } from '@/lib/supabase/server'
import { BachecaClient, type ComunicatoRiga, type LetturaRiga } from '@/components/manager/BachecaClient'
import { RUOLI_BACHECA, type PersonaStaff } from '@/components/altro/destinatari'
import { archivioAperto, soloVisibili } from '@/lib/localiVisibili'

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
  // Manager: i locali attivi, o quello aperto in archivio. Direttore e capo
  // servizio: il proprio locale, anche se nascosto.
  const archivio = isManager ? await archivioAperto() : null
  if (locale) qRist = qRist.eq('id', locale)
  else qRist = soloVisibili(qRist, archivio)
  const { data: restaurants } = await qRist

  let qBull = supabase.from('bulletins').select(SELECT).order('created_at', { ascending: false }).limit(100)
  if (locale) qStaff = qStaff.eq('restaurant_id', locale)
  else {
    // Staff e comunicati seguono l'elenco dei locali: quelli dei locali
    // nascosti restano fuori. I comunicati senza locale ("Tutti i locali")
    // sono degli attivi, quindi con l'archivio aperto non si mostrano.
    const ids = (restaurants ?? []).map(r => r.id as string)
    qStaff = qStaff.in('restaurant_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    if (archivio) qBull = qBull.eq('restaurant_id', archivio)
    else qBull = ids.length ? qBull.or(`restaurant_id.is.null,restaurant_id.in.(${ids.join(',')})`) : qBull.is('restaurant_id', null)
  }

  const [{ data: bulletins }, { data: staff }] = await Promise.all([qBull, qStaff])

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
      archivio={archivio}
      canPost={canPost}
      qr={rest ? { name: (rest as { name: string }).name, qr_secret: (rest as { qr_secret: string | null }).qr_secret ?? null } : null}
    />
  )
}
