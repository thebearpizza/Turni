import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/shell/AppShell'
import { datiShell } from '@/components/shell/datiShell'
import { PushNotificationPrompt } from '@/components/shared/PushNotificationPrompt'
import { AreaTheme } from '@/components/shared/AreaTheme'

export default async function CassaLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_direttore, full_name, department, managed_restaurant_ids, restaurant:restaurants(id, name)')
    .eq('id', user.id)
    .single()

  // Il direttore (capo_servizio con is_direttore=true) non ha più accesso
  // a Cassa: Fatture/Articoli, le uniche pagine che poteva vedere qui,
  // sono ora sotto /acquisti — vedi (acquisti)/layout.tsx.
  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true
  if (isDirettore) redirect('/acquisti/fatture')

  if (!profile || !['manager', 'cassiere', 'hostess'].includes(profile.role)) redirect('/dashboard')

  const shell = await datiShell(supabase, profile)

  // Le notifiche push si riallineano a ogni apertura di Cassa (chi ci
  // lavora tutto il giorno altrimenti non rinnovava mai la registrazione):
  // il banner resta, ora sotto l'intestazione del guscio.
  return (
    <AppShell {...shell} banner={<PushNotificationPrompt />}>
      <AreaTheme classes="cassa" />
      <div className="cassa min-h-full bg-background text-foreground">{children}</div>
    </AppShell>
  )
}
