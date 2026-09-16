import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AcquistiSidebar } from '@/components/acquisti/AcquistiSidebar'

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
    .select('role, is_direttore')
    .eq('id', user.id)
    .single()

  const isDirettore = profile?.role === 'capo_servizio' && profile.is_direttore === true

  if (!profile || !(profile.role === 'manager' || isDirettore)) redirect('/dashboard')

  const acquistiRole = profile.role === 'manager' ? 'manager' as const : 'direttore' as const

  return (
    <div className="cassa acquisti h-[100dvh] overflow-y-auto bg-background pb-24 text-foreground">
      {children}
      <AcquistiSidebar role={acquistiRole} userId={user.id} />
    </div>
  )
}
