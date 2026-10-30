import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/shell/AppShell'
import { datiShell } from '@/components/shell/datiShell'
import { AreaTheme } from '@/components/shared/AreaTheme'

// Manager (tutto) e direttore (capo_servizio con is_direttore=true, CRUD
// su Fatture/Articoli come sempre avuto, sola lettura solo su Fornitori)
// hanno accesso ad Acquisti. Il cassiere NON ci accede (ripristinato: solo
// Cassa, come prima dell'introduzione di questa macroarea).
export default async function AcquistiLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_direttore, full_name, department, managed_restaurant_ids, restaurant:restaurants(id, name)')
    .eq('id', user.id)
    .single()

  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true

  if (!profile || !(profile.role === 'manager' || isDirettore)) redirect('/dashboard')

  const shell = await datiShell(supabase, profile)

  return (
    <AppShell {...shell}>
      <AreaTheme classes="cassa acquisti" />
      <div className="cassa acquisti min-h-full bg-background text-foreground">{children}</div>
    </AppShell>
  )
}
