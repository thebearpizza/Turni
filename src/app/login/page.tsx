import { LoginForm } from '@/components/shared/LoginForm'

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Turni</h1>
          <p className="text-muted-foreground mt-2 text-sm">Accedi al tuo account</p>
        </div>
        <LoginForm />
      </div>
    </main>
  )
}
