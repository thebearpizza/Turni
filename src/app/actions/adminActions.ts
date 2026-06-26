'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteDemoData } from '@/lib/demoData'
import { sendAccountActivatedEmail } from '@/lib/email'
import { revalidatePath } from 'next/cache'

async function assertPlatformOwner() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Non autenticato')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, managed_restaurant_ids')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'manager' || profile.managed_restaurant_ids !== null) {
    throw new Error('Non autorizzato')
  }
  return { supabase, user }
}

export async function getPendingAccounts() {
  await assertPlatformOwner()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, username, created_at')
    .eq('role', 'manager')
    .eq('account_status', 'pending')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function approveAccount(userId: string): Promise<void> {
  await assertPlatformOwner()
  const admin = createAdminClient()

  // Elimina dati demo
  await deleteDemoData(userId)

  // Attiva account
  const { error } = await admin
    .from('profiles')
    .update({
      account_status:         'active',
      managed_restaurant_ids: [],  // vuoto = nessun ristorante, lo crea lui
    })
    .eq('id', userId)

  if (error) throw new Error(error.message)

  // Recupera email per notifica
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, username')
    .eq('id', userId)
    .single()

  if (profile?.username) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://turni.vercel.app'
    sendAccountActivatedEmail({
      fullName: profile.full_name,
      email:    profile.username,
      loginUrl: `${appUrl}/login`,
    }).catch(() => {})
  }

  revalidatePath('/account-pendenti')
}

export async function rejectAccount(userId: string): Promise<void> {
  await assertPlatformOwner()
  const admin = createAdminClient()

  await deleteDemoData(userId)
  await admin.from('profiles').delete().eq('id', userId)
  await admin.auth.admin.deleteUser(userId)

  revalidatePath('/account-pendenti')
}
