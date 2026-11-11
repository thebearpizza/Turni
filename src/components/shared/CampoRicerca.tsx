'use client'
import { cn } from '@/lib/utils'

// Campo di ricerca delle liste lunghe (Articoli, Dipendenti, Fornitori):
// lente a sinistra, ✕ per svuotare. Il filtro è di chi lo usa: qui solo il
// campo. `corrisponde` confronta senza badare a maiuscole e accenti.

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
/** Tutte le parole cercate compaiono in almeno uno dei testi. */
export function corrisponde(cerca: string, ...testi: (string | null | undefined)[]): boolean {
  const q = norm(cerca).split(/\s+/).filter(Boolean)
  if (!q.length) return true
  const t = norm(testi.filter(Boolean).join(' '))
  return q.every(p => t.includes(p))
}

export function CampoRicerca({ valore, onCambia, segnaposto = 'Cerca', className }: { valore: string; onCambia: (v: string) => void; segnaposto?: string; className?: string }) {
  return (
    <label data-sk-keep="" className={cn('relative flex h-11 min-w-0 items-center rounded-[10px] border border-line-strong bg-card focus-within:border-[oklch(0.58_0.12_180)]', className)}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="pointer-events-none absolute left-3 text-muted-foreground"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
      <input
        type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
        value={valore} onChange={e => onCambia(e.target.value)} placeholder={segnaposto} aria-label={segnaposto}
        className="h-full min-w-0 flex-1 bg-transparent pl-10 pr-10 text-[15px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {valore && (
        <button type="button" aria-label="Svuota la ricerca" onClick={() => onCambia('')} className="absolute right-0 flex h-11 w-11 items-center justify-center text-muted-foreground active:scale-[0.94]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
        </button>
      )}
    </label>
  )
}
