import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { ApprovazioniClient, type Richiesta } from '@/components/manager/ApprovazioniClient'
import { fmtGiorni, TIPI_ASSENZA } from '@/lib/homeManager'
import { archivioAperto, soloVisibili } from '@/lib/localiVisibili'

const TZ = 'Europe/Rome'

// Approvazioni (timbrature con foto e richieste di assenza): stessa lista
// del "Da fare" della Home, ci arrivano i link delle notifiche.
export default async function ApprovazioniPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, restaurant_id, is_direttore').eq('id', user.id).single()
  const isManager = profile?.role === 'manager'
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  if (!isManager && !isDirettore) redirect('/dashboard')
  const filtro = isDirettore ? profile?.restaurant_id ?? '00000000-0000-0000-0000-000000000000' : null

  let qFoto = supabase.from('attendances')
    .select('id, check_in, check_out, fallback_photo_path_in, fallback_photo_path_out, restaurant:restaurants(name), profile:profiles!user_id(full_name)')
    .eq('needs_manager_approval', true).order('check_in', { ascending: false })
  let qAss = supabase.from('absences')
    .select('id, type, start_date, end_date, notes, restaurant:restaurants(name), profile:profiles!user_id(full_name)')
    .eq('status', 'pending').order('start_date')
  if (filtro) { qFoto = qFoto.eq('restaurant_id', filtro); qAss = qAss.eq('restaurant_id', filtro) }
  else {
    // Manager: solo le richieste dei locali attivi (o di quello aperto in
    // archivio), così quelle di un locale nascosto non finiscono nel "da fare".
    const { data: visibili } = await soloVisibili(supabase.from('restaurants').select('id'), await archivioAperto())
    const ids = (visibili ?? []).map(r => r.id as string)
    const idsLocali = ids.length ? ids : ['00000000-0000-0000-0000-000000000000']
    qFoto = qFoto.in('restaurant_id', idsLocali); qAss = qAss.in('restaurant_id', idsLocali)
  }
  const [{ data: foto }, { data: assenze }] = await Promise.all([qFoto, qAss])

  const uno = <X,>(v: X | X[] | null | undefined): X | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)
  const nome = (p: unknown) => uno(p as { full_name: string } | { full_name: string }[] | null)?.full_name ?? '—'
  const locale = (r: unknown) => uno(r as { name: string } | { name: string }[] | null)?.name ?? ''
  const ora = (iso: string) => formatInTimeZone(new Date(iso), TZ, 'HH:mm')
  const giorno = (iso: string) => formatInTimeZone(new Date(iso), TZ, 'dd/MM')

  const richieste: Richiesta[] = [
    ...(foto ?? []).map(f => ({
      id: f.id as string, tipo: 'foto' as const, nome: nome(f.profile), badge: 'Timbro con foto',
      dettaglio: [`${giorno(f.check_in)} · entrata ${ora(f.check_in)}${f.check_out ? ` · uscita ${ora(f.check_out)}` : ''}`, locale(f.restaurant)].filter(Boolean).join(' · '),
      foto: [f.fallback_photo_path_in && { path: f.fallback_photo_path_in as string, l: 'Ingresso' }, f.fallback_photo_path_out && { path: f.fallback_photo_path_out as string, l: 'Uscita' }].filter(Boolean) as { path: string; l: string }[],
    })),
    ...(assenze ?? []).map(a => ({
      id: a.id as string, tipo: 'assenza' as const, nome: nome(a.profile), badge: TIPI_ASSENZA[a.type as string] ?? (a.type as string),
      dettaglio: [fmtGiorni(a.start_date as string, a.end_date as string), locale(a.restaurant)].filter(Boolean).join(' · '),
      nota: (a.notes as string | null) ?? null, foto: [],
    })),
  ]

  return <ApprovazioniClient iniziali={richieste} />
}
