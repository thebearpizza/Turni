'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { startOfWeek, addDays, format, getDay, differenceInMinutes, parseISO } from 'date-fns'
import type {
  Department, Profile, Turn, ShiftSlot,
  AiScheduleDraft, AiScheduleDraftTurn,
  AiScheduleWarning, ExtraordinaryClosure, ExistingTurnsMode,
  SecondaryDepartment,
} from '@/types'

// ── Tipi interni ──────────────────────────────────────────────────────────

interface EmployeeWithProfile extends Profile {
  // ore settimanali già accumulate nella bozza (aggiornate durante la generazione)
  _weeklyMinutes: number
}

export interface GenerateParams {
  restaurantId:          string
  weekStart:             string              // yyyy-MM-dd (lunedì)
  departmentScope:       Department[] | null // null = tutti
  existingTurnsMode:     ExistingTurnsMode
  extraordinaryClosures: ExtraordinaryClosure[]
  notes?:                string              // testo libero dal campo NL
}

interface AttendancePattern {
  userId:          string
  isSplitShift:    boolean    // tipicamente fa lo spezzato
  avgSplitGap:     number     // minuti di pausa media nello spezzato
  morningStart:    string     // HH:mm — ora inizio media mattina
  morningEnd:      string     // HH:mm — ora fine media mattina
  eveningStart:    string     // HH:mm — ora inizio media sera (se spezzato)
  eveningEnd:      string     // HH:mm — ora fine media sera
}

interface DeadZone {
  department: Department
  startTime:  string    // HH:mm
  endTime:    string    // HH:mm
}

// ── Helpers ───────────────────────────────────────────────────────────────

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60) % 24
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function avg(nums: number[]): number {
  if (!nums.length) return 0
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
}

// ── Autorizzazione ────────────────────────────────────────────────────────

async function getCallerAndScope() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Non autenticato')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, department, is_direttore')
    .eq('id', user.id)
    .single()
  if (!profile) throw new Error('Profilo non trovato')
  if (!['manager', 'capo_servizio'].includes(profile.role)) throw new Error('Non autorizzato')

  return { supabase, user, profile }
}

// ── Analisi presenze storiche ─────────────────────────────────────────────
// Legge le ultime 8 settimane di attendance per apprendere i pattern reali:
// - chi fa spezzato
// - orari tipici mattina/sera
// - fasce "morte" per reparto (ore di bassa presenza aggregata)

async function learnFromAttendance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  restaurantId: string,
  weekStart: string,
): Promise<{ patterns: Map<string, AttendancePattern>; deadZones: DeadZone[] }> {
  const eightWeeksAgo = format(addDays(parseISO(weekStart), -56), 'yyyy-MM-dd')

  const { data: records } = await supabase
    .from('attendances')
    .select('user_id, check_in, check_out, restaurant_id')
    .eq('restaurant_id', restaurantId)
    .gte('check_in', eightWeeksAgo)
    .lt('check_in', weekStart)
    .not('check_out', 'is', null)

  const patterns = new Map<string, AttendancePattern>()
  if (!records?.length) return { patterns, deadZones: [] }

  // Raggruppa per (user_id, data)
  const byUserDay = new Map<string, typeof records>()
  for (const r of records) {
    const day = r.check_in.slice(0, 10)
    const key = `${r.user_id}|${day}`
    if (!byUserDay.has(key)) byUserDay.set(key, [])
    byUserDay.get(key)!.push(r)
  }

  // Per ogni utente, calcola se fa spezzato e gli orari medi
  const userStats = new Map<string, {
    splitCount: number; totalCount: number
    morningStarts: number[]; morningEnds: number[]
    eveningStarts: number[]; eveningEnds: number[]
    splitGaps: number[]
  }>()

  for (const [key, dayRecords] of byUserDay) {
    const userId = key.split('|')[0]
    if (!userStats.has(userId)) {
      userStats.set(userId, {
        splitCount: 0, totalCount: 0,
        morningStarts: [], morningEnds: [],
        eveningStarts: [], eveningEnds: [],
        splitGaps: [],
      })
    }
    const stats = userStats.get(userId)!
    stats.totalCount++

    const sorted = dayRecords.sort((a, b) => a.check_in.localeCompare(b.check_in))
    const checkIn  = sorted[0].check_in
    const checkOut = sorted[sorted.length - 1].check_out!

    const startMin = timeToMinutes(checkIn.slice(11, 16))
    const endMin   = timeToMinutes(checkOut.slice(11, 16))

    if (sorted.length >= 2) {
      // Spezzato: due sessioni nella stessa giornata
      stats.splitCount++
      const midEnd   = timeToMinutes(sorted[0].check_out!.slice(11, 16))
      const midStart = timeToMinutes(sorted[1].check_in.slice(11, 16))
      stats.splitGaps.push(midStart - midEnd)
      stats.morningStarts.push(startMin)
      stats.morningEnds.push(midEnd)
      stats.eveningStarts.push(midStart)
      stats.eveningEnds.push(endMin)
    } else {
      stats.morningStarts.push(startMin)
      stats.morningEnds.push(endMin)
    }
  }

  for (const [userId, stats] of userStats) {
    const splitRatio = stats.splitCount / (stats.totalCount || 1)
    const isSplit = splitRatio >= 0.5  // spezzato nel ≥50% dei casi → pattern

    patterns.set(userId, {
      userId,
      isSplitShift: isSplit,
      avgSplitGap:  avg(stats.splitGaps),
      morningStart: minutesToTime(avg(stats.morningStarts)),
      morningEnd:   minutesToTime(avg(stats.morningEnds)),
      eveningStart: minutesToTime(avg(stats.eveningStarts.length ? stats.eveningStarts : stats.morningStarts)),
      eveningEnd:   minutesToTime(avg(stats.eveningEnds.length   ? stats.eveningEnds   : stats.morningEnds)),
    })
  }

  // Calcola "dead zones" per reparto:
  // le fasce orarie in cui la presenza aggregata scende sotto il 30% del picco
  const SLOT_MIN = 30  // granularità 30 minuti
  const slotCounts: Record<string, number[]> = {}  // dept → array[48] (slots da 00:00 a 23:30)

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, department')
    .eq('restaurant_id', restaurantId)

  const userDept = new Map(profiles?.map(p => [p.id, p.department]) ?? [])

  for (const r of records) {
    const dept = userDept.get(r.user_id)
    if (!dept || !r.check_out) continue
    if (!slotCounts[dept]) slotCounts[dept] = new Array(48).fill(0)

    const startMin = timeToMinutes(r.check_in.slice(11, 16))
    const endMin   = timeToMinutes(r.check_out.slice(11, 16))

    for (let s = Math.floor(startMin / SLOT_MIN); s < Math.min(48, Math.ceil(endMin / SLOT_MIN)); s++) {
      slotCounts[dept][s]++
    }
  }

  const deadZones: DeadZone[] = []
  for (const [dept, counts] of Object.entries(slotCounts)) {
    const peak = Math.max(...counts)
    if (peak < 3) continue  // troppo pochi dati

    let inDead = false
    let deadStart = 0
    for (let s = 0; s < 48; s++) {
      const isDead = counts[s] < peak * 0.3
      if (isDead && !inDead) { inDead = true; deadStart = s }
      if (!isDead && inDead) {
        inDead = false
        const durationSlots = s - deadStart
        if (durationSlots >= 3) {  // almeno 90 min di pausa significativa
          deadZones.push({
            department: dept as Department,
            startTime:  minutesToTime(deadStart * SLOT_MIN),
            endTime:    minutesToTime(s * SLOT_MIN),
          })
        }
      }
    }
  }

  return { patterns, deadZones }
}

// ── Algoritmo principale ──────────────────────────────────────────────────

interface GenerationResult {
  draft:    Omit<AiScheduleDraft, 'id' | 'created_at' | 'updated_at'>
  turns:    Omit<AiScheduleDraftTurn, 'id' | 'draft_id' | 'created_at'>[]
  warnings: AiScheduleWarning[]
}

function buildSchedule(params: {
  weekDays:              Date[]
  employees:             EmployeeWithProfile[]
  slots:                 ShiftSlot[]
  absences:              Array<{ user_id: string; start_date: string; end_date: string }>
  existingTurns:         Turn[]
  existingTurnsMode:     ExistingTurnsMode
  closingDays:           number[]
  extraordinaryClosures: ExtraordinaryClosure[]
  departmentScope:       Department[] | null
  patterns:              Map<string, AttendancePattern>
  deadZones:             DeadZone[]
}): GenerationResult['turns'] & { warnings: AiScheduleWarning[] } {
  const {
    weekDays, employees, slots, absences, existingTurns,
    existingTurnsMode, closingDays, extraordinaryClosures, departmentScope,
    patterns, deadZones,
  } = params

  const result: GenerationResult['turns'] = []
  const warnings: AiScheduleWarning[] = []

  // Indici rapidi
  const absenceSet = new Set(
    absences.map(a => {
      const start = a.start_date; const end = a.end_date
      const dates: string[] = []
      let cur = new Date(start + 'T00:00:00')
      const endD = new Date(end + 'T00:00:00')
      while (cur <= endD) {
        dates.push(format(cur, 'yyyy-MM-dd'))
        cur = addDays(cur, 1)
      }
      return dates.map(d => `${a.user_id}|${d}`)
    }).flat()
  )
  const existingKey = new Set(existingTurns.map(t => `${t.user_id}|${t.date}`))

  // Ore lavorate questa settimana per dipendente (aggiornate in tempo reale)
  const weeklyMinutes: Record<string, number> = {}
  for (const emp of employees) weeklyMinutes[emp.id] = 0

  // Dipendenti assegnati per giorno (evita doppi turni nello stesso slot)
  const assignedToday: Record<string, Set<string>> = {}  // dateStr → Set<userId>

  // Dipendenti con ruolo di senior (can_substitute_capo_servizio)
  const isSenior = new Set(employees.filter(e => e.can_substitute_capo_servizio).map(e => e.id))

  // Reparti da generare
  const depts = departmentScope ?? (['Sala', 'Pizzeria', 'Bar', 'Cucina'] as Department[])

  for (const day of weekDays) {
    const dateStr = format(day, 'yyyy-MM-dd')
    const dow = getDay(day)  // 0=Dom..6=Sab

    if (!assignedToday[dateStr]) assignedToday[dateStr] = new Set()

    // Giorno di chiusura ordinaria
    if (closingDays.includes(dow)) continue

    for (const dept of depts) {
      // Chiusura straordinaria per questo giorno/reparto
      const isClosed = extraordinaryClosures.some(
        c => c.date === dateStr && (!c.department || c.department === dept)
      )
      if (isClosed) continue

      // Fasce del reparto valide per questo giorno
      const daySlots = slots.filter(
        s => s.department === dept &&
          (s.days_of_week.length === 0 || s.days_of_week.includes(dow))
      )
      if (!daySlots.length) continue

      // Dipendenti primari del reparto disponibili oggi
      const primaryAvail = employees.filter(e =>
        e.department === dept &&
        !absenceSet.has(`${e.id}|${dateStr}`) &&
        (existingTurnsMode === 'replace' || !existingKey.has(`${e.id}|${dateStr}`)) &&
        !assignedToday[dateStr].has(e.id)
      )

      // Dead zone per questo reparto oggi
      const dz = deadZones.find(z => z.department === dept)

      for (const slot of daySlots) {
        // Evita slot nelle dead zone (< 2 richiesti = può restare con 1 persona)
        const slotStart = timeToMinutes(slot.start_time)
        // Per turni notturni (fine < inizio) aggiungiamo 24h così la durata è positiva
        let slotEnd = timeToMinutes(slot.end_time)
        if (slotEnd <= slotStart) slotEnd += 24 * 60
        const dzStart   = dz ? timeToMinutes(dz.startTime) : 0
        const dzEnd     = dz ? timeToMinutes(dz.endTime) : 0
        const inDeadZone = dz && slotStart >= dzStart && slotEnd <= dzEnd

        let needed = inDeadZone ? Math.min(1, slot.required_count) : slot.required_count
        const assignedThisSlot: string[] = []

        // ── Step 1: dipendenti primari (min ore prima) ──
        const candidates = [...primaryAvail]
          .filter(e => !assignedToday[dateStr].has(e.id))
          .sort((a, b) => (weeklyMinutes[a.id] ?? 0) - (weeklyMinutes[b.id] ?? 0))

        // Almeno 1 senior deve essere presente (se il reparto lo richiede)
        // Verifica se tra i candidati c'è già un senior
        const hasSeniorCandidate = candidates.some(c => isSenior.has(c.id))

        for (const emp of candidates) {
          if (needed <= 0) break
          // Rispetta ore target part-time
          const targetMin = emp.weekly_hours_target ? emp.weekly_hours_target * 60 : Infinity
          const slotMin = slotEnd - slotStart
          if (weeklyMinutes[emp.id] + slotMin > targetMin + 30) continue  // +30 min tolleranza

          assignedThisSlot.push(emp.id)
          assignedToday[dateStr].add(emp.id)
          weeklyMinutes[emp.id] = (weeklyMinutes[emp.id] ?? 0) + slotMin

          const pattern = patterns.get(emp.id)
          if (pattern?.isSplitShift && !inDeadZone && slotStart < 720) {
            // Spezzato mattina
            result.push({
              user_id: emp.id, department: dept, date: dateStr,
              start_time: pattern.morningStart, end_time: pattern.morningEnd,
              is_rest_day: false, is_extraordinary: false,
              is_cross_dept: false, original_department: null,
              warning: null, status: 'pending',
            })
            if (pattern.eveningStart) {
              result.push({
                user_id: emp.id, department: dept, date: dateStr,
                start_time: pattern.eveningStart, end_time: pattern.eveningEnd,
                is_rest_day: false, is_extraordinary: false,
                is_cross_dept: false, original_department: null,
                warning: null, status: 'pending',
              })
            }
          } else {
            result.push({
              user_id: emp.id, department: dept, date: dateStr,
              start_time: slot.start_time, end_time: slot.end_time,
              is_rest_day: false, is_extraordinary: false,
              is_cross_dept: false, original_department: null,
              warning: null, status: 'pending',
            })
          }
          needed--
        }

        // ── Step 2: jolly (secondary_departments) ──
        // Un dipendente è jolly per questo slot se ha il suo slot_id nei secondary_departments
        if (needed > 0) {
          const jolly = employees.filter(e =>
            e.department !== dept &&
            (e.secondary_departments ?? []).some((sd: SecondaryDepartment) => sd.slot_id === slot.id) &&
            !absenceSet.has(`${e.id}|${dateStr}`) &&
            !assignedToday[dateStr].has(e.id) &&
            (existingTurnsMode === 'replace' || !existingKey.has(`${e.id}|${dateStr}`))
          ).sort((a, b) => {
            const pa = (a.secondary_departments ?? []).find((sd: SecondaryDepartment) => sd.slot_id === slot.id)?.priority ?? 99
            const pb = (b.secondary_departments ?? []).find((sd: SecondaryDepartment) => sd.slot_id === slot.id)?.priority ?? 99
            return pa - pb || (weeklyMinutes[a.id] ?? 0) - (weeklyMinutes[b.id] ?? 0)
          })

          for (const emp of jolly) {
            if (needed <= 0) break
            assignedThisSlot.push(emp.id)
            assignedToday[dateStr].add(emp.id)
            const slotMin = slotEnd - slotStart
            weeklyMinutes[emp.id] = (weeklyMinutes[emp.id] ?? 0) + slotMin

            result.push({
              user_id: emp.id, department: dept, date: dateStr,
              start_time: slot.start_time, end_time: slot.end_time,
              is_rest_day: false, is_extraordinary: false,
              is_cross_dept: true, original_department: emp.department,
              warning: null, status: 'pending',
            })
            needed--
          }
        }

        // ── Step 3: straordinario (proponi al meno carico già assegnato) ──
        if (needed > 0) {
          const alreadyInSlot = result.filter(
            t => t.date === dateStr && t.department === dept && !t.is_rest_day
          )
          const extraCandidates = employees
            .filter(e => alreadyInSlot.some(t => t.user_id === e.id))
            .sort((a, b) => (weeklyMinutes[a.id] ?? 0) - (weeklyMinutes[b.id] ?? 0))

          if (extraCandidates.length > 0) {
            const emp = extraCandidates[0]
            result.push({
              user_id: emp.id, department: dept, date: dateStr,
              start_time: slot.start_time, end_time: slot.end_time,
              is_rest_day: false, is_extraordinary: true,
              is_cross_dept: false, original_department: null,
              warning: `Straordinario proposto: copertura mancante (${needed} pers.)`,
              status: 'pending',
            })
            needed--
          }
        }

        // ── Verifica senior obbligatorio ──────────────────────────────────
        // Se nessun assegnato è senior e il reparto ha personale che non può stare da solo
        const anyoneAssigned = assignedThisSlot.length > 0
        const seniorPresent = assignedThisSlot.some(id => isSenior.has(id))
        if (anyoneAssigned && !seniorPresent && hasSeniorCandidate) {
          warnings.push({
            day: dateStr, department: dept, slot_name: slot.name,
            message: `Nessun senior presente — ${slot.name} ${dept}: i presenti potrebbero non poter stare da soli`,
          })
        }

        // ── Gap residuo ───────────────────────────────────────────────────
        if (needed > 0) {
          warnings.push({
            day: dateStr, department: dept, slot_name: slot.name,
            message: `Copertura insufficiente: mancano ${needed} ${needed === 1 ? 'persona' : 'persone'}`,
            missing_count: needed,
          })
        }
      }
    }
  }

  // ── Riposi ────────────────────────────────────────────────────────────
  // Assegna giorni di riposo preferendo lun-ven (regola "no riposi weekend" = ultima spiaggia)
  const WEEKDAY_PREFERENCE = [1, 2, 3, 4, 5, 6, 0]  // Lun→Ven, poi Sab, poi Dom

  for (const emp of employees) {
    if (emp.department && !depts.includes(emp.department)) continue

    const alreadyRestDays = result.filter(t => t.user_id === emp.id && t.is_rest_day).length
    const neededRest = emp.weekly_rest_days - alreadyRestDays
    if (neededRest <= 0) continue

    // Conta solo i giorni lavorativi (non chiusure)
    const workableDays = weekDays.filter(d => !closingDays.includes(getDay(d)))
    const workedDays = result.filter(
      t => t.user_id === emp.id && !t.is_rest_day
    ).map(t => t.date)

    const restCandidates = WEEKDAY_PREFERENCE
      .map(dow => workableDays.filter(d => getDay(d) === dow))
      .flat()
      .filter(d => {
        const ds = format(d, 'yyyy-MM-dd')
        return !absenceSet.has(`${emp.id}|${ds}`) &&
          !workedDays.includes(ds) &&
          !result.some(t => t.user_id === emp.id && t.date === ds && t.is_rest_day)
      })

    // Preferisce il giorno configurato nel profilo
    if (emp.preferred_rest_day != null) {
      const preferred = restCandidates.filter(d => getDay(d) === emp.preferred_rest_day)
      const others = restCandidates.filter(d => getDay(d) !== emp.preferred_rest_day)
      restCandidates.splice(0, restCandidates.length, ...preferred, ...others)
    }

    const toAssign = restCandidates.slice(0, neededRest)
    for (const d of toAssign) {
      result.push({
        user_id: emp.id, department: emp.department, date: format(d, 'yyyy-MM-dd'),
        start_time: '00:00', end_time: '00:00',
        is_rest_day: true, is_extraordinary: false,
        is_cross_dept: false, original_department: null,
        warning: null, status: 'pending',
      })
    }
  }

  return Object.assign(result, { warnings })
}

// ── Server Actions ────────────────────────────────────────────────────────

export async function generateAiSchedule(params: GenerateParams): Promise<AiScheduleDraft & { turns: AiScheduleDraftTurn[] }> {
  const { supabase, user, profile } = await getCallerAndScope()

  // RBAC: capo_servizio può generare solo per il proprio ristorante (e reparto se non direttore)
  if (profile.role === 'capo_servizio') {
    if (params.restaurantId !== profile.restaurant_id) throw new Error('Non autorizzato')
    if (!profile.is_direttore && params.departmentScope) {
      const allowed = params.departmentScope.filter(d => d === profile.department)
      if (!allowed.length) throw new Error('Non autorizzato: reparto non di competenza')
      params.departmentScope = allowed
    }
  }

  const weekStart = params.weekStart
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(parseISO(weekStart + 'T00:00:00'), i))
  const weekEnd = format(weekDays[6], 'yyyy-MM-dd')

  // Fetch parallelo di tutto il necessario
  const [
    restaurantRes, slotsRes, employeesRes, absencesRes, existingTurnsRes,
  ] = await Promise.all([
    supabase.from('restaurants').select('closing_days').eq('id', params.restaurantId).single(),
    supabase.from('shift_slots').select('*').eq('restaurant_id', params.restaurantId),
    supabase.from('profiles').select('*').eq('restaurant_id', params.restaurantId)
      .in('role', ['dipendente', 'capo_servizio'])
      .neq('role', 'consulente_lavoro'),
    supabase.from('absences').select('user_id, start_date, end_date')
      .eq('restaurant_id', params.restaurantId)
      .eq('status', 'approved')
      .lte('start_date', weekEnd)
      .gte('end_date', weekStart),
    params.existingTurnsMode === 'integrate'
      ? supabase.from('turns').select('*')
          .eq('restaurant_id', params.restaurantId)
          .gte('date', weekStart)
          .lte('date', weekEnd)
      : Promise.resolve({ data: [] }),
  ])

  const closingDays: number[] = restaurantRes.data?.closing_days ?? []
  const slots: ShiftSlot[] = (slotsRes.data ?? []) as ShiftSlot[]
  const employees: EmployeeWithProfile[] = ((employeesRes.data ?? []) as Profile[]).map(e => ({
    ...e,
    secondary_departments: (e.secondary_departments ?? []) as unknown as import('@/types').SecondaryDepartment[],
    _weeklyMinutes: 0,
  }))
  const absences = absencesRes.data ?? []
  const existingTurns: Turn[] = (existingTurnsRes.data ?? []) as Turn[]

  // Apprendi dai dati storici di presenza
  const { patterns, deadZones } = await learnFromAttendance(supabase, params.restaurantId, weekStart)

  // Genera la bozza
  const generated = buildSchedule({
    weekDays, employees, slots, absences, existingTurns,
    existingTurnsMode: params.existingTurnsMode,
    closingDays,
    extraordinaryClosures: params.extraordinaryClosures,
    departmentScope: params.departmentScope,
    patterns, deadZones,
  })

  const warnings: AiScheduleWarning[] = generated.warnings ?? []

  // Salva bozza nel DB
  const { data: draft, error: draftError } = await supabase
    .from('ai_schedule_drafts')
    .insert({
      restaurant_id:          params.restaurantId,
      week_start:             weekStart,
      status:                 'draft',
      department_scope:       params.departmentScope,
      generated_by:           user.id,
      generation_params:      { existingTurnsMode: params.existingTurnsMode, notes: params.notes },
      extraordinary_closures: params.extraordinaryClosures,
      existing_turns_mode:    params.existingTurnsMode,
      warnings,
    })
    .select()
    .single()

  if (draftError || !draft) throw new Error(draftError?.message ?? 'Errore creazione bozza')

  // Salva i turni della bozza
  const turnRows = generated.map(t => ({ ...t, draft_id: draft.id }))
  const { data: turns, error: turnsError } = await supabase
    .from('ai_schedule_draft_turns')
    .insert(turnRows)
    .select('*, profile:profiles!user_id(id, full_name)')

  if (turnsError) throw new Error(turnsError.message)

  return { ...draft, turns: turns as unknown as AiScheduleDraftTurn[] }
}

export async function updateDraftTurn(
  turnId: string,
  update: Partial<Pick<AiScheduleDraftTurn, 'start_time' | 'end_time' | 'is_rest_day' | 'is_extraordinary' | 'status'>>,
): Promise<void> {
  const { supabase } = await getCallerAndScope()
  const { error } = await supabase
    .from('ai_schedule_draft_turns')
    .update({ ...update, status: 'modified' })
    .eq('id', turnId)
  if (error) throw new Error(error.message)
}

export async function rejectDraftTurn(turnId: string): Promise<void> {
  const { supabase } = await getCallerAndScope()
  const { error } = await supabase
    .from('ai_schedule_draft_turns')
    .update({ status: 'rejected' })
    .eq('id', turnId)
  if (error) throw new Error(error.message)
}

export async function confirmAiDraft(draftId: string): Promise<{ created: number }> {
  const { supabase, user, profile } = await getCallerAndScope()

  // Recupera bozza + turni non rifiutati
  const { data: draft } = await supabase
    .from('ai_schedule_drafts')
    .select('*, turns:ai_schedule_draft_turns(*)')
    .eq('id', draftId)
    .single()

  if (!draft) throw new Error('Bozza non trovata')

  // RBAC
  if (profile.role === 'capo_servizio' && draft.restaurant_id !== profile.restaurant_id) {
    throw new Error('Non autorizzato')
  }

  // Se modalità 'replace': elimina i turni esistenti nella settimana/scope
  if (draft.existing_turns_mode === 'replace') {
    let delQuery = supabase
      .from('turns')
      .delete()
      .eq('restaurant_id', draft.restaurant_id)
      .gte('date', draft.week_start)
      .lte('date', format(addDays(parseISO(draft.week_start + 'T00:00:00'), 6), 'yyyy-MM-dd'))

    if (draft.department_scope?.length) {
      delQuery = delQuery.in('department', draft.department_scope)
    }
    await delQuery
  }

  // Inserisci solo i turni non rifiutati
  const validTurns = (draft.turns as AiScheduleDraftTurn[]).filter(t => t.status !== 'rejected')

  if (!validTurns.length) {
    await supabase.from('ai_schedule_drafts').update({ status: 'confirmed' }).eq('id', draftId)
    return { created: 0 }
  }

  // Usa admin client per bypassare RLS sui jolly cross-dept
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const rows = validTurns.map(t => ({
    user_id:          t.user_id,
    restaurant_id:    draft.restaurant_id,
    department:       t.department,
    date:             t.date,
    start_time:       t.start_time,
    end_time:         t.end_time,
    is_extraordinary: t.is_extraordinary,
    is_rest_day:      t.is_rest_day,
    notes:            t.is_cross_dept ? `Jolly da ${t.original_department}` : (t.warning ?? null),
    created_by:       user.id,
  }))

  const { error } = await adminClient.from('turns').insert(rows)
  if (error) throw new Error(error.message)

  // Marca bozza confermata
  await supabase.from('ai_schedule_drafts').update({ status: 'confirmed' }).eq('id', draftId)

  // Push notification a tutti i dipendenti coinvolti
  const userIds = [...new Set(validTurns.map(t => t.user_id))]
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', userIds)

  if (subs?.length) {
    const weekLabel = format(parseISO(draft.week_start + 'T00:00:00'), "d MMM")
    const endLabel  = format(addDays(parseISO(draft.week_start + 'T00:00:00'), 6), "d MMM yyyy")

    // Fire-and-forget tramite API push interna
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/push/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_ids: userIds,
        title: 'Nuovi turni pubblicati',
        body:  `I turni della settimana ${weekLabel}–${endLabel} sono stati pubblicati.`,
        url:   '/home/miei-turni',
      }),
    }).catch(() => { /* non bloccante */ })
  }

  revalidatePath('/turni')
  return { created: rows.length }
}

export async function discardAiDraft(draftId: string): Promise<void> {
  const { supabase, profile } = await getCallerAndScope()
  const { data: draft } = await supabase
    .from('ai_schedule_drafts')
    .select('restaurant_id')
    .eq('id', draftId)
    .single()
  if (!draft) throw new Error('Bozza non trovata')
  if (profile.role === 'capo_servizio' && draft.restaurant_id !== profile.restaurant_id) {
    throw new Error('Non autorizzato')
  }
  await supabase.from('ai_schedule_drafts').update({ status: 'cancelled' }).eq('id', draftId)
}

export async function checkExistingTurns(restaurantId: string, weekStart: string, departmentScope: Department[] | null): Promise<number> {
  const { supabase } = await getCallerAndScope()
  const weekEnd = format(addDays(parseISO(weekStart + 'T00:00:00'), 6), 'yyyy-MM-dd')

  let q = supabase
    .from('turns')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .gte('date', weekStart)
    .lte('date', weekEnd)

  if (departmentScope?.length) q = q.in('department', departmentScope)
  const { count } = await q
  return count ?? 0
}
