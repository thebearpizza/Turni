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

  const { path, name } = await request.json()
  if (!path) return NextResponse.json({ error: 'Path mancante' }, { status: 400 })

  const { data: msg, error: fetchErr } = await supabase
    .from('consultant_messages')
    .select('manager_id, consultant_id, sent_by_manager, downloaded_at, attachments')
    .eq('id', id)
    .single()

  if (fetchErr || !msg) return NextResponse.json({ error: 'Messaggio non trovato' }, { status: 404 })

  // Verify the caller is a party to this message
  if (user.id !== msg.manager_id && user.id !== msg.consultant_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  // Il path richiesto deve essere davvero uno degli allegati di QUESTO
  // messaggio: senza questo controllo, un partecipante alla conversazione
  // potrebbe passare il path di un file caricato altrove.
  const attachments = (msg.attachments ?? []) as Array<{ name: string; path: string }>
  if (!attachments.some(a => a.path === path)) {
    return NextResponse.json({ error: 'Allegato non trovato in questo messaggio' }, { status: 404 })
  }

  // Only set downloaded_at if the caller is the recipient, e solo la prima
  // volta: un secondo download non deve spostare in avanti la data del
  // primo accesso.
  const isRecipient =
    (msg.sent_by_manager && user.id === msg.consultant_id) ||
    (!msg.sent_by_manager && user.id === msg.manager_id)

  let downloadedAt = msg.downloaded_at as string | null
  if (isRecipient && !downloadedAt) {
    downloadedAt = new Date().toISOString()
    await supabase
      .from('consultant_messages')
      .update({ downloaded_at: downloadedAt })
      .eq('id', id)
  }

  // Generate a 1-hour signed URL
  const filename = name ?? path.split('/').pop() ?? 'file'
  const { data: signedData, error: signErr } = await supabase.storage
    .from('consultant_files')
    .createSignedUrl(path, 3600, { download: filename })

  if (signErr || !signedData?.signedUrl) {
    return NextResponse.json({ error: 'Impossibile generare il link di download' }, { status: 500 })
  }

  return NextResponse.json({ signedUrl: signedData.signedUrl, downloaded_at: downloadedAt })
}
