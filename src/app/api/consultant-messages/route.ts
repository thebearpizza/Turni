import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'

// GET /api/consultant-messages?consultantId=<uuid>
// Returns all messages between the authenticated manager and the given consultant.
// Also used by the consultant themselves (consultantId = their own id).
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profilo non trovato' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const consultantId = searchParams.get('consultantId')
  if (!consultantId) return NextResponse.json({ error: 'consultantId mancante' }, { status: 400 })

  let query = supabase
    .from('consultant_messages')
    .select('*')
    .order('created_at', { ascending: false })

  if (profile.role === 'manager') {
    query = query.eq('manager_id', user.id).eq('consultant_id', consultantId)
  } else if (profile.role === 'consulente_lavoro') {
    // consultant can only see their own thread
    if (consultantId !== user.id) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
    query = query.eq('consultant_id', user.id)
  } else {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST /api/consultant-messages
// Body: { consultantId, title, body, attachments?, sentByManager? }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profilo non trovato' }, { status: 404 })

  if (profile.role !== 'manager' && profile.role !== 'consulente_lavoro') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const body = await request.json()
  const { consultantId, title, body: msgBody, attachments } = body

  if (!consultantId || !title || !msgBody) {
    return NextResponse.json({ error: 'Campi obbligatori mancanti' }, { status: 400 })
  }

  let managerId: string
  let consultId: string
  let sentByManager: boolean

  if (profile.role === 'manager') {
    managerId   = user.id
    consultId   = consultantId
    sentByManager = true
  } else {
    // consultant replying — the consultantId param here is their own manager's id
    managerId   = consultantId
    consultId   = user.id
    sentByManager = false
  }

  const { data, error } = await supabase
    .from('consultant_messages')
    .insert({
      manager_id:      managerId,
      consultant_id:   consultId,
      title,
      body:            msgBody,
      attachments:     attachments ?? [],
      sent_by_manager: sentByManager,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

// DELETE /api/consultant-messages?id=<uuid>
// Manager-only. Order: 1) role check → 2) fetch attachments → 3) storage.remove → 4) db.delete
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  // RBAC hard lock — only managers may delete messages
  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (callerProfile?.role !== 'manager') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  // Step 1: fetch the message (scoped to the caller) to retrieve attachment paths
  const { data: message } = await supabase
    .from('consultant_messages')
    .select('attachments')
    .eq('id', id)
    .or(`manager_id.eq.${user.id},consultant_id.eq.${user.id}`)
    .maybeSingle()

  // Step 2: remove physical files from storage before touching the DB row.
  // Errors are intentionally ignored — a file already missing in storage
  // must not prevent the message record from being deleted.
  if (message?.attachments?.length) {
    const paths = (message.attachments as Array<{ name: string; path: string }>)
      .map(a => a.path)
      .filter(Boolean)
    if (paths.length > 0) {
      await supabase.storage.from('consultant_files').remove(paths)
    }
  }

  // Step 3: delete the DB row (same authorization filter as the SELECT above)
  const { error } = await supabase
    .from('consultant_messages')
    .delete()
    .eq('id', id)
    .or(`manager_id.eq.${user.id},consultant_id.eq.${user.id}`)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidatePath('/dashboard')
  revalidatePath('/consulente/dashboard')
  return NextResponse.json({ success: true })
}
