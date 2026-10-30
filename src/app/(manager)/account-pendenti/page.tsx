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

  return (
    <div className="px-4 pt-1 pb-4 lg:px-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="titolo-pagina">Account Pendenti</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestisci le richieste di accesso a inTurno.
        </p>
      </div>
      <AccountPendentiClient initialAccounts={pending} />
    </div>
  )
}
