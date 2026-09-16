import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CassaSidebar } from '@/components/cassa/CassaSidebar'
import { PushNotificationPrompt } from '@/components/shared/PushNotificationPrompt'
import { AreaTheme } from '@/components/shared/AreaTheme'

export default async function CassaLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_direttore')
    .eq('id', user.id)
    .single()

  // Il direttore (capo_servizio con is_direttore=true) non ha più accesso
  // a Cassa: Fatture/Articoli, le uniche pagine che poteva vedere qui,
  // sono ora sotto /acquisti — vedi (acquisti)/layout.tsx.
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  if (isDirettore) redirect('/acquisti/fatture')

  if (!profile || !['manager', 'cassiere', 'hostess'].includes(profile.role)) redirect('/dashboard')

  const cassaRole = profile.role as 'manager' | 'cassiere' | 'hostess'

  return (
    <div className="cassa h-[100dvh] overflow-y-auto bg-background pb-24 text-foreground">
      <AreaTheme classes="cassa" />
      {/* Non è (solo) un banner: montarlo qui riallinea la subscription
          push col server a ogni apertura di Cassa. Chi lavora tutto il
          giorno qui dentro prima non rinnovava mai la registrazione. */}
      <div className="pt-3">
        <PushNotificationPrompt />
      </div>
      {children}
      <CassaSidebar role={cassaRole} userId={user.id} />
    </div>
  )
}
