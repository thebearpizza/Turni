import { createAdminClient } from '@/lib/supabase/admin'
import { addDays, format, startOfWeek, addWeeks } from 'date-fns'

interface DemoEmployee {
  name:       string
  department: string
  username:   string
}

const DEMO_EMPLOYEES: DemoEmployee[] = [
  { name: 'Mario Rossi',    department: 'Sala',     username: 'mario.rossi' },
  { name: 'Giulia Bianchi', department: 'Sala',     username: 'giulia.bianchi' },
  { name: 'Luca Ferrari',   department: 'Cucina',   username: 'luca.ferrari' },
  { name: 'Anna Conti',     department: 'Cucina',   username: 'anna.conti' },
  { name: 'Marco Ricci',    department: 'Bar',      username: 'marco.ricci' },
]

export async function createDemoData(managerId: string): Promise<string> {
  const admin = createAdminClient()

  // 1. Crea il ristorante demo
  const { data: restaurant, error: restErr } = await admin
    .from('restaurants')
    .insert({
      name:         'Ristorante Demo',
      address:      'Via Roma 1, Milano',
      closing_days: [0],  // chiuso domenica
      qr_secret:    `demo-${managerId}`,
      is_demo:      true,
      owner_id:     managerId,
    })
    .select('id')
    .single()

  if (restErr || !restaurant) throw new Error('Errore creazione ristorante demo: ' + restErr?.message)
  const restaurantId = restaurant.id

  // 2. Crea dipendenti demo (auth user + profile)
  const uid = managerId.slice(0, 8)
  for (const emp of DEMO_EMPLOYEES) {
    const email = `demo.${emp.username}.${uid}@demo.struttura.local`
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email,
      password:      'demo-password-' + uid,
      email_confirm: true,
      user_metadata: { full_name: emp.name, role: 'dipendente' },
    })
    if (authErr || !authData.user) continue

    await admin.from('profiles').upsert({
      id:            authData.user.id,
      full_name:     emp.name,
      username:      `${emp.username}.demo`,
      role:          'dipendente',
      department:    emp.department,
      restaurant_id: restaurantId,
      account_status: 'active',
      weekly_rest_days: 1,
      primary_slot_ids: [],
      secondary_departments: [],
      consultant_restaurant_ids: [],
    })
  }

  // 3. Crea fasce orarie demo
  const slots = [
    { name: 'Pranzo',  department: 'Sala',   start_time: '11:30', end_time: '16:00', required_count: 2, days_of_week: [] },
    { name: 'Cena',    department: 'Sala',   start_time: '18:00', end_time: '23:30', required_count: 2, days_of_week: [] },
    { name: 'Pranzo',  department: 'Cucina', start_time: '10:00', end_time: '15:30', required_count: 1, days_of_week: [] },
    { name: 'Cena',    department: 'Cucina', start_time: '17:00', end_time: '23:00', required_count: 1, days_of_week: [] },
    { name: 'Apertura', department: 'Bar',   start_time: '08:00', end_time: '14:00', required_count: 1, days_of_week: [] },
  ]
  await admin.from('shift_slots').insert(
    slots.map(s => ({ ...s, restaurant_id: restaurantId }))
  )

  // 4. Crea turni demo per la settimana corrente + quella successiva
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, department')
    .eq('restaurant_id', restaurantId)
    .eq('role', 'dipendente')

  if (profiles?.length) {
    const turns: object[] = []
    const weekStart = startOfWeek(addWeeks(new Date(), 1), { weekStartsOn: 1 })

    for (let dayOffset = 0; dayOffset < 6; dayOffset++) {
      const date = format(addDays(weekStart, dayOffset), 'yyyy-MM-dd')
      for (const p of profiles) {
        if (dayOffset === 2 && p.department === 'Sala') {
          // mercoledì riposo per i Sala
          turns.push({ user_id: p.id, restaurant_id: restaurantId, department: p.department, date, start_time: '00:00', end_time: '00:00', is_rest_day: true, is_extraordinary: false })
          continue
        }
        const isEvening = p.department === 'Bar' ? false : dayOffset % 2 === 0
        const schedules: Record<string, [string, string]> = {
          'Sala':   isEvening ? ['18:00', '23:30'] : ['11:30', '16:00'],
          'Cucina': isEvening ? ['17:00', '23:00'] : ['10:00', '15:30'],
          'Bar':    ['08:00', '14:00'],
        }
        const [start, end] = schedules[p.department ?? 'Sala'] ?? ['09:00', '17:00']
        turns.push({ user_id: p.id, restaurant_id: restaurantId, department: p.department, date, start_time: start, end_time: end, is_rest_day: false, is_extraordinary: false, created_by: managerId })
      }
    }
    await admin.from('turns').insert(turns)
  }

  return restaurantId
}

export async function deleteDemoData(managerId: string): Promise<void> {
  const admin = createAdminClient()

  // Trova ristoranti demo di questo manager
  const { data: demoRests } = await admin
    .from('restaurants')
    .select('id')
    .eq('is_demo', true)
    .eq('owner_id', managerId)

  if (!demoRests?.length) return

  for (const rest of demoRests) {
    const rid = rest.id

    // Recupera i profili demo per eliminare gli auth user
    const { data: demoProfiles } = await admin
      .from('profiles')
      .select('id')
      .eq('restaurant_id', rid)
      .neq('id', managerId)  // non eliminare il manager stesso

    // Elimina dati collegati (RLS bypassed via service role)
    await admin.from('ai_schedule_draft_turns').delete().in(
      'draft_id',
      (await admin.from('ai_schedule_drafts').select('id').eq('restaurant_id', rid)).data?.map(d => d.id) ?? []
    )
    await admin.from('ai_schedule_drafts').delete().eq('restaurant_id', rid)
    await admin.from('turns').delete().eq('restaurant_id', rid)
    await admin.from('shift_slots').delete().eq('restaurant_id', rid)
    await admin.from('absences').delete().eq('restaurant_id', rid)
    await admin.from('attendances').delete().eq('restaurant_id', rid)

    // Elimina profili e auth users demo
    if (demoProfiles?.length) {
      await admin.from('profiles').delete().in('id', demoProfiles.map(p => p.id))
      for (const p of demoProfiles) {
        await admin.auth.admin.deleteUser(p.id)
      }
    }

    // Elimina il ristorante
    await admin.from('restaurants').delete().eq('id', rid)
  }
}
