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

  const { data, error } = await supabase
    .from('attendances')
    .insert({
      user_id: userId,
      restaurant_id: empProfile?.restaurant_id ?? null,
      check_in: checkInIso,
      check_out: checkOutIso,
    })
    .select('*, profile:profiles(id, full_name, role), restaurant:restaurants(id, name)')
    .single()

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

  let query = supabase
    .from('attendances')
    .update({ check_in: checkInIso, check_out: checkOutIso })
    .eq('id', id)

  // Direttore is hard-locked to its own restaurant's attendance records
  if (isDirectore && callerProfile?.restaurant_id) {
    query = query.eq('restaurant_id', callerProfile.restaurant_id)
  }

  const { data, error } = await query
    .select('*, profile:profiles(id, full_name, role), restaurant:restaurants(id, name)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ attendance: data })
}
