
// Cornice comune di accesso e registrazione (Accesso.dc.html): logo,
// "inTurno", sottotitolo, scheda bianca col modulo, © in fondo. Pagina a
// sé, fuori dal guscio: qui (e solo qui) il contenuto scorre se la
// tastiera del telefono lo copre.
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
          {/* eslint-disable-next-line @next/next/no-img-element -- logo statico come nel prototipo */}
          <img src="/logo.svg" alt="" width={72} height={72} className="h-[72px] w-[72px]" />
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

/** Link dell'accesso: teal e sottolineato, come nel prototipo. */
export const CLASSE_LINK = 'font-semibold text-[oklch(0.58_0.12_180)] underline hover:text-[oklch(0.45_0.1_180)] dark:text-[oklch(0.72_0.11_180)]'

/** Campo del modulo di accesso (50px, raggio 12, fondo bianco, alone teal al focus). */
export const CLASSE_CAMPO = 'h-[50px] rounded-[12px] border-line-strong bg-white px-3.5 text-base placeholder:text-[oklch(0.62_0.01_250)] focus-visible:border-[oklch(0.58_0.12_180)] focus-visible:shadow-[0_0_0_3px_oklch(0.58_0.12_180/0.15)] dark:bg-card'
