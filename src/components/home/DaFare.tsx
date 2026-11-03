'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { CosaDaFare } from '@/lib/homeManager'

const TONO = { warn: 'bg-warn-tint text-warn', neg: 'bg-neg-tint text-neg', neutral: 'bg-secondary text-muted-foreground' }

// "Da fare" della Home del manager: assenze e timbrature con foto si
// approvano o rifiutano dalla riga; chiusure, modifiche e fatture portano
// alla sezione giusta.
export function DaFare({ voci }: { voci: CosaDaFare[] }) {
  const router = useRouter()
  const [uscita, setUscita] = useState<Set<string>>(new Set())
  const [via, setVia] = useState<Set<string>>(new Set())
  const [inCorso, setInCorso] = useState<string | null>(null)
  const visibili = voci.filter(v => !via.has(v.id))

  async function agisci(v: CosaDaFare, azione: 'approve' | 'reject') {
    if (!v.rifId) return
    setInCorso(v.id)
    const res = await fetch(v.tipo === 'assenza' ? '/api/assenze' : '/api/presenze/fallback-approve', {
      method: v.tipo === 'assenza' ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v.tipo === 'assenza' ? { id: v.rifId, action: azione } : { attendanceId: v.rifId, action: azione }),
    }).catch(() => null)
    setInCorso(null)
    if (!res?.ok) {
      toast({ title: azione === 'approve' ? "Errore durante l'approvazione. Riprova." : 'Errore durante il rifiuto. Riprova.', variant: 'destructive' })
      return
    }
    toast({ title: `${azione === 'approve' ? 'Approvata' : 'Rifiutata'}: ${v.badge.toLowerCase()} di ${v.titolo.split(' ')[0]}` })
    setUscita(prev => new Set(prev).add(v.id))
    setTimeout(() => { setVia(prev => new Set(prev).add(v.id)); router.refresh() }, 320)
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-[14px] border border-border bg-card">
      <div className="flex flex-none items-baseline gap-2.5 border-b border-border px-[18px] py-3.5">
        <span className="text-[17px] font-semibold">Da fare</span>
        <span className="font-mono text-xs text-muted-foreground">{visibili.length} in attesa</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {visibili.length === 0 ? (
          <p className="px-[18px] py-10 text-center text-sm text-muted-foreground">Niente in attesa. Tutto in ordine.</p>
        ) : visibili.map(v => (
          <div key={v.id} className={cn('flex items-center gap-3 border-b border-border px-[18px] py-3', uscita.has(v.id) && 'anim-swapout')}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold">{v.titolo}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.04em]', TONO[v.tono])}>{v.badge}</span>
              </span>
              <span className="truncate text-[13px] text-muted-foreground">{v.dettaglio}</span>
            </div>
            {v.rifId ? (
              <div className="flex flex-none gap-1.5">
                <button type="button" disabled={inCorso === v.id} onClick={() => agisci(v, 'reject')} className="h-10 rounded-[8px] border border-line-strong px-3 text-[13px] font-medium active:scale-[0.97] disabled:opacity-60">Rifiuta</button>
                <button type="button" disabled={inCorso === v.id} onClick={() => agisci(v, 'approve')} className="h-10 rounded-[8px] bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground active:scale-[0.97] disabled:opacity-60">Approva</button>
              </div>
            ) : v.href ? (
              <Link href={v.href} className="flex h-10 flex-none items-center gap-1 rounded-[8px] border border-line-strong px-3 text-[13px] font-medium active:scale-[0.97]">
                {v.etichetta}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
