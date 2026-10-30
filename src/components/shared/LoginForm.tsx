'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/accesso/AccessoLayout'
import { useRouter, useSearchParams } from 'next/navigation'

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
  const searchParams = useSearchParams()
  const sessioneScaduta = searchParams.get('sessione_scaduta') === '1'

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {sessioneScaduta && (
        <p className="rounded-[12px] bg-warn-tint px-3 py-2.5 text-center text-sm font-medium text-warn text-pretty">
          La sessione è scaduta. Accedi di nuovo per continuare.
        </p>
      )}
      <label className="flex flex-col gap-[7px]">
        <span className="text-[13px] font-medium text-muted-foreground">Username</span>
        <Input
          id="credential"
          type="text"
          value={credential}
          onChange={e => { setCredential(e.target.value); setError(null) }}
          placeholder="mario.rossi"
          required
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!!error || undefined}
          className="h-[50px]"
        />
      </label>
      <label className="flex flex-col gap-[7px]">
        <span className="text-[13px] font-medium text-muted-foreground">Password</span>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(null) }}
          placeholder="••••••••"
          required
          autoComplete="current-password"
          aria-invalid={!!error || undefined}
          className="h-[50px]"
        />
      </label>
      {error && <p className="anim-swapin text-sm font-medium text-neg">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={loading} style={{ opacity: loading ? 0.85 : 1 }}>
        {loading && <Spinner />}
        {loading ? 'Accesso in corso…' : 'Accedi'}
      </Button>
    </form>
  )
}
