'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Send, CheckCircle2, Unlink } from 'lucide-react'
import { generateTelegramLink, getTelegramLinkStatus, unlinkTelegram } from '@/app/actions/telegram'

export function TelegramLinkButton() {
  const [loading, setLoading] = useState(true)
  const [linked, setLinked] = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getTelegramLinkStatus()
      .then(({ linked, telegramUsername }) => {
        setLinked(linked)
        setUsername(telegramUsername)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleConnect() {
    setBusy(true)
    setError(null)
    try {
      const { deepLink } = await generateTelegramLink()
      if (deepLink) window.open(deepLink, '_blank')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante la generazione del collegamento')
    } finally {
      setBusy(false)
    }
  }

  async function handleUnlink() {
    setBusy(true)
    setError(null)
    try {
      await unlinkTelegram()
      setLinked(false)
      setUsername(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante lo scollegamento')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null

  return (
    <div className="mt-6 bg-card border border-border rounded-md p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-sm border border-border bg-muted flex items-center justify-center shrink-0">
        <Send className="w-5 h-5 text-sky-500" />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          Bot Telegram
          {linked && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {linked
            ? `Collegato${username ? ` come @${username}` : ''}. Gestisci turni, ODS e presenze in chat.`
            : 'Collega il tuo account per gestire turni, ODS e presenze direttamente da Telegram.'}
        </p>
        {error && <p className="text-xs text-red-600 mt-0.5">{error}</p>}
      </div>
      {linked ? (
        <Button size="sm" variant="outline" onClick={handleUnlink} disabled={busy}>
          <Unlink className="w-4 h-4" /> Scollega
        </Button>
      ) : (
        <Button size="sm" onClick={handleConnect} disabled={busy}>
          <Send className="w-4 h-4" /> Collega Telegram
        </Button>
      )}
    </div>
  )
}
