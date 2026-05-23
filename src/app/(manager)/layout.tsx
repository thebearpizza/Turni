import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ManagerSidebar } from '@/components/manager/ManagerSidebar'

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

  return (
    <div className="flex min-h-screen bg-background">
      <ManagerSidebar profile={profile} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
