import type { SupabaseClient } from '@supabase/supabase-js'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const TZ = 'Europe/Rome'

export type StatoPresenza = 'servizio' | 'uscito' | 'ritardo' | 'atteso' | 'assente' | 'foto'

export interface RigaPresenza {
  userId: string
  nome: string
  reparto: string | null
  /** Fasce del turno di oggi, es. "18:00–23:30" (più fasce separate da " / "). */
  turno: string | null
  stato: StatoPresenza
  /** Dettaglio dopo il turno: "entrata 17:56", "non timbrato", "malattia"... */
  dettaglio: string
  /** Testo del badge: "In servizio", "Ritardo 12'", "Alle 19:00", "Assente"... */
  badge: string
  /** Timbratura con foto da approvare (id della presenza). */
  presenzaFotoId: string | null
  fotoPath: string | null
  checkIn: string | null
}

const TIPI_ASSENZA: Record<string, string> = {
  ferie: 'ferie', malattia: 'malattia', permesso: 'permesso', riposo: 'riposo',
}

// Presenze di oggi di un locale (ed eventualmente di un reparto): incrocia
// turni del giorno, timbrature e assenze approvate per dare a ogni persona
// uno stato leggibile, come nella Home di capo servizio e direttore del
// design. Chi non ha turno né timbratura oggi non compare.
export async function presenzeOggi(supabase: SupabaseClient, restaurantId: string, reparto: string | null): Promise<RigaPresenza[]> {
  const oggi = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const inizio = fromZonedTime(`${oggi}T00:00:00`, TZ).toISOString()
  const adesso = formatInTimeZone(new Date(), TZ, 'HH:mm')

  let qTurni = supabase.from('turns').select('user_id, department, start_time, end_time, is_rest_day, profile:profiles!user_id(full_name)')
    .eq('restaurant_id', restaurantId).eq('date', oggi).order('start_time')
  if (reparto) qTurni = qTurni.eq('department', reparto)

  const [{ data: turni }, { data: presenze }, { data: assenze }] = await Promise.all([
    qTurni,
    supabase.from('attendances').select('id, user_id, check_in, check_out, needs_manager_approval, fallback_photo_path_in, fallback_photo_path_out, profile:profiles(full_name, department)')
      .eq('restaurant_id', restaurantId).gte('check_in', inizio).order('check_in'),
    supabase.from('absences').select('user_id, type, status').eq('restaurant_id', restaurantId)
      .lte('start_date', oggi).gte('end_date', oggi).eq('status', 'approved'),
  ])

  type T = { user_id: string; department: string | null; start_time: string; end_time: string; is_rest_day: boolean; profile: { full_name: string } | { full_name: string }[] | null }
  type P = { id: string; user_id: string; check_in: string; check_out: string | null; needs_manager_approval: boolean; fallback_photo_path_in: string | null; fallback_photo_path_out: string | null; profile: { full_name: string; department: string | null } | { full_name: string; department: string | null }[] | null }
  const uno = <X,>(v: X | X[] | null): X | null => (Array.isArray(v) ? v[0] ?? null : v)

  const perUtente = new Map<string, { nome: string; reparto: string | null; fasce: { s: string; e: string }[]; riposo: boolean }>()
  for (const t of (turni ?? []) as unknown as T[]) {
    const r = perUtente.get(t.user_id) ?? { nome: uno(t.profile)?.full_name ?? '—', reparto: t.department, fasce: [], riposo: false }
    if (t.is_rest_day) r.riposo = true
    else r.fasce.push({ s: t.start_time.slice(0, 5), e: t.end_time.slice(0, 5) })
    perUtente.set(t.user_id, r)
  }
  const presenzeUtente = new Map<string, P[]>()
  for (const p of (presenze ?? []) as unknown as P[]) {
    const prof = uno(p.profile)
    if (reparto && prof?.department && prof.department !== reparto && !perUtente.has(p.user_id)) continue
    presenzeUtente.set(p.user_id, [...(presenzeUtente.get(p.user_id) ?? []), p])
    if (!perUtente.has(p.user_id)) perUtente.set(p.user_id, { nome: prof?.full_name ?? '—', reparto: prof?.department ?? null, fasce: [], riposo: false })
  }
  const assenti = new Map<string, string>()
  for (const a of assenze ?? []) assenti.set(a.user_id as string, TIPI_ASSENZA[a.type as string] ?? (a.type as string))

  const righe: RigaPresenza[] = []
  for (const [userId, u] of perUtente) {
    if (u.riposo && u.fasce.length === 0 && !presenzeUtente.has(userId)) continue
    const turno = u.fasce.length ? u.fasce.map(f => `${f.s}–${f.e}`).join(' / ') : null
    const ps = presenzeUtente.get(userId) ?? []
    const aperta = ps.find(p => !p.check_out)
    const ultima = ps[ps.length - 1]
    const foto = ps.find(p => p.needs_manager_approval)
    const ora = (iso: string) => formatInTimeZone(new Date(iso), TZ, 'HH:mm')
    const base = { userId, nome: u.nome, reparto: u.reparto, turno, presenzaFotoId: foto?.id ?? null, fotoPath: foto ? (foto.fallback_photo_path_in ?? foto.fallback_photo_path_out) : null, checkIn: (aperta ?? ultima)?.check_in ?? null }

    if (foto) {
      righe.push({ ...base, stato: 'foto', dettaglio: `foto ${ora(foto.check_in)} · da approvare`, badge: 'Timbro con foto' })
    } else if (assenti.has(userId)) {
      righe.push({ ...base, stato: 'assente', dettaglio: assenti.get(userId)!, badge: 'Assente' })
    } else if (aperta) {
      righe.push({ ...base, stato: 'servizio', dettaglio: `entrata ${ora(aperta.check_in)}`, badge: 'In servizio' })
    } else if (ultima) {
      righe.push({ ...base, stato: 'uscito', dettaglio: `uscita ${ora(ultima.check_out!)}`, badge: 'Uscito' })
    } else if (u.fasce.length) {
      const inizioTurno = u.fasce[0].s
      if (adesso >= inizioTurno) {
        const [h1, m1] = inizioTurno.split(':').map(Number), [h2, m2] = adesso.split(':').map(Number)
        const min = h2 * 60 + m2 - (h1 * 60 + m1)
        righe.push({ ...base, stato: 'ritardo', dettaglio: 'non timbrato', badge: `Ritardo ${min}'` })
      } else {
        righe.push({ ...base, stato: 'atteso', dettaglio: '', badge: `Alle ${inizioTurno}` })
      }
    }
  }
  const ordine: Record<StatoPresenza, number> = { foto: 0, ritardo: 1, servizio: 2, atteso: 3, uscito: 4, assente: 5 }
  return righe.sort((a, b) => ordine[a.stato] - ordine[b.stato] || (a.turno ?? '').localeCompare(b.turno ?? ''))
}
