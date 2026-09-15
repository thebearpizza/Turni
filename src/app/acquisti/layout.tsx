import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AcquistiSidebar } from '@/components/acquisti/AcquistiSidebar'

// Task 2: manager (tutto), cassiere (Fatture/Articoli/Fornitori in sola
// lettura — vedi i singoli page.tsx e i componenti client) e direttore
// (capo_servizio con is_direttore=true, CRUD su Fatture/Articoli come
// prima, sola lettura solo su Fornitori) hanno accesso ad Acquisti.
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

  if (!profile || !(profile.role === 'manager' || profile.role === 'cassiere' || isDirettore)) redirect('/dashboard')

  const acquistiRole =
    profile.role === 'manager'  ? 'manager' as const :
    profile.role === 'cassiere' ? 'cassiere' as const : 'direttore' as const

  return (
    <div className="cassa flex h-[100dvh] overflow-hidden bg-background text-foreground">
      <AcquistiSidebar role={acquistiRole} />
      <main className="flex-1 h-full overflow-y-auto pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  )
}
