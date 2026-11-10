import { Suspense } from 'react'
import Link from 'next/link'
import { LoginForm } from '@/components/shared/LoginForm'
import { AccessoLayout, CLASSE_LINK } from '@/components/accesso/AccessoLayout'

export default function LoginPage() {
  return (
    <AccessoLayout
      sottotitolo="Accedi al tuo account"
      dopo={
        <div className="flex flex-col items-center gap-2.5 text-center">
          <span className="max-w-[300px] text-[13px] text-muted-foreground text-pretty">Dipendente? Chiedi le tue credenziali al tuo manager, non serve registrarsi.</span>
          <span className="text-sm text-muted-foreground">
            Vuoi provare inTurno per il tuo locale?{' '}
            <Link href="/register" className={CLASSE_LINK}>Registra la tua attività</Link>
          </span>
        </div>
      }
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AccessoLayout>
  )
}
