import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getPendingAccounts } from '@/app/actions/adminActions'
import { AccountPendentiClient } from '@/components/manager/AccountPendentiClient'

export default async function AccountPendentiPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, managed_restaurant_ids')
    .eq('id', user!.id)
    .single()

  if (profile?.role !== 'manager' || profile.managed_restaurant_ids !== null) {
    redirect('/dashboard')
  }

  const pending = await getPendingAccounts()

  return <AccountPendentiClient initialAccounts={pending} />
}
