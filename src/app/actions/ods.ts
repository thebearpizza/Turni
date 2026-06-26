'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import webpush from 'web-push'
import type { OdsTask, OdsTaskType } from '@/types'

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

export interface CreateOdsInput {
  title:           string
  department:      string
  restaurant_id:   string
  type:            OdsTaskType
  recurrence_days: string[]
  assigned_to:     string | null
}

export async function createOdsTask(input: CreateOdsInput): Promise<OdsTask> {
  // ── 1. Auth ────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Non autenticato')

  const { data: caller } = await supabase
    .from('profiles')
    .select('role, restaurant_id, department, is_direttore, account_status')
    .eq('id', user.id)
    .single()

  if (!caller || !['manager', 'capo_servizio'].includes(caller.role)) {
    throw new Error('Non autorizzato')
  }
  if ((caller as { account_status?: string }).account_status === 'pending') {
    throw new Error('Account in attesa di approvazione. La demo è in sola lettura.')
  }

  // ── 2. Capo servizio security: must own the restaurant + department ─
  // A "Direttore" (capo_servizio with is_direttore) bypasses the department
  // restriction and operates across all departments of its own restaurant.
  if (caller.role === 'capo_servizio') {
    if (input.restaurant_id !== caller.restaurant_id) {
      throw new Error('Non autorizzato: ristorante non corrispondente')
    }
    if (!caller.is_direttore && caller.department && input.department !== caller.department) {
      throw new Error('Non autorizzato: reparto non corrispondente')
    }
  }

  const admin = createAdminClient()

  // ── 3. Create task ─────────────────────────────────────────────────
  const { data: task, error: taskError } = await admin
    .from('ods_tasks')
    .insert({
      title:           input.title,
      department:      input.department,
      restaurant_id:   input.restaurant_id,
      type:            input.type,
      recurrence_days: input.recurrence_days,
      assigned_to:     input.assigned_to,
      creator_id:      user.id,
    })
    .select('*, assignee:profiles!assigned_to(id, full_name)')
    .single()

  if (taskError || !task) throw new Error('Errore nella creazione del compito')

  // ── 4. Identify recipients (excluding the creator) ─────────────────
  type Recipient = { id: string; role: string }
  let recipients: Recipient[] = []

  if (input.assigned_to) {
    const { data: assignee } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', input.assigned_to)
      .single()
    if (assignee) recipients = [assignee]
  } else {
    const { data: staff } = await admin
      .from('profiles')
      .select('id, role')
      .eq('restaurant_id', input.restaurant_id)
      .eq('department', input.department)
      .in('role', ['dipendente', 'capo_servizio'])
      .neq('id', user.id)
    recipients = (staff ?? []) as Recipient[]
  }

  if (recipients.length === 0) return task as unknown as OdsTask

  const isPersonal = !!input.assigned_to
  const notifTitle = isPersonal ? 'Nuova mansione assegnata' : 'Nuova istruzione di Reparto'
  const recipientIds = recipients.map(r => r.id)

  // ── 5+6. Parallel: bulk insert in-app notifications + fetch push subscriptions ─
  const [, { data: subs }] = await Promise.all([
    admin.from('notifications').insert(
      recipients.map(r => ({
        user_id: r.id,
        title:   notifTitle,
        message: input.title,
        // dipendente → /home/ods, manager-area users → /ods
        link:    r.role === 'dipendente' ? '/home/ods' : '/ods',
      }))
    ),
    admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth_key, user_id')
      .in('user_id', recipientIds),
  ])

  if (subs?.length) {
    await Promise.allSettled(
      subs.map(async (sub: { endpoint: string; p256dh: string; auth_key: string }) => {
        const recipient = recipients.find(r => r.id === (sub as { user_id?: string }).user_id)
        const url = recipient?.role === 'dipendente' ? '/home/ods' : '/ods'
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            JSON.stringify({ title: notifTitle, body: input.title, url }),
          )
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode
          if (status === 410 || status === 404) {
            await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          }
        }
      })
    )
  }

  return task as unknown as OdsTask
}
