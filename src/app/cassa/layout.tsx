import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CassaSidebar } from '@/components/cassa/CassaSidebar'
import { PushNotificationPrompt } from '@/components/shared/PushNotificationPrompt'

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

  if (!profile || !(['manager', 'cassiere', 'hostess'].includes(profile.role) || isDirettore)) redirect('/dashboard')

  const cassaRole =
    profile.role === 'manager'  ? 'manager' :
    profile.role === 'cassiere' ? 'cassiere' :
    profile.role === 'hostess'  ? 'hostess'  : 'direttore'

  return (
    <div className="cassa flex h-[100dvh] overflow-hidden bg-background text-foreground">
      <CassaSidebar role={cassaRole} />
      <main className="flex-1 h-full overflow-y-auto pt-14 lg:pt-0">
        {/* Non è (solo) un banner: montarlo qui riallinea la subscription
            push col server a ogni apertura di Cassa. Chi lavora tutto il
            giorno qui dentro prima non rinnovava mai la registrazione. */}
        <div className="pt-3">
          <PushNotificationPrompt />
        </div>
        {children}
      </main>
    </div>
  )
}
