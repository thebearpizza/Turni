'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
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
