import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fromZonedTime } from 'date-fns-tz'

const TZ = 'Europe/Rome'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, is_direttore')
    .eq('id', user.id)
    .single()

  const isManager   = callerProfile?.role === 'manager'
  const isDirectore = callerProfile?.role === 'capo_servizio' && callerProfile?.is_direttore === true
  if (!isManager && !isDirectore) {
    return NextResponse.json({ error: 'Non autorizzato — riservato a manager e direttori' }, { status: 403 })
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

  const checkInIso = fromZonedTime(`${date}T${checkIn}:00`, TZ).toISOString()
  const checkOutIso = checkOut ? fromZonedTime(`${date}T${checkOut}:00`, TZ).toISOString() : null

  if (checkOutIso && checkOutIso <= checkInIso) {
    return NextResponse.json(
      { error: "L'ora di uscita deve essere successiva all'ora di ingresso" },
      { status: 400 }
    )
  }

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
