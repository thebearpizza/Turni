import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PushNotificationPrompt } from '@/components/shared/PushNotificationPrompt'
import { AppShell } from '@/components/shell/AppShell'
import { datiShell } from '@/components/shell/datiShell'

// Home del manager (e del direttore) dentro il guscio comune: intestazione
// "Ciao, Nome", barra Home/Turni/Cassa/Acquisti/Altro. Lo scope per ruolo
// resta verificato in hub/page.tsx.
export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_direttore, full_name, department, managed_restaurant_ids, restaurant:restaurants(id, name)')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  const shell = await datiShell(supabase, profile)
  return (
    <AppShell {...shell} banner={<PushNotificationPrompt />}>
      {children}
    </AppShell>
  )
}
