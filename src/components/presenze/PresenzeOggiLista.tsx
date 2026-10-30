'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { RigaPresenza, StatoPresenza } from '@/lib/presenzeOggi'

const BADGE: Record<StatoPresenza, string> = {
  servizio: 'bg-ok-tint text-ok',
  uscito: 'bg-secondary text-muted-foreground',
  ritardo: 'bg-warn-tint text-warn',
  atteso: 'bg-secondary text-muted-foreground',
  assente: 'bg-neg-tint text-neg',
  foto: 'bg-warn-tint text-warn',
}

function iniziali(nome: string): string {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('')
}

// Lista "Presenze di oggi" (capo servizio e direttore): avatar con le
// iniziali, turno e stato del giorno. Chi può approvare vede il pulsante
// sulle timbrature con foto, direttamente nella riga.
export function PresenzeOggiLista({ titolo, righe, puoApprovare = false, azione }: {
  titolo: string
  righe: RigaPresenza[]
  puoApprovare?: boolean
  azione?: React.ReactNode
}) {
  const router = useRouter()
  const [inCorso, setInCorso] = useState<string | null>(null)
  const [nascoste, setNascoste] = useState<Set<string>>(new Set())
  const visibili = righe.filter(r => !nascoste.has(r.userId) || r.stato !== 'foto')
  const presenti = righe.filter(r => r.stato === 'servizio' || r.stato === 'uscito' || r.stato === 'foto').length

  async function approva(r: RigaPresenza) {
    if (!r.presenzaFotoId) return
    setInCorso(r.presenzaFotoId)
    const res = await fetch('/api/presenze/fallback-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendanceId: r.presenzaFotoId, action: 'approve' }),
    }).catch(() => null)
    setInCorso(null)
    if (res?.ok) {
      toast({ title: `Timbratura di ${r.nome.split(' ')[0]} approvata` })
      setNascoste(prev => new Set(prev).add(r.userId))
      router.refresh()
    } else {
      toast({ title: "Errore durante l'approvazione. Riprova.", variant: 'destructive' })
    }
  }

  async function vediFoto(path: string) {
    const { data } = await createClient().storage.from('clock_in_proofs').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  return (
    <div className="rounded-[14px] border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-3">
        <span className="text-[15px] font-semibold">{titolo}</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-medium text-muted-foreground">{presenti}/{righe.length}</span>
          {azione}
        </div>
      </div>
      {visibili.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-sm text-muted-foreground">Nessun turno né timbratura oggi</p>
      ) : visibili.map((r, i) => (
        <div
          key={r.userId}
          className={cn('anim-inrise flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0', r.stato === 'foto' && 'bg-[oklch(0.985_0.02_75)] dark:bg-[oklch(0.2_0.02_75)]')}
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-secondary font-mono text-xs font-semibold text-muted-foreground">{iniziali(r.nome)}</span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-medium">{r.nome}</span>
            <span className="font-mono text-xs leading-snug text-muted-foreground">
              {[r.turno, r.dettaglio].filter(Boolean).join(' · ')}
            </span>
            {puoApprovare && r.stato === 'foto' && r.presenzaFotoId && (
              <div className="mt-2 flex gap-2">
                {r.fotoPath && (
                  <button type="button" onClick={() => vediFoto(r.fotoPath!)} className="h-9 rounded-[8px] border border-line-strong px-3 text-[13px] font-medium active:scale-[0.97]">Vedi foto</button>
                )}
                <button
                  type="button"
                  onClick={() => approva(r)}
                  disabled={inCorso === r.presenzaFotoId}
                  className="flex h-9 items-center gap-1.5 rounded-[8px] bg-primary px-3 text-[13px] font-semibold text-primary-foreground active:scale-[0.97] disabled:opacity-60"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
                  Approva
                </button>
              </div>
            )}
          </div>
          <span className={cn('flex-none whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.04em]', BADGE[r.stato])}>{r.badge}</span>
        </div>
      ))}
    </div>
  )
}
