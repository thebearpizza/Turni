import { createAdminClient } from '@/lib/supabase/admin'
import { addDays, format, startOfWeek, addWeeks, subDays, getDay } from 'date-fns'

// ── Restaurant configs ──────────────────────────────────────────────────────

const RESTAURANT_CONFIGS = [
  { name: 'Ristorante Da Marco',    address: 'Via Roma 1, Milano',        closing_days: [0],    departments: ['Sala', 'Cucina', 'Bar'] },
  { name: 'Trattoria La Piazzetta', address: 'Corso Vittorio 22, Torino', closing_days: [0, 1], departments: ['Sala', 'Cucina'] },
  { name: 'Pizzeria Napoli DOC',    address: 'Via Napoli 5, Roma',        closing_days: [0],    departments: ['Pizzeria', 'Sala', 'Bar'] },
  { name: 'Bistrot del Porto',      address: 'Lungomare 14, Genova',      closing_days: [1],    departments: ['Sala', 'Bar'] },
  { name: 'Osteria dei Sapori',     address: 'Via Garibaldi 8, Firenze',  closing_days: [0],    departments: ['Sala', 'Cucina'] },
]

// 10 unique names per restaurant
const EMPLOYEE_NAMES = [
  ['Marco Rossi', 'Giulia Bianchi', 'Luca Ferrari', 'Anna Conti', 'Paolo Mancini', 'Sara Romano', 'Davide Greco', 'Elena Russo', 'Matteo Esposito', 'Laura Fontana'],
  ['Andrea Colombo', 'Chiara Ricci', 'Roberto Marino', 'Valeria Bruno', 'Simone Gallo', 'Francesca Costa', 'Emanuele Vitale', 'Alessia Lombardi', 'Fabrizio Serra', 'Marta Barbieri'],
  ['Antonio Ferrara', 'Carmela Esposito', 'Francesco Russo', 'Ciro Mancini', 'Salvatore Greco', 'Rosaria Conti', 'Vincenzo Napoli', 'Maria Romano', 'Luigi Dangelo', 'Teresa Giordano'],
  ['Giovanni Parodi', 'Elisa Moretti', 'Stefano Barrali', 'Claudia Ferretti', 'Daniele Marini', 'Valentina Gatti', 'Roberto Pellegrini', 'Serena Martini', 'Diego Caruso', 'Beatrice Neri'],
  ['Alessandro Toscani', 'Monica Fabbri', 'Enrico Pellegrino', 'Isabella Riva', 'Cristian Moro', 'Silvia Padovani', 'Nicola Fuoco', 'Patrizia Longo', 'Filippo Angeli', 'Carmen Ruggieri'],
]

// Shift times [check-in offset minutes, start, end] by department
const SHIFT_TIMES: Record<string, { morning: [string, string]; evening: [string, string] }> = {
  Sala:     { morning: ['11:30', '16:00'], evening: ['18:00', '23:30'] },
  Cucina:   { morning: ['10:00', '15:30'], evening: ['17:00', '23:00'] },
  Bar:      { morning: ['08:00', '14:00'], evening: ['14:00', '20:00'] },
  Pizzeria: { morning: ['11:00', '15:00'], evening: ['18:00', '23:00'] },
}

// Shift slot definitions per department
const SLOT_TEMPLATES: Record<string, { name: string; start_time: string; end_time: string; required_count: number }[]> = {
  Sala:     [{ name: 'Pranzo', start_time: '11:30', end_time: '16:00', required_count: 2 }, { name: 'Cena', start_time: '18:00', end_time: '23:30', required_count: 2 }],
  Cucina:   [{ name: 'Pranzo', start_time: '10:00', end_time: '15:30', required_count: 1 }, { name: 'Cena', start_time: '17:00', end_time: '23:00', required_count: 1 }],
  Bar:      [{ name: 'Apertura', start_time: '08:00', end_time: '14:00', required_count: 1 }, { name: 'Pomeriggio', start_time: '14:00', end_time: '20:00', required_count: 1 }],
  Pizzeria: [{ name: 'Pranzo', start_time: '11:00', end_time: '15:00', required_count: 1 }, { name: 'Cena', start_time: '18:00', end_time: '23:00', required_count: 2 }],
}

// ODS task templates per role: [title, type, recurrence_days, department or null]
const ODS_RESTAURANT_TASKS = [
  { title: 'Apertura e controllo cassa', type: 'quotidiana', recurrence_days: ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'], department: 'Sala' },
  { title: 'Controllo scorte magazzino', type: 'settimanale',  recurrence_days: ['lunedì'], department: null },
  { title: 'Pulizia generale locali',    type: 'quotidiana',   recurrence_days: ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'], department: null },
]

const ODS_DEPT_TASKS: Record<string, { title: string; type: string; recurrence_days: string[] }[]> = {
  Sala:     [{ title: 'Mise en place tavoli', type: 'quotidiana', recurrence_days: ['lunedì','martedì','mercoledì','giovedì','venerdì','sabato'] }, { title: 'Pulizia e riassetto sala', type: 'quotidiana', recurrence_days: ['lunedì','martedì','mercoledì','giovedì','venerdì','sabato'] }],
  Cucina:   [{ title: 'Sanificazione piani cottura', type: 'quotidiana', recurrence_days: ['lunedì','martedì','mercoledì','giovedì','venerdì','sabato'] }, { title: 'Inventario frigoriferi', type: 'bisettimanale', recurrence_days: ['lunedì','giovedì'] }],
  Bar:      [{ title: 'Pulizia macchina caffè', type: 'quotidiana', recurrence_days: ['lunedì','martedì','mercoledì','giovedì','venerdì','sabato'] }, { title: 'Ordine bevande', type: 'settimanale', recurrence_days: ['lunedì'] }],
  Pizzeria: [{ title: 'Preparazione impasti', type: 'quotidiana', recurrence_days: ['lunedì','martedì','mercoledì','giovedì','venerdì','sabato'] }, { title: 'Pulizia forno', type: 'bisettimanale', recurrence_days: ['mercoledì','sabato'] }],
}

// Bulletin templates
const BULLETIN_TEMPLATES = [
  { title: 'Benvenuti nel nuovo anno lavorativo!', body: 'Cari colleghi, con l\'inizio della nuova stagione vi diamo il benvenuto. Ricordate che il rispetto degli orari è fondamentale per garantire un servizio di qualità. Buon lavoro a tutti!', target: 'all' as const },
  { title: 'Aggiornamento turni estivi', body: 'A partire da luglio i turni serali si estenderanno fino alle 00:00 per venire incontro alla maggiore affluenza estiva. Il calendario aggiornato è disponibile nella sezione turni.', target: 'all' as const },
  { title: 'Novità menù stagionale', body: 'Comunichiamo che a partire dalla prossima settimana verrà introdotto il nuovo menù stagionale. Tutti i dipendenti di sala sono invitati a prendere visione delle nuove proposte prima del servizio.', target: 'department' as const, target_department: 'Sala' },
  { title: 'Nuove procedure HACCP cucina', body: 'In seguito al controllo sanitario del mese scorso, sono state aggiornate le procedure HACCP. Il documento aggiornato è affisso in cucina. Si prega di firmarlo entro venerdì.', target: 'department' as const, target_department: 'Cucina' },
  { title: 'Promemoria: divisa estiva', body: 'Dal 1° giugno è obbligatorio indossare la divisa estiva. Chi non ne fosse ancora in possesso contatti il responsabile per il ritiro.', target: 'all' as const },
  { title: 'Comunicazione reparto bar', body: 'Si ricorda al personale del bar di aggiornare quotidianamente il registro delle temperature frigoriferi. Non farlo costituisce infrazione alle norme igieniche.', target: 'department' as const, target_department: 'Bar' },
  { title: 'Riunione mensile staff', body: 'Si convoca riunione di tutto il personale per lunedì prossimo alle 10:00. La partecipazione è obbligatoria. Ordine del giorno: andamento stagione, proposte miglioramento, varie ed eventuali.', target: 'role' as const, target_roles: ['capo_servizio', 'dipendente'] },
]

// ── Helpers ─────────────────────────────────────────────────────────────────

function nameToUsername(name: string, uid: string, restIdx: number): string {
  return name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '') + `.r${restIdx}.${uid}`
}

// Build ISO UTC timestamp from local Italian date + time (CEST = UTC+2)
function ts(dateStr: string, localTime: string, offsetMinutes = 0): string {
  const [hh, mm] = localTime.split(':').map(Number)
  const totalMin = hh * 60 + mm + offsetMinutes - 120 // subtract CEST offset
  const h = Math.floor(((totalMin % 1440) + 1440) % 1440 / 60)
  const m = Math.abs(totalMin % 60)
  return `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`
}

function getEmployeeDept(departments: string[], empIdx: number): string {
  if (empIdx === 0) return departments[0]
  const rest = empIdx - 1  // 0-8
  if (departments.length === 1) return departments[0]
  if (departments.length === 2) return rest < 5 ? departments[0] : departments[1]
  // 3 depts: 3 each
  return departments[Math.floor(rest / 3) % departments.length]
}

// ── Main: create all demo data ───────────────────────────────────────────────

export async function createDemoData(managerId: string): Promise<string[]> {
  const admin = createAdminClient()
  const uid   = managerId.slice(0, 8)
  const today = new Date()

  // ── 1. Create 5 demo restaurants ──────────────────────────────────────────
  const { data: restaurants, error: restErr } = await admin
    .from('restaurants')
    .insert(RESTAURANT_CONFIGS.map((r, i) => ({
      name:         r.name,
      address:      r.address,
      closing_days: r.closing_days,
      qr_secret:    `demo-${managerId}-${i}`,
      is_demo:      true,
      owner_id:     managerId,
    })))
    .select('id, closing_days')

  if (restErr || !restaurants?.length) throw new Error('Errore creazione ristoranti demo: ' + restErr?.message)

  const restaurantIds = restaurants.map(r => r.id)

  // ── 2. Create employees for each restaurant (parallel) ───────────────────
  const allEmployeeProfiles: { id: string; department: string; restaurant_id: string; rest_day_offset: number }[] = []

  await Promise.all(restaurantIds.map(async (restaurantId, rIdx) => {
    const cfg  = RESTAURANT_CONFIGS[rIdx]
    const names = EMPLOYEE_NAMES[rIdx]

    const createdProfiles = await Promise.all(names.map(async (empName, empIdx) => {
      const dept     = getEmployeeDept(cfg.departments, empIdx)
      const role     = empIdx === 0 ? 'capo_servizio' : 'dipendente'
      const username = nameToUsername(empName, uid, rIdx)
      const email    = `${username}@demo.struttura.local`

      const { data: authData, error: authErr } = await admin.auth.admin.createUser({
        email,
        password:      'demo-pass-' + uid,
        email_confirm: true,
        user_metadata: { full_name: empName, role },
      })
      if (authErr || !authData?.user) return null

      await admin.from('profiles').upsert({
        id:                        authData.user.id,
        full_name:                 empName,
        username,
        role,
        department:                dept,
        restaurant_id:             restaurantId,
        account_status:            'active',
        is_direttore:              empIdx === 0,
        can_post_bulletin:         empIdx === 0,
        weekly_rest_days:          1,
        primary_slot_ids:          [],
        secondary_departments:     [],
        consultant_restaurant_ids: [],
        can_view_hours:            false,
      })

      return { id: authData.user.id, department: dept, restaurant_id: restaurantId, rest_day_offset: empIdx % 6 }
    }))

    allEmployeeProfiles.push(...createdProfiles.filter(Boolean) as typeof allEmployeeProfiles)
  }))

  // ── 3. Shift slots per restaurant ─────────────────────────────────────────
  const allSlots: object[] = []
  for (let rIdx = 0; rIdx < restaurantIds.length; rIdx++) {
    const cfg = RESTAURANT_CONFIGS[rIdx]
    for (const dept of cfg.departments) {
      const templates = SLOT_TEMPLATES[dept] ?? []
      for (const tpl of templates) {
        allSlots.push({ ...tpl, department: dept, restaurant_id: restaurantIds[rIdx], days_of_week: [] })
      }
    }
  }
  if (allSlots.length) await admin.from('shift_slots').insert(allSlots)

  // ── 4. Attendance records for the last 60 days ────────────────────────────
  const attendances: object[] = []
  const twoMonthsAgo = subDays(today, 60)

  for (const emp of allEmployeeProfiles) {
    const cfg = RESTAURANT_CONFIGS[restaurantIds.indexOf(emp.restaurant_id)]
    const shifts = SHIFT_TIMES[emp.department] ?? SHIFT_TIMES['Sala']
    let dayOff = 0  // rest day counter within the week

    let d = new Date(twoMonthsAgo)
    while (d < today) {
      const dow  = getDay(d)         // 0=Sun
      const dateStr = format(d, 'yyyy-MM-dd')

      // Skip closing days and Sundays (dow=0 always closed for simplicity)
      if (!cfg.closing_days.includes(dow) && dow !== 0) {
        // Each employee rests 1 day per working week (Mon offset by emp)
        const weekMon = 1 + emp.rest_day_offset  // 1=Mon..6=Sat
        const isRestDay = dow === weekMon

        if (!isRestDay) {
          // ~90% attendance
          const hash = (emp.id.charCodeAt(0) + dateStr.charCodeAt(5)) % 10
          if (hash > 0) {  // skip ~10% days (no show / off)
            const isEvening = emp.department === 'Bar' ? false : (parseInt(dateStr.slice(-2)) % 2 === 0)
            const [start, end] = isEvening ? shifts.evening : shifts.morning
            // slight random variation: ±5 min on check-in, +5..+20 on check-out
            const inOffset  = -5 + (emp.id.charCodeAt(1) % 10)   // -5..+5 min
            const outOffset = 5  + (emp.id.charCodeAt(2) % 15)   // +5..+20 min

            attendances.push({
              user_id:              emp.id,
              restaurant_id:        emp.restaurant_id,
              check_in:             ts(dateStr, start, inOffset),
              check_out:            ts(dateStr, end, outOffset),
              is_split_shift:       false,
              needs_manager_approval: false,
            })
          }
        }
      }
      d = addDays(d, 1)
      dayOff++
    }
  }

  // Bulk insert attendances in chunks to avoid payload limits
  for (let i = 0; i < attendances.length; i += 500) {
    await admin.from('attendances').insert(attendances.slice(i, i + 500))
  }

  // ── 5. Turns for current + next 3 weeks ───────────────────────────────────
  const turns: object[] = []
  const weekStart = startOfWeek(today, { weekStartsOn: 1 })

  for (let week = 0; week < 4; week++) {
    const wStart = addWeeks(weekStart, week)
    for (let dayOff = 0; dayOff < 6; dayOff++) {
      const d2     = addDays(wStart, dayOff)
      const dow    = getDay(d2)
      const dateStr = format(d2, 'yyyy-MM-dd')

      for (const emp of allEmployeeProfiles) {
        const cfg = RESTAURANT_CONFIGS[restaurantIds.indexOf(emp.restaurant_id)]
        if (cfg.closing_days.includes(dow)) continue

        const restDow = 1 + emp.rest_day_offset
        if (dow === restDow) {
          turns.push({ user_id: emp.id, restaurant_id: emp.restaurant_id, department: emp.department, date: dateStr, start_time: '00:00', end_time: '00:00', is_rest_day: true, is_extraordinary: false, created_by: managerId })
          continue
        }

        const shifts   = SHIFT_TIMES[emp.department] ?? SHIFT_TIMES['Sala']
        const isEvening = emp.department === 'Bar' ? false : dayOff % 2 === 0
        const [start, end] = isEvening ? shifts.evening : shifts.morning
        turns.push({ user_id: emp.id, restaurant_id: emp.restaurant_id, department: emp.department, date: dateStr, start_time: start, end_time: end, is_rest_day: false, is_extraordinary: false, created_by: managerId })
      }
    }
  }

  for (let i = 0; i < turns.length; i += 500) {
    await admin.from('turns').insert(turns.slice(i, i + 500))
  }

  // ── 6. ODS tasks ──────────────────────────────────────────────────────────
  const odsTasks: object[] = []

  for (let rIdx = 0; rIdx < restaurantIds.length; rIdx++) {
    const cfg   = RESTAURANT_CONFIGS[rIdx]
    const rId   = restaurantIds[rIdx]
    const rEmps = allEmployeeProfiles.filter(e => e.restaurant_id === rId)
    const capo  = rEmps[0]  // capo_servizio
    const emp1  = rEmps[1]  // first dipendente
    const emp2  = rEmps[4]  // first cucina/other dept

    // General restaurant tasks
    for (const t of ODS_RESTAURANT_TASKS) {
      const deptEmps = t.department ? rEmps.filter(e => e.department === t.department) : rEmps
      odsTasks.push({
        title: t.title, department: t.department ?? cfg.departments[0],
        restaurant_id: rId, creator_id: managerId,
        assigned_to: capo?.id ?? null,
        type: t.type, recurrence_days: t.recurrence_days,
      })
    }

    // Per-department tasks
    for (const dept of cfg.departments) {
      const deptTemplates = ODS_DEPT_TASKS[dept] ?? []
      const deptEmps = rEmps.filter(e => e.department === dept)
      for (const t of deptTemplates) {
        odsTasks.push({
          title: t.title, department: dept,
          restaurant_id: rId, creator_id: managerId,
          assigned_to: null,  // department-wide (no individual)
          type: t.type, recurrence_days: t.recurrence_days,
        })
      }

      // One task assigned to specific employee in this dept
      if (deptEmps[0]) {
        odsTasks.push({
          title: `Report settimanale ${dept}`,
          department: dept, restaurant_id: rId, creator_id: managerId,
          assigned_to: deptEmps[0].id,
          type: 'settimanale', recurrence_days: ['venerdì'],
        })
      }
    }

    // Personal task for first dipendente
    if (emp1) {
      odsTasks.push({
        title: 'Inventario personale attrezzature',
        department: emp1.department, restaurant_id: rId, creator_id: managerId,
        assigned_to: emp1.id,
        type: 'bisettimanale', recurrence_days: ['lunedì', 'giovedì'],
      })
    }
  }

  if (odsTasks.length) await admin.from('ods_tasks').insert(odsTasks)

  // ── 7. Bulletins ──────────────────────────────────────────────────────────
  const bulletins: object[] = []

  for (let rIdx = 0; rIdx < restaurantIds.length; rIdx++) {
    const rId  = restaurantIds[rIdx]
    const cfg  = RESTAURANT_CONFIGS[rIdx]
    const rEmps = allEmployeeProfiles.filter(e => e.restaurant_id === rId)

    // General restaurant announcements (2 per restaurant)
    bulletins.push({
      title: BULLETIN_TEMPLATES[rIdx % BULLETIN_TEMPLATES.length].title,
      body:  BULLETIN_TEMPLATES[rIdx % BULLETIN_TEMPLATES.length].body,
      target: 'all', target_roles: [], target_user_ids: [], target_department: null,
      restaurant_id: rId, created_by: managerId,
    })

    bulletins.push({
      title: 'Aggiornamento procedure sicurezza',
      body:  `Si informano tutti i dipendenti di ${cfg.name} che le procedure di sicurezza sono state aggiornate. Consultare l'apposita bacheca fisica per i dettagli operativi.`,
      target: 'all', target_roles: [], target_user_ids: [], target_department: null,
      restaurant_id: rId, created_by: managerId,
    })

    // Department-specific bulletins for each dept
    for (const dept of cfg.departments) {
      const deptTpl = BULLETIN_TEMPLATES.find(b => b.target === 'department' && b.target_department === dept)
      bulletins.push({
        title: deptTpl?.title ?? `Comunicazione reparto ${dept}`,
        body:  deptTpl?.body ?? `Aggiornamento operativo per il reparto ${dept}. Si prega di prenderne visione e di applicare le indicazioni nel prossimo turno.`,
        target: 'department', target_roles: [], target_user_ids: [], target_department: dept,
        restaurant_id: rId, created_by: managerId,
      })
    }

    // Personal bulletin for a specific employee
    const targetEmp = rEmps.find(e => e.department === cfg.departments[0] && e !== rEmps[0])
    if (targetEmp) {
      bulletins.push({
        title: 'Comunicazione personale',
        body:  'Ti informiamo che la tua richiesta di cambio turno per il prossimo weekend è stata approvata. Ricordati di concordare la copertura con un collega.',
        target: 'users', target_roles: [], target_user_ids: [targetEmp.id], target_department: null,
        restaurant_id: rId, created_by: managerId,
      })
    }

    // Capo_servizio announcement
    bulletins.push({
      title: 'Riunione capiservizie',
      body:  `Convoco tutti i capiservizie di ${cfg.name} per lunedì alle 09:30 per la pianificazione del mese. Portate il calendario delle disponibilità.`,
      target: 'role', target_roles: ['capo_servizio'], target_user_ids: [], target_department: null,
      restaurant_id: rId, created_by: managerId,
    })
  }

  if (bulletins.length) await admin.from('bulletins').insert(bulletins)

  return restaurantIds
}

// ── Delete all demo data for a manager ──────────────────────────────────────

export async function deleteDemoData(managerId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: demoRests } = await admin
    .from('restaurants')
    .select('id')
    .eq('is_demo', true)
    .eq('owner_id', managerId)

  if (!demoRests?.length) return

  for (const rest of demoRests) {
    const rid = rest.id

    const { data: demoProfiles } = await admin
      .from('profiles')
      .select('id')
      .eq('restaurant_id', rid)
      .neq('id', managerId)

    // Delete ODS completions via task IDs
    const { data: odsTasks } = await admin.from('ods_tasks').select('id').eq('restaurant_id', rid)
    if (odsTasks?.length) {
      await admin.from('ods_completions').delete().in('task_id', odsTasks.map(t => t.id))
    }

    // Delete bulletins
    await admin.from('bulletins').delete().eq('restaurant_id', rid)

    // Delete AI drafts
    const { data: drafts } = await admin.from('ai_schedule_drafts').select('id').eq('restaurant_id', rid)
    if (drafts?.length) {
      await admin.from('ai_schedule_draft_turns').delete().in('draft_id', drafts.map(d => d.id))
    }
    await admin.from('ai_schedule_drafts').delete().eq('restaurant_id', rid)

    await admin.from('ods_tasks').delete().eq('restaurant_id', rid)
    await admin.from('turns').delete().eq('restaurant_id', rid)
    await admin.from('shift_slots').delete().eq('restaurant_id', rid)
    await admin.from('absences').delete().eq('restaurant_id', rid)
    await admin.from('attendances').delete().eq('restaurant_id', rid)

    if (demoProfiles?.length) {
      await admin.from('profiles').delete().in('id', demoProfiles.map(p => p.id))
      for (const p of demoProfiles) {
        await admin.auth.admin.deleteUser(p.id).catch(() => {})
      }
    }

    await admin.from('restaurants').delete().eq('id', rid)
  }
}
