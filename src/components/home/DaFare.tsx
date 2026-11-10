'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { CosaDaFare } from '@/lib/homeManager'
import { useTelefono } from '@/hooks/useTelefono'

const TONO = { warn: 'bg-warn-tint text-warn', neg: 'bg-neg-tint text-neg', neutral: 'bg-secondary text-muted-foreground' }

/** Chiama l'API giusta per approvare o rifiutare un'assenza o una timbratura con foto. */
export async function decidi(tipo: 'assenza' | 'foto', id: string, azione: 'approve' | 'reject'): Promise<boolean> {
  const res = await fetch(tipo === 'assenza' ? '/api/assenze' : '/api/presenze/fallback-approve', {
    method: tipo === 'assenza' ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tipo === 'assenza' ? { id, action: azione } : { attendanceId: id, action: azione }),
  }).catch(() => null)
  return !!res?.ok
}

// "Da fare" della Home del manager (MTHome): assenze e timbrature con foto
// si approvano o rifiutano dalla riga (che esce con swapout); chiusure
// mancanti, modifiche e fatture portano alla sezione giusta. Sul telefono
// la card si apre e si chiude toccando l'intestazione (chiusa all'avvio).
export function DaFare({ voci, className, style }: { voci: CosaDaFare[]; className?: string; style?: React.CSSProperties }) {
  const router = useRouter()
  const tel = useTelefono()
  const [aperto, setAperto] = useState(false)
  const [uscita, setUscita] = useState<Set<string>>(new Set())
  const [via, setVia] = useState<Set<string>>(new Set())
  const [inCorso, setInCorso] = useState<string | null>(null)
  const visibili = voci.filter(v => !via.has(v.id))

  async function agisci(v: CosaDaFare, azione: 'approve' | 'reject') {
    if (!v.rifId || (v.tipo !== 'assenza' && v.tipo !== 'foto')) return
    setInCorso(v.id)
    const ok = await decidi(v.tipo, v.rifId, azione)
    setInCorso(null)
    if (!ok) {
      toast({ title: azione === 'approve' ? "Errore durante l'approvazione. Riprova." : 'Errore durante il rifiuto. Riprova.', variant: 'destructive' })
      return
    }
    const cosa = v.tipo === 'foto' ? 'timbratura con foto' : v.badge.toLowerCase()
    toast({ title: `${azione === 'approve' ? 'Approvata' : 'Rifiutata'}: ${cosa} di ${v.titolo.split(' ')[0]}` })
    setUscita(prev => new Set(prev).add(v.id))
    setTimeout(() => { setVia(prev => new Set(prev).add(v.id)); router.refresh() }, 320)
  }

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-border bg-card', className)} style={style}>
      <button
        type="button"
        onClick={() => setAperto(a => !a)}
        className={cn('flex flex-none items-center gap-2.5 px-3.5 py-3.5 text-left max-sm:active:scale-[0.99] sm:pointer-events-none sm:cursor-default sm:border-b sm:border-border sm:px-[18px]', aperto && 'border-b border-border')}
      >
        <span className="text-[17px] font-semibold">Da fare</span>
        <span className="flex-1 font-mono text-[13px] font-medium text-muted-foreground">{visibili.length ? `${visibili.length} in attesa` : ''}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
          className="flex-none text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:hidden" style={{ transform: `rotate(${aperto ? 180 : 0}deg)` }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div className={cn('min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain sm:flex', aperto ? 'flex' : 'hidden', aperto && tel && 'anim-swapin')}>
        {visibili.length === 0 ? (
          <div className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center text-pretty">
            <span className="text-[15px] font-semibold">Tutto in ordine</span>
            <span className="text-[13px] text-muted-foreground">Nessuna richiesta in attesa.</span>
          </div>
        ) : visibili.map(v => (
          <div key={v.id} className={cn('flex flex-wrap items-center gap-3 border-b border-[oklch(0.93_0.01_250)] px-3.5 py-3 dark:border-border sm:flex-nowrap sm:px-[18px]', uscita.has(v.id) && 'anim-swapout')}>
            <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-[3px]">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {v.titolo}
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.05em]', TONO[v.tono])}>{v.badge}</span>
              </span>
              <span className="text-[13px] text-muted-foreground">{v.dettaglio}</span>
            </div>
            {v.rifId ? (
              <div className="flex flex-none gap-1.5">
                <button type="button" disabled={inCorso === v.id} onClick={() => agisci(v, 'reject')} className="flex h-10 items-center rounded-[8px] border border-line-strong px-3 text-[13px] font-medium active:scale-[0.97] disabled:opacity-60">Rifiuta</button>
                <button type="button" disabled={inCorso === v.id} onClick={() => agisci(v, 'approve')} className="flex h-10 items-center rounded-[8px] bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground active:scale-[0.97] disabled:opacity-60">Approva</button>
              </div>
            ) : v.href ? (
              <Link href={v.href} className="flex h-10 flex-none items-center gap-1.5 rounded-[8px] border border-line-strong px-3.5 text-[13px] font-medium active:scale-[0.97]">
                {v.etichetta}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
