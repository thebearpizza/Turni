import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ActivityTrackerMount } from '@/components/consulente/ActivityTrackerMount'

export default async function ConsulenteLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'consulente_lavoro') redirect('/dashboard')

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <ActivityTrackerMount />
      {children}
    </div>
  )
}
