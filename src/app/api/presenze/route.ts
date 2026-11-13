import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeAttendanceIso } from '@/lib/attendanceTime'

const TZ = 'Europe/Rome'

const DEMO_READONLY = NextResponse.json(
  { error: 'Account in attesa di approvazione. La demo è in sola lettura.' },
  { status: 403 }
)

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, is_direttore, account_status')
    .eq('id', user.id)
    .single()

  if ((callerProfile as { account_status?: string } | null)?.account_status === 'pending') return DEMO_READONLY

  const isManager    = callerProfile?.role === 'manager'
  const isDirectore  = callerProfile?.role === 'capo_servizio' && callerProfile?.is_direttore === true

  if (!isManager && !isDirectore) {
    return NextResponse.json(
      { error: 'Non autorizzato. Solo i manager e i direttori possono modificare le presenze.' },
      { status: 403 }
    )
  }

  const body = await request.json()
  const { userId, date, checkIn, checkOut } = body as {
    userId: string
    date: string
    checkIn: string
    checkOut?: string
  }

  if (!userId || !date || !checkIn) {
    return NextResponse.json({ error: 'Campi obbligatori mancanti' }, { status: 400 })
  }

  const { data: empProfile } = await supabase
    .from('profiles')
    .select('restaurant_id')
    .eq('id', userId)
    .single()

  const { checkInIso, checkOutIso } = computeAttendanceIso(TZ, date, checkIn, checkOut)

  // inserita_a_mano: la chiusura automatica delle uscite dimenticate
  // (autoCloseStaleShifts) non la tocca. Senza la colonna (migrazione non
  // ancora applicata) si salva come prima.
  const riga = {
    user_id: userId,
    restaurant_id: empProfile?.restaurant_id ?? null,
    check_in: checkInIso,
    check_out: checkOutIso,
  }
  const inserisci = (r: object) => supabase.from('attendances').insert(r)
    .select('*, profile:profiles(id, full_name, role), restaurant:restaurants(id, name)').single()
  let { data, error } = await inserisci({ ...riga, inserita_a_mano: true })
  if (error && colonnaManuale(error)) ({ data, error } = await inserisci(riga))

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ attendance: data })
}

// PATCH /api/presenze
// Body: { id, date, checkIn, checkOut? }
// Manager: globale. Direttore: solo presenze del proprio ristorante.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore, account_status')
    .eq('id', user.id)
    .single()

  if ((callerProfile as { account_status?: string } | null)?.account_status === 'pending') return DEMO_READONLY

  const isManager   = callerProfile?.role === 'manager'
  const isDirectore = callerProfile?.role === 'capo_servizio' && callerProfile?.is_direttore === true

  if (!isManager && !isDirectore) {
    return NextResponse.json(
      { error: 'Non autorizzato. Solo i manager e i direttori possono modificare le presenze.' },
      { status: 403 }
    )
  }

  const body = await request.json()
  const { id, date, checkIn, checkOut } = body as {
    id: string
    date: string
    checkIn: string
    checkOut?: string | null
  }

  if (!id || !date || !checkIn) {
    return NextResponse.json({ error: 'Campi obbligatori mancanti' }, { status: 400 })
  }

  const { checkInIso, checkOutIso } = computeAttendanceIso(TZ, date, checkIn, checkOut)

  // Una presenza corretta a mano non si chiude più da sola: se il manager
  // lascia l'uscita vuota è una scelta sua (vedi POST).
  const aggiorna = (campi: object) => {
    let query = supabase.from('attendances').update(campi).eq('id', id)
    // Direttore is hard-locked to its own restaurant's attendance records
    if (isDirectore && callerProfile?.restaurant_id) query = query.eq('restaurant_id', callerProfile.restaurant_id)
    return query.select('*, profile:profiles(id, full_name, role), restaurant:restaurants(id, name)').single()
  }
  let { data, error } = await aggiorna({ check_in: checkInIso, check_out: checkOutIso, inserita_a_mano: true })
  if (error && colonnaManuale(error)) ({ data, error } = await aggiorna({ check_in: checkInIso, check_out: checkOutIso }))

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ attendance: data })
}

/** La colonna attendances.inserita_a_mano non c'è ancora (migrazione da applicare). */
function colonnaManuale(e: { code?: string; message?: string }) {
  return /inserita_a_mano/.test(e.message ?? '') || e.code === 'PGRST204' || e.code === '42703'
}
