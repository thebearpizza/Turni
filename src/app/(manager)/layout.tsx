import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/shell/AppShell'
import { datiShell } from '@/components/shell/datiShell'
import { DemoBanner } from '@/components/manager/DemoBanner'
import { AccountStatusProvider } from '@/contexts/AccountStatusContext'

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, restaurant:restaurants(id, name)')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role === 'dipendente') redirect('/home')
  if (profile.role === 'consulente_lavoro') redirect('/consulente/dashboard')
  if (profile.role === 'hostess') redirect('/cassa/prenotazioni')

  const isPending = profile.account_status === 'pending'

  const shell = await datiShell(supabase, profile)

  return (
    <AccountStatusProvider isPending={isPending}>
      <AppShell {...shell} banner={isPending ? <DemoBanner /> : undefined}>
        {children}
      </AppShell>
    </AccountStatusProvider>
  )
}
