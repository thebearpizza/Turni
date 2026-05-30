import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/consultant-messages/[id]/read
// Marks the message as read by the current user (sets read_at = now()).
// Only marks it if the caller is the recipient (not the sender).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  // Fetch the message to verify ownership and current read_at
  const { data: msg, error: fetchErr } = await supabase
    .from('consultant_messages')
    .select('manager_id, consultant_id, sent_by_manager, read_at')
    .eq('id', id)
    .single()

  if (fetchErr || !msg) return NextResponse.json({ error: 'Messaggio non trovato' }, { status: 404 })

  // The recipient is: consultant if sent_by_manager=true, manager if sent_by_manager=false
  const isRecipient =
    (msg.sent_by_manager && user.id === msg.consultant_id) ||
    (!msg.sent_by_manager && user.id === msg.manager_id)

  if (!isRecipient) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  if (msg.read_at) {
    // Already read — return current timestamp, no update needed
    return NextResponse.json({ read_at: msg.read_at })
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('consultant_messages')
    .update({ read_at: now })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ read_at: now })
}
