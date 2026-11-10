'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Foglio, IconaChiudi } from './Foglio'

// Foglio "Timbratura di …" del Direttore v2 (9a): la foto della
// timbratura, ora e motivo, Rifiuta e "Approva timbratura". Sul tablet lo
// stesso foglio sta al centro, largo 520.
export function FoglioFoto({ titolo, foto, meta, uscita, inCorso, onChiudi, onRifiuta, onApprova }: {
  titolo: string
  foto: { path: string; l: string }[]
  meta: { l: string; v: string }[]
  uscita: boolean
  inCorso?: boolean
  onChiudi: () => void
  onRifiuta: () => void
  onApprova: () => void
}) {
  const [sel, setSel] = useState(0)
  const [url, setUrl] = useState<Record<string, string | null>>({})
  const path = foto[Math.min(sel, foto.length - 1)]?.path

  useEffect(() => {
    if (!path || path in url) return
    let vivo = true
    createClient().storage.from('clock_in_proofs').createSignedUrl(path, 300).then(({ data }) => {
      if (vivo) setUrl(p => ({ ...p, [path]: data?.signedUrl ?? null }))
    })
    return () => { vivo = false }
  }, [path, url])

  const src = path ? url[path] : null
  return (
    <Foglio uscita={uscita} onChiudi={onChiudi} etichetta={titolo}
      className="mt-auto w-full gap-3 rounded-t-[16px] border-b-0 px-4 pb-[calc(env(safe-area-inset-bottom)+34px)] pt-2 sm:m-auto sm:w-[520px] sm:rounded-[16px] sm:border-b sm:pb-5">
      <div className="h-1 w-9 flex-none self-center rounded-full bg-line-strong sm:hidden" />
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold">{titolo}</span>
        <button type="button" onClick={onChiudi} aria-label="Chiudi" className="flex h-11 w-11 items-center justify-center text-muted-foreground active:scale-[0.96]"><IconaChiudi s={18} /></button>
      </div>
      {foto.length > 1 && (
        <div className="flex gap-1.5">
          {foto.map((f, i) => (
            <button key={f.path} type="button" onClick={() => setSel(i)}
              className={cn('h-9 rounded-full border px-3 text-[13px] font-medium transition-colors active:scale-[0.97]', i === sel ? 'border-primary bg-primary text-primary-foreground' : 'border-line-strong bg-card')}>{f.l}</button>
          ))}
        </div>
      )}
      <div className="flex h-[340px] flex-none items-center justify-center overflow-hidden rounded-[8px] bg-[oklch(0.9_0.01_250)] text-[13px] font-medium text-muted-foreground dark:bg-secondary">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL firmato temporaneo dello storage */}
        {src ? <img src={src} alt={titolo} className="h-full w-full object-contain" /> : path && !(path in url) ? <div className="skeleton-shimmer h-full w-full" /> : 'Foto della timbratura'}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {meta.map(m => (
          <div key={m.l} className="flex flex-col gap-0.5 rounded-[6px] bg-[oklch(0.97_0.01_250)] px-3 py-2.5 dark:bg-secondary">
            <span className="text-xs text-muted-foreground">{m.l}</span>
            <span className="font-mono text-[15px] font-medium">{m.v}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
        <button type="button" disabled={inCorso} onClick={onRifiuta} className="h-[52px] rounded-[6px] bg-neg-tint text-[15px] font-semibold text-neg active:scale-[0.98] disabled:opacity-60">Rifiuta</button>
        <button type="button" disabled={inCorso} onClick={onApprova} className="h-[52px] rounded-[6px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60">Approva timbratura</button>
      </div>
    </Foglio>
  )
}
