'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { decidi } from '@/components/home/DaFare'
import { FoglioFoto } from '@/components/home/FoglioFoto'
import { useFoglio } from '@/components/home/Foglio'
import { ApproveRejectButtons } from '@/components/manager/ApproveRejectButtons'

export interface Richiesta {
  id: string
  tipo: 'foto' | 'assenza'
  nome: string
  badge: string
  dettaglio: string
  nota?: string | null
  foto: { path: string; l: string }[]
}

// Approvazioni: timbrature con foto e richieste di assenza in attesa, con
// le stesse righe del "Da fare" della Home (MTHome). La foto si guarda in
// un foglio (Direttore v2, 9a) da cui si approva o rifiuta. La lista si
// aggiorna da sola quando qualcun altro decide.
export function ApprovazioniClient({ iniziali }: { iniziali: Richiesta[] }) {
  const router = useRouter()
  const [uscita, setUscita] = useState<Set<string>>(new Set())
  const [via, setVia] = useState<Set<string>>(new Set())
  const [inCorso, setInCorso] = useState<string | null>(null)
  const foglio = useFoglio<Richiesta>()
  const voci = iniziali.filter(r => !via.has(r.id))

  useEffect(() => {
    const sb = createClient()
    const ch = sb.channel('rt-approvazioni')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absences' }, () => router.refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances' }, () => router.refresh())
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [router])

  async function agisci(r: Richiesta, azione: 'approve' | 'reject') {
    setInCorso(r.id)
    const ok = await decidi(r.tipo, r.id, azione)
    setInCorso(null)
    if (!ok) {
      toast({ title: azione === 'approve' ? "Errore durante l'approvazione. Riprova." : 'Errore durante il rifiuto. Riprova.', variant: 'destructive' })
      return
    }
    toast({ title: `${azione === 'approve' ? 'Approvata' : 'Rifiutata'}: ${r.tipo === 'foto' ? 'timbratura con foto' : r.badge.toLowerCase()} di ${r.nome.split(' ')[0]}` })
    if (foglio.valore?.id === r.id) foglio.chiudi()
    setUscita(p => new Set(p).add(r.id))
    setTimeout(() => { setVia(p => new Set(p).add(r.id)); router.refresh() }, 320)
  }

  return (
    <div className="flex flex-col px-4 pb-2 sm:h-full sm:px-8">
      <div className="anim-swapin flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-border bg-card sm:flex-1">
        <div className="flex flex-none items-center gap-2.5 border-b border-border px-3.5 py-3.5 sm:px-[18px]">
          <span className="text-[17px] font-semibold">Da approvare</span>
          <span className="flex-1 font-mono text-[13px] font-medium text-muted-foreground">{voci.length ? `${voci.length} in attesa` : ''}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {voci.length === 0 ? (
            <div className="anim-swapin flex flex-col items-center gap-1 px-[18px] py-12 text-center">
              <span className="text-[15px] font-semibold">Tutto in ordine</span>
              <span className="text-[13px] text-muted-foreground">Nessuna richiesta in attesa.</span>
            </div>
          ) : voci.map(r => (
            <div key={r.id} className={cn('flex flex-wrap items-center gap-3 border-b border-[oklch(0.93_0.01_250)] px-3.5 py-3 dark:border-border sm:flex-nowrap sm:px-[18px]', uscita.has(r.id) && 'anim-swapout')}>
              <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-[3px]">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {r.nome}
                  <span className="rounded-full bg-warn-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.05em] text-warn">{r.badge}</span>
                </span>
                <span className="text-[13px] text-muted-foreground">{r.dettaglio}</span>
                {r.nota && <span className="text-[13px] leading-snug text-pretty">{r.nota}</span>}
              </div>
              {r.foto.length > 0 && (
                <button type="button" onClick={() => foglio.apri(r)} className="flex h-10 flex-none items-center gap-1.5 rounded-[8px] border border-line-strong px-3 text-[13px] font-medium active:scale-[0.97]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
                  Foto
                </button>
              )}
              <ApproveRejectButtons disabled={inCorso === r.id} onApprove={() => agisci(r, 'approve')} onReject={() => agisci(r, 'reject')} />
            </div>
          ))}
        </div>
      </div>
      {foglio.valore && (
        <FoglioFoto
          titolo={`Timbratura di ${foglio.valore.nome}`}
          foto={foglio.valore.foto}
          meta={[{ l: 'Timbratura', v: foglio.valore.dettaglio.split(' · ').slice(0, 2).join(' · ') }, { l: 'Motivo', v: 'GPS non verificato' }]}
          uscita={foglio.uscita}
          inCorso={inCorso === foglio.valore.id}
          onChiudi={foglio.chiudi}
          onRifiuta={() => agisci(foglio.valore!, 'reject')}
          onApprova={() => agisci(foglio.valore!, 'approve')}
        />
      )}
    </div>
  )
}
