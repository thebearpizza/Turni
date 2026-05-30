import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/consultant-messages/upload
// Multipart form: file + consultantId
// Uploads to storage bucket and returns the object path.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const consultantId = formData.get('consultantId') as string | null

  if (!file || !consultantId) {
    return NextResponse.json({ error: 'File o consultantId mancante' }, { status: 400 })
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'Il file supera il limite di 10 MB' }, { status: 413 })
  }

  const ext = file.name.split('.').pop() ?? 'bin'
  const path = `${consultantId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const { error } = await supabase.storage
    .from('consultant_files')
    .upload(path, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ path, name: file.name }, { status: 201 })
}
