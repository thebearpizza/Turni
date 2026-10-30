'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { AccessoLayout, Spinner } from '@/components/accesso/AccessoLayout'
import Link from 'next/link'

type Step = 'form' | 'success'

export function RegisterForm() {
  const [step, setStep] = useState<Step>('form')
  const [fullName, setFullName] = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('Le password non coincidono')
      return
    }
    if (password.length < 8) {
      setError('La password deve essere di almeno 8 caratteri')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ full_name: fullName.trim(), email: email.trim().toLowerCase(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Errore durante la registrazione')
        return
      }
      setStep('success')
    } catch {
      setError('Errore di rete. Riprova.')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'success') {
    return (
      <AccessoLayout sottotitolo="Benvenuto">
        <div className="flex flex-col items-center gap-3.5 px-0 pt-1.5 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ok-tint">
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="var(--ok)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <span className="text-[19px] font-semibold">Richiesta inviata</span>
          <span className="text-[15px] leading-[1.45] text-muted-foreground text-pretty">
            Il tuo account è in attesa di approvazione. Riceverai una notifica non appena il servizio viene attivato. Nel frattempo puoi esplorare la demo.
          </span>
          <Badge variant="warn">In attesa</Badge>
          <Button asChild size="lg" className="mt-1.5 w-full">
            <Link href="/login">Accedi alla demo</Link>
          </Button>
        </div>
      </AccessoLayout>
    )
  }

  const campi: { id: string; label: string; type: string; value: string; set: (v: string) => void; ph: string; ac: string }[] = [
    { id: 'full_name', label: 'Nome completo', type: 'text', value: fullName, set: setFullName, ph: 'Mario Bianchi', ac: 'name' },
    { id: 'email', label: 'Email', type: 'email', value: email, set: setEmail, ph: 'mario@esempio.it', ac: 'email' },
    { id: 'password', label: 'Password', type: 'password', value: password, set: setPassword, ph: 'Minimo 8 caratteri', ac: 'new-password' },
    { id: 'confirm', label: 'Conferma password', type: 'password', value: confirm, set: setConfirm, ph: 'Ripeti la password', ac: 'new-password' },
  ]
  const erroreSuPassword = !!error && /password/i.test(error)

  return (
    <AccessoLayout
      sottotitolo="Richiedi accesso per il tuo locale"
      nota="Sei un dipendente? Le credenziali te le fornisce il tuo manager."
      dopo={
        <span className="text-center text-sm text-muted-foreground">
          Hai già un account? <Link href="/login" className="font-semibold text-foreground underline">Accedi</Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {campi.map(c => (
          <label key={c.id} className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-medium text-muted-foreground">{c.label}</span>
            <Input
              id={c.id}
              type={c.type}
              value={c.value}
              onChange={e => { c.set(e.target.value); setError(null) }}
              placeholder={c.ph}
              autoComplete={c.ac}
              required
              aria-invalid={(erroreSuPassword && c.type === 'password') || undefined}
              className="h-[50px]"
            />
          </label>
        ))}
        {error && <p className="anim-swapin text-sm font-medium text-neg">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={loading} style={{ opacity: loading ? 0.85 : 1 }}>
          {loading && <Spinner />}
          {loading ? 'Invio richiesta…' : 'Richiedi accesso'}
        </Button>
      </form>
    </AccessoLayout>
  )
}
