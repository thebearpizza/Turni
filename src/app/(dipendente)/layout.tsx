import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/shell/AppShell'
import { datiShell } from '@/components/shell/datiShell'

export default async function DipendenteLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_direttore, full_name, department, managed_restaurant_ids, restaurant:restaurants(id, name)')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'dipendente') redirect('/dashboard')

  const shell = await datiShell(supabase, profile)
  return <AppShell {...shell}>{children}</AppShell>
}
