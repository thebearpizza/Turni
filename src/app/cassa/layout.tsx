import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CassaSidebar } from '@/components/cassa/CassaSidebar'

export default async function CassaLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_direttore')
    .eq('id', user.id)
    .single()

  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true

  if (!profile || !(['manager', 'cassiere'].includes(profile.role) || isDirettore)) redirect('/dashboard')

  const cassaRole = profile.role === 'manager' ? 'manager' : profile.role === 'cassiere' ? 'cassiere' : 'direttore'

  return (
    <div className="cassa flex h-[100dvh] overflow-hidden bg-background text-foreground">
      <CassaSidebar role={cassaRole} />
      <main className="flex-1 h-full overflow-y-auto pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  )
}
