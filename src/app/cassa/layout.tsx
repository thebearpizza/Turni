import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CassaSidebar } from '@/components/cassa/CassaSidebar'

export default async function CassaLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['manager', 'cassiere'].includes(profile.role)) redirect('/dashboard')

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <CassaSidebar role={profile.role} />
      <main className="flex-1 h-full overflow-y-auto pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  )
}
