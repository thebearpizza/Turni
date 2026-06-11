import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MieiTurniClient } from '@/components/dipendente/MieiTurniClient'

export default async function MieiTurniPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Query Scoping (RBAC) — Dipendente: visibilità PERSONALE, sola lettura
  const { data: turns } = await supabase
    .from('turns')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  return (
    <MieiTurniClient
      initialTurns={(turns as unknown as import('@/types').Turn[]) ?? []}
      userId={user.id}
    />
  )
}
