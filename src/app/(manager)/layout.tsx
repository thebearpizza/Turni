import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ManagerSidebar } from '@/components/manager/ManagerSidebar'
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

  const isPending = profile.account_status === 'pending'

  return (
    <AccountStatusProvider isPending={isPending}>
      <div className="flex h-[100dvh] overflow-hidden bg-background">
        <ManagerSidebar profile={profile} />
        <main className="flex-1 h-full overflow-y-auto pt-14 lg:pt-0">
          {isPending && <DemoBanner />}
          {children}
        </main>
      </div>
    </AccountStatusProvider>
  )
}
