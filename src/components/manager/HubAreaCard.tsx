import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface HubIndicatore {
  label: string
  // Stringa già formattata (numero, valuta…) o '—' quando la query è
  // fallita/non disponibile — vedi le card async in hub/page.tsx: un
  // indicatore non blocca mai le altre due né l'intera Home.
  value: string
  // Evidenzia in arancione: solo per valori che segnalano qualcosa da
  // gestire (richieste da approvare, chiusure mancanti, fatture in
  // verifica) — mai per valori solo informativi come una differenza
  // negativa.
  alert?: boolean
}

interface Props {
  href: string
  tone: string
  icon: LucideIcon
  title: string
  description: string
  indicatori: HubIndicatore[]
}

// Card area della Home Manager (Task 3): tutta la card è un unico link
// (nessun indicatore è cliccabile singolarmente, per scelta) verso l'area
// — colore identificativo via CSS var --tone, letto da stile inline
// perché è un valore a runtime (una classe Tailwind bg-[...] non può
// generarsi da una stringa dinamica).
export function HubAreaCard({ href, tone, icon: Icon, title, description, indicatori }: Props) {
  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: tone }} />
      <div className="mb-3 flex items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `color-mix(in srgb, ${tone} 18%, transparent)`, border: `1px solid color-mix(in srgb, ${tone} 34%, transparent)` }}
        >
          <Icon className="h-5 w-5" style={{ color: tone }} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-extrabold tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
      </div>
      <div className="flex gap-2">
        {indicatori.map(ind => (
          <div
            key={ind.label}
            className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
            style={ind.alert ? { borderColor: 'color-mix(in srgb, #FF8A6B 46%, transparent)' } : undefined}
          >
            <p className="truncate text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{ind.label}</p>
            <p className={cn('cassa-numeric truncate text-sm font-semibold', ind.alert && 'text-[#FF8A6B]')}>{ind.value}</p>
          </div>
        ))}
      </div>
    </Link>
  )
}

export function HubAreaCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-3">
        <Skeleton className="h-11 w-11 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-12 flex-1 rounded-lg" />
        <Skeleton className="h-12 flex-1 rounded-lg" />
        <Skeleton className="h-12 flex-1 rounded-lg" />
      </div>
    </div>
  )
}
