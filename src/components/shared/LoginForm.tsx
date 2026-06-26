'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from 'next/navigation'

// Must match the domain used in /api/users POST to generate fake-email accounts.
const FAKE_DOMAIN = 'struttura.local'

function resolveEmail(input: string): string {
  // If the user typed a full email address (manager accounts), use it as-is.
  // Otherwise treat it as a username and append the internal domain.
  return input.includes('@') ? input : `${input}@${FAKE_DOMAIN}`
}

export function LoginForm() {
  const [credential, setCredential] = useState('')
  const [password, setPassword]     = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: resolveEmail(credential.trim().toLowerCase()),
      password,
    })

    if (error) {
      setError('Username o password non corretti')
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="credential">Username</Label>
        <Input
          id="credential"
          type="text"
          value={credential}
          onChange={e => setCredential(e.target.value)}
          placeholder="mario.rossi"
          required
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          autoComplete="current-password"
        />
      </div>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Accesso in corso...' : 'Accedi'}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Non hai un account?{' '}
        <a href="/register" className="underline hover:text-foreground">
          Registrati
        </a>
      </p>
    </form>
  )
}
