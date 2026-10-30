import { LogoAnimato } from '@/components/shared/LogoAnimato'

// Cornice comune di accesso e registrazione (Accesso.dc.html): logo,
// "inTurno", sottotitolo, scheda bianca col modulo, © in fondo.
export function AccessoLayout({ sottotitolo, nota, children, dopo }: {
  sottotitolo: string
  nota?: string
  children: React.ReactNode
  dopo?: React.ReactNode
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-background px-6 pb-10 pt-6">
      <div className="anim-swapin flex w-full max-w-[400px] flex-col gap-7 md:max-w-[420px]">
        <div className="flex flex-col items-center gap-4">
          <LogoAnimato size={72} className="rounded-[16px]" />
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="text-2xl font-semibold tracking-[-0.015em]">inTurno</h1>
            <p className="text-[15px] text-muted-foreground">{sottotitolo}</p>
            {nota && <p className="max-w-[280px] text-[13px] text-muted-foreground text-pretty">{nota}</p>}
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-[20px] border border-border bg-card p-[22px]">{children}</div>
        {dopo}
        <span className="text-center text-xs text-[oklch(0.62_0.01_250)]">© {new Date().getFullYear()} inTurno</span>
      </div>
    </main>
  )
}

export function Spinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="animate-spin" aria-hidden>
      <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="2" />
      <path d="M9 2a7 7 0 0 1 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
