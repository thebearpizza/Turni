import { NextRequest, NextResponse } from 'next/server'
import { handleUpdate } from '@/lib/telegram/router'
import type { TgUpdate } from '@/lib/telegram/types'

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-telegram-bot-api-secret-token')
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  const update = (await request.json()) as TgUpdate

  try {
    await handleUpdate(update)
  } catch (err) {
    console.error('Errore webhook Telegram:', err)
  }

  // Risponde sempre 200: Telegram ritenta le consegne se non riceve OK.
  return NextResponse.json({ ok: true })
}
