import Image from 'next/image'
import { LoginForm } from '@/components/shared/LoginForm'

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4 transition-colors duration-300">
      <div className="w-full max-w-sm">

        {/* Logo + brand */}
        <div className="flex flex-col items-center mb-8 gap-4">
          <Image
            src="/logo-branding.png"
            alt="inTurno"
            width={88}
            height={88}
            className="rounded-[22px] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
            priority
          />
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">inTurno</h1>
            <p className="text-muted-foreground mt-1 text-sm">Accedi al tuo account</p>
          </div>
        </div>

        {/* Glassmorphism card — dark: white/3; light: black/3 */}
        <div className="bg-black/[0.03] dark:bg-white/[0.03] backdrop-blur-md border border-black/10 dark:border-white/10 rounded-2xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.18)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          <LoginForm />
        </div>

        <p className="text-center text-muted-foreground/50 text-xs mt-6">
          © {new Date().getFullYear()} inTurno
        </p>
      </div>
    </main>
  )
}
