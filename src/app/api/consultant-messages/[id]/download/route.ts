import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/consultant-messages/[id]/download
// Body: { path: string }
// Sets downloaded_at = now() on the message if the caller is the recipient,
// then returns a signed URL (valid 1h) for the attachment.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { path } = await request.json()
  if (!path) return NextResponse.json({ error: 'Path mancante' }, { status: 400 })

  const { data: msg, error: fetchErr } = await supabase
    .from('consultant_messages')
    .select('manager_id, consultant_id, sent_by_manager')
    .eq('id', id)
    .single()

  if (fetchErr || !msg) return NextResponse.json({ error: 'Messaggio non trovato' }, { status: 404 })

  // Verify the caller is a party to this message
  if (user.id !== msg.manager_id && user.id !== msg.consultant_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  // Only set downloaded_at if the caller is the recipient
  const isRecipient =
    (msg.sent_by_manager && user.id === msg.consultant_id) ||
    (!msg.sent_by_manager && user.id === msg.manager_id)

  if (isRecipient) {
    await supabase
      .from('consultant_messages')
      .update({ downloaded_at: new Date().toISOString() })
      .eq('id', id)
  }

  // Generate a 1-hour signed URL
  const { data: signedData, error: signErr } = await supabase.storage
    .from('consultant_files')
    .createSignedUrl(path, 3600)

  if (signErr || !signedData?.signedUrl) {
    return NextResponse.json({ error: 'Impossibile generare il link di download' }, { status: 500 })
  }

  return NextResponse.json({ signedUrl: signedData.signedUrl })
}
