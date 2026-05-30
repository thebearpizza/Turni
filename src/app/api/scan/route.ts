import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const TZ = 'Europe/Rome'

function todayRomeBounds(): { start: string; end: string } {
  const todayRome = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const start = fromZonedTime(`${todayRome}T00:00:00`, TZ).toISOString()
  const end = fromZonedTime(`${todayRome}T23:59:59`, TZ).toISOString()
  return { start, end }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  }

  const { qr_secret, type } = await request.json()

  if (!qr_secret || !['in', 'out'].includes(type)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  // In development: simula scansione con il ristorante del profilo
  let restaurant
  if (process.env.NODE_ENV === 'development' && qr_secret === '__SIMULATE__') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('restaurant:restaurants(*)')
      .eq('id', user.id)
      .single()
    restaurant = (profile as unknown as { restaurant: typeof restaurant })?.restaurant

    if (!restaurant) {
      // Prendi il primo ristorante disponibile in dev
      const { data } = await supabase.from('restaurants').select('*').limit(1).single()
      restaurant = data
    }
  } else {
    // Valida il QR secret
    const { data } = await supabase
      .from('restaurants')
      .select('*')
      .eq('qr_secret', qr_secret)
      .single()
    restaurant = data
  }

  if (!restaurant) {
    return NextResponse.json({ error: 'QR Code non riconosciuto' }, { status: 404 })
  }

  const nowUtc = new Date().toISOString()

  if (type === 'in') {
    // The open-shift guard must NOT be date-scoped: a shift started before
    // midnight Rome is still open if check_out is null.  Only split-shift
    // detection (completed turni within today's Rome window) needs a date range.
    const { start: todayStart, end: todayEnd } = todayRomeBounds()

    const [{ data: openShift }, { data: completedToday }] = await Promise.all([
      supabase
        .from('attendances')
        .select('id')
        .eq('user_id', user.id)
        .is('check_out', null)
        .maybeSingle(),                    // any open shift, no date filter
      supabase
        .from('attendances')
        .select('id')
        .eq('user_id', user.id)
        .not('check_out', 'is', null)
        .gte('check_in', todayStart)
        .lte('check_in', todayEnd)
        .maybeSingle(),
    ])

    if (openShift) {
      return NextResponse.json({ error: 'Hai già un turno aperto' }, { status: 409 })
    }

    const isSplitShift = !!completedToday

    const { data: attendance, error } = await supabase
      .from('attendances')
      .insert({
        user_id: user.id,
        restaurant_id: restaurant.id,
        check_in: nowUtc,
        is_split_shift: isSplitShift,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: 'Errore registrazione' }, { status: 500 })
    }

    return NextResponse.json({ attendance, splitShift: isSplitShift })
  } else {
    // check-out: trova il turno aperto
    const { data: openAttendance, error: findError } = await supabase
      .from('attendances')
      .select('*')
      .eq('user_id', user.id)
      .is('check_out', null)
      .order('check_in', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (findError || !openAttendance) {
      return NextResponse.json({ error: 'Nessun turno aperto trovato' }, { status: 404 })
    }

    const { data: attendance, error } = await supabase
      .from('attendances')
      .update({ check_out: nowUtc })
      .eq('id', openAttendance.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: 'Errore registrazione uscita' }, { status: 500 })
    }

    return NextResponse.json({ attendance })
  }
}
