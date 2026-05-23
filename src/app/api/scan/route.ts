import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

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
    // Controlla se esiste già un turno aperto oggi
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)

    const { data: existing } = await supabase
      .from('attendances')
      .select('id')
      .eq('user_id', user.id)
      .is('check_out', null)
      .gte('check_in', todayStart.toISOString())
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'Hai già un turno aperto' }, { status: 409 })
    }

    const { data: attendance, error } = await supabase
      .from('attendances')
      .insert({
        user_id: user.id,
        restaurant_id: restaurant.id,
        check_in: nowUtc,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: 'Errore registrazione' }, { status: 500 })
    }

    return NextResponse.json({ attendance })
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
