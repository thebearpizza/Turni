import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { setWebhook, getMe } from '@/lib/telegram/api'

// Endpoint una tantum per registrare il webhook del bot Telegram.
// Riservato ai manager: GET /api/telegram/setup
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'manager') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'TELEGRAM_WEBHOOK_SECRET non configurato' }, { status: 500 })

  const webhookUrl = `${request.nextUrl.origin}/api/telegram/webhook`

  await setWebhook(webhookUrl, secret)
  const me = await getMe()

  return NextResponse.json({ ok: true, webhookUrl, bot: me })
}
