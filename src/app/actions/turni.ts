'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { eachDayOfInterval, getDay, format } from 'date-fns'
import type { Department, Turn } from '@/types'

export interface TurnInput {
  user_id:          string
  restaurant_id:    string
  department:       Department | null
  date:             string
  start_time:       string
  end_time:         string
  is_extraordinary: boolean
  notes?:           string | null
}

export interface BulkTurnInput {
  user_id:          string
  restaurant_id:    string
  department:       Department | null
  start_date:       string
  end_date:         string
  days_of_week:     number[] // 0=Dom .. 6=Sab (date-fns getDay)
  start_time:       string
  end_time:         string
  is_extraordinary: boolean
  notes?:           string | null
}

export interface StandardShiftInput {
  user_id:       string
  restaurant_id: string
  department:    Department | null
  day_of_week:   number
  start_time:    string
  end_time:      string
}

interface CallerProfile {
  role:          string
  restaurant_id: string | null
  department:    Department | null
  is_direttore:  boolean
}

async function getCaller() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Non autenticato')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, department, is_direttore')
    .eq('id', user.id)
    .single()
  if (!profile) throw new Error('Profilo non trovato')

  if (!['manager', 'capo_servizio'].includes(profile.role)) {
    throw new Error('Non autorizzato')
  }

  return { supabase, user, profile: profile as CallerProfile }
}

// ── Query Scoping (RBAC) ────────────────────────────────────────────
// Manager     → GLOBALE: nessun vincolo
// Direttore   → LOCALE: solo restaurant_id proprio (tutti i reparti)
// Capo Serv.  → DIPARTIMENTALE: restaurant_id + department propri
function assertWithinScope(profile: CallerProfile, target: { restaurant_id: string; department: Department | null }) {
  if (profile.role === 'manager') {
    return // visibilità e modifica GLOBALE
  }
  if (profile.role === 'capo_servizio') {
    if (target.restaurant_id !== profile.restaurant_id) {
      throw new Error('Non autorizzato: ristorante non di tua competenza')
    }
    if (profile.is_direttore) {
      return // Direttore: tutti i reparti del proprio ristorante
    }
    if (target.department !== profile.department) {
      throw new Error('Non autorizzato: reparto non di tua competenza')
    }
    return
  }
  throw new Error('Non autorizzato')
}

export async function createTurn(input: TurnInput): Promise<Turn> {
  const { supabase, user, profile } = await getCaller()

  assertWithinScope(profile, { restaurant_id: input.restaurant_id, department: input.department })

  // Verify the assignee actually belongs to the caller's scope
  const { data: assignee } = await supabase
    .from('profiles')
    .select('id, restaurant_id, department')
    .eq('id', input.user_id)
    .single()
  if (!assignee) throw new Error('Dipendente non trovato')
  assertWithinScope(profile, { restaurant_id: assignee.restaurant_id, department: assignee.department })

  const { data, error } = await supabase
    .from('turns')
    .insert({
      user_id:          input.user_id,
      restaurant_id:    input.restaurant_id,
      department:       input.department,
      date:             input.date,
      start_time:       input.start_time,
      end_time:         input.end_time,
      is_extraordinary: input.is_extraordinary,
      notes:            input.notes ?? null,
      created_by:       user.id,
    })
    .select('*, profile:profiles!user_id(id, full_name)')
    .single()

  if (error) throw new Error(error.message)

  revalidatePath('/turni')
  return data as unknown as Turn
}

export async function updateTurn(id: string, input: TurnInput): Promise<Turn> {
  const { supabase, profile } = await getCaller()

  assertWithinScope(profile, { restaurant_id: input.restaurant_id, department: input.department })

  const { data: assignee } = await supabase
    .from('profiles')
    .select('id, restaurant_id, department')
    .eq('id', input.user_id)
    .single()
  if (!assignee) throw new Error('Dipendente non trovato')
  assertWithinScope(profile, { restaurant_id: assignee.restaurant_id, department: assignee.department })

  // RLS scopes the row itself: a capo_servizio cannot touch a turn outside
  // their restaurant/department even if the payload above were spoofed.
  const { data, error } = await supabase
    .from('turns')
    .update({
      user_id:          input.user_id,
      restaurant_id:    input.restaurant_id,
      department:       input.department,
      date:             input.date,
      start_time:       input.start_time,
      end_time:         input.end_time,
      is_extraordinary: input.is_extraordinary,
      notes:            input.notes ?? null,
    })
    .eq('id', id)
    .select('*, profile:profiles!user_id(id, full_name)')
    .single()

  if (error) throw new Error(error.message)

  revalidatePath('/turni')
  return data as unknown as Turn
}

export async function deleteTurn(id: string): Promise<void> {
  const { supabase } = await getCaller()

  // RLS enforces the manager/direttore/capo_servizio scoping on DELETE
  const { error } = await supabase
    .from('turns')
    .delete()
    .eq('id', id)

  if (error) throw new Error(error.message)

  revalidatePath('/turni')
}

// ── Inserimento Multiplo (Bulk Insert) ───────────────────────────────
// Calcola tutte le date nel range [start_date, end_date] che cadono nei
// giorni della settimana selezionati e inserisce un turno per ciascuna
// in un'unica insert massiva.
export async function createTurnsBulk(input: BulkTurnInput): Promise<Turn[]> {
  const { supabase, user, profile } = await getCaller()

  assertWithinScope(profile, { restaurant_id: input.restaurant_id, department: input.department })

  const { data: assignee } = await supabase
    .from('profiles')
    .select('id, restaurant_id, department')
    .eq('id', input.user_id)
    .single()
  if (!assignee) throw new Error('Dipendente non trovato')
  assertWithinScope(profile, { restaurant_id: assignee.restaurant_id, department: assignee.department })

  if (!input.days_of_week.length) throw new Error('Seleziona almeno un giorno della settimana')

  const start = new Date(`${input.start_date}T00:00:00`)
  const end = new Date(`${input.end_date}T00:00:00`)
  if (end < start) throw new Error('La data di fine deve essere successiva alla data di inizio')

  const daysSet = new Set(input.days_of_week)
  const dates = eachDayOfInterval({ start, end })
    .filter(d => daysSet.has(getDay(d)))
    .map(d => format(d, 'yyyy-MM-dd'))

  if (!dates.length) throw new Error('Nessuna data corrisponde ai giorni selezionati nel periodo scelto')

  const rows = dates.map(date => ({
    user_id:          input.user_id,
    restaurant_id:    input.restaurant_id,
    department:       input.department,
    date,
    start_time:       input.start_time,
    end_time:         input.end_time,
    is_extraordinary: input.is_extraordinary,
    notes:            input.notes ?? null,
    created_by:       user.id,
  }))

  const { data, error } = await supabase
    .from('turns')
    .insert(rows)
    .select('*, profile:profiles!user_id(id, full_name)')

  if (error) throw new Error(error.message)

  revalidatePath('/turni')
  return data as unknown as Turn[]
}

// ── Turni Standard (Pattern Master-Exception) ────────────────────────

export async function listStandardShifts() {
  const { supabase, profile } = await getCaller()

  let query = supabase
    .from('standard_shifts')
    .select('*, profile:profiles!user_id(id, full_name)')
    .order('day_of_week')

  if (profile.role === 'capo_servizio') {
    query = query.eq('restaurant_id', profile.restaurant_id)
    if (!profile.is_direttore) {
      query = query.eq('department', profile.department)
    }
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function upsertStandardShift(input: StandardShiftInput & { id?: string }) {
  const { supabase, user, profile } = await getCaller()

  assertWithinScope(profile, { restaurant_id: input.restaurant_id, department: input.department })

  const { data: assignee } = await supabase
    .from('profiles')
    .select('id, restaurant_id, department')
    .eq('id', input.user_id)
    .single()
  if (!assignee) throw new Error('Dipendente non trovato')
  assertWithinScope(profile, { restaurant_id: assignee.restaurant_id, department: assignee.department })

  const payload = {
    user_id:       input.user_id,
    restaurant_id: input.restaurant_id,
    department:    input.department,
    day_of_week:   input.day_of_week,
    start_time:    input.start_time,
    end_time:      input.end_time,
    created_by:    user.id,
  }

  const query = input.id
    ? supabase.from('standard_shifts').update(payload).eq('id', input.id)
    : supabase.from('standard_shifts').insert(payload)

  const { data, error } = await query
    .select('*, profile:profiles!user_id(id, full_name)')
    .single()

  if (error) throw new Error(error.message)

  revalidatePath('/turni')
  return data
}

export async function deleteStandardShift(id: string): Promise<void> {
  const { supabase } = await getCaller()

  const { error } = await supabase
    .from('standard_shifts')
    .delete()
    .eq('id', id)

  if (error) throw new Error(error.message)

  revalidatePath('/turni')
}

// ── Popola da Turni Standard (Automazione) ───────────────────────────
// Per ogni standard_shift nello scope del chiamante, genera i turni
// reali per le date del periodo scelto che cadono nel relativo
// day_of_week, saltando le date per cui esiste già un turno per quel
// dipendente (anti-duplicazione).
export async function populateFromStandard(startDate: string, endDate: string): Promise<{ created: number; skipped: number }> {
  const { supabase, user, profile } = await getCaller()

  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  if (end < start) throw new Error('La data di fine deve essere successiva alla data di inizio')

  let standardQuery = supabase.from('standard_shifts').select('*')
  if (profile.role === 'capo_servizio') {
    standardQuery = standardQuery.eq('restaurant_id', profile.restaurant_id)
    if (!profile.is_direttore) {
      standardQuery = standardQuery.eq('department', profile.department)
    }
  }
  const { data: standardShifts, error: standardError } = await standardQuery
  if (standardError) throw new Error(standardError.message)
  if (!standardShifts?.length) return { created: 0, skipped: 0 }

  // Turni già esistenti nel periodo, per evitare duplicati (stesso utente + data)
  let existingQuery = supabase
    .from('turns')
    .select('user_id, date')
    .gte('date', startDate)
    .lte('date', endDate)
  if (profile.role === 'capo_servizio') {
    existingQuery = existingQuery.eq('restaurant_id', profile.restaurant_id)
    if (!profile.is_direttore) {
      existingQuery = existingQuery.eq('department', profile.department)
    }
  }
  const { data: existingTurns, error: existingError } = await existingQuery
  if (existingError) throw new Error(existingError.message)

  const existingKeys = new Set((existingTurns ?? []).map(t => `${t.user_id}|${t.date}`))

  const dates = eachDayOfInterval({ start, end })

  const rows: Array<{
    user_id: string
    restaurant_id: string
    department: string | null
    date: string
    start_time: string
    end_time: string
    is_extraordinary: boolean
    created_by: string
  }> = []
  let skipped = 0

  for (const shift of standardShifts) {
    for (const d of dates) {
      if (getDay(d) !== shift.day_of_week) continue
      const dateStr = format(d, 'yyyy-MM-dd')
      const key = `${shift.user_id}|${dateStr}`
      if (existingKeys.has(key)) {
        skipped++
        continue
      }
      existingKeys.add(key) // evita doppioni se più standard_shifts coincidono sullo stesso giorno
      rows.push({
        user_id:          shift.user_id,
        restaurant_id:    shift.restaurant_id,
        department:       shift.department,
        date:             dateStr,
        start_time:       shift.start_time,
        end_time:         shift.end_time,
        is_extraordinary: false,
        created_by:       user.id,
      })
    }
  }

  if (rows.length) {
    const { error } = await supabase.from('turns').insert(rows)
    if (error) throw new Error(error.message)
  }

  revalidatePath('/turni')
  return { created: rows.length, skipped }
}
