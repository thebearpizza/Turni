import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'

// PATCH /api/assenze
// Body: { id: string, action: 'approve' | 'reject' }
// Approves or rejects a pending absence request and revalidates all affected pages.
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, restaurant_id, is_direttore')
    .eq('id', user.id)
    .single()

  const isManager   = callerProfile?.role === 'manager'
  const isDirettore = callerProfile?.role === 'capo_servizio' && callerProfile.is_direttore === true
  if (!isManager && !isDirettore) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { id, action } = await request.json()
  if (!id || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected'

  // Direttore: can only act on own restaurant
  if (isDirettore) {
    const { data: absence } = await supabase
      .from('absences').select('restaurant_id').eq('id', id).single()
    if (absence?.restaurant_id !== callerProfile?.restaurant_id) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
  }

  const { error } = await supabase
    .from('absences')
    .update({ status: newStatus })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Revalidate all pages that show pending-absence counts
  revalidatePath('/dashboard')
  revalidatePath('/approvazioni')
  revalidatePath('/assenze')

  return NextResponse.json({ success: true, status: newStatus })
}
