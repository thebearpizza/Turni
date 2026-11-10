'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useTelefono } from '@/hooks/useTelefono'
import type { RiquadroArticolo } from '@/types'
import { Modale, USCITA_MS } from './comuni'

const BUCKET = 'fatture_foto'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  fotoPaths: string[]
  title: string
  /** Rilegge le stesse foto da capo (solo da Fatture). */
  onRescan?: () => void
  /** Evidenzia la riga di un articolo nella sua pagina. */
  evidenzia?: { paginaIndice: number; riquadro: RiquadroArticolo } | null
}

// Foto originali di una fattura nel foglio modale del design: URL firmati
// sul bucket privato, una pagina sotto l'altra.
export function FatturaFotoViewer({ open, onOpenChange, fotoPaths, title, onRescan, evidenzia }: Props) {
  const tel = useTelefono()
  const [visibile, setVisibile] = useState(open)
  const [esce, setEsce] = useState(false)
  const [urls, setUrls] = useState<string[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const evRef = useRef<HTMLDivElement>(null)
  const [ultimoOpen, setUltimoOpen] = useState(open)
  const [paths, setPaths] = useState(fotoPaths)

  // Apertura/chiusura animata derivata dal prop (senza setState negli effect).
  if (open !== ultimoOpen) {
    setUltimoOpen(open)
    if (open) { setVisibile(true); setEsce(false); setUrls(null); setErrore(null); setPaths(fotoPaths) } else setEsce(true)
  }
  useEffect(() => {
    if (!esce) return
    const t = setTimeout(() => { setVisibile(false); setEsce(false) }, USCITA_MS)
    return () => clearTimeout(t)
  }, [esce])

  useEffect(() => {
    if (!open || !paths.length) return
    let annullato = false
    const sb = createClient()
    Promise.all(paths.map(p => sb.storage.from(BUCKET).createSignedUrl(p, 300))).then(rs => {
      if (annullato) return
      const ko = rs.find(r => r.error)
      if (ko?.error) setErrore(ko.error.message)
      else setUrls(rs.map(r => r.data!.signedUrl))
    })
    return () => { annullato = true }
  }, [open, paths])

  useEffect(() => { if (urls && evidenzia) evRef.current?.scrollIntoView({ block: 'center' }) }, [urls, evidenzia])

  if (!visibile) return null
  return (
    <Modale tel={tel} esce={esce} onChiudi={() => onOpenChange(false)} titolo="Foto della fattura" sotto={title} larghezza={720}
      piede={onRescan && paths.length > 0 ? (
        <div className="flex-none border-t border-border px-4 py-3 sm:px-[22px]">
          <button type="button" onClick={onRescan} className="flex h-[52px] w-full items-center justify-center rounded-[8px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">Rileggi la fattura da capo</button>
        </div>
      ) : undefined}>
      <div className="flex flex-col gap-3 p-4 sm:px-[22px]">
        {errore && <p className="text-sm font-medium text-neg">Foto non caricate: {errore}</p>}
        {!errore && !urls && <div className="skeleton-shimmer h-[420px] rounded-[10px]" />}
        {urls?.map((u, i) => {
          const pdf = paths[i]?.toLowerCase().endsWith('.pdf')
          const r = evidenzia?.paginaIndice === i ? evidenzia.riquadro : null
          return pdf ? (
            <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="flex h-[52px] items-center justify-between rounded-[8px] border border-line-strong px-3.5 text-[15px] font-medium active:scale-[0.98]">
              Pagina {i + 1} · PDF<span className="text-[13px] font-normal text-muted-foreground">Apri</span>
            </a>
          ) : (
            <div key={i} ref={r ? evRef : undefined} className="relative overflow-hidden rounded-[10px] border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element -- URL firmato temporaneo su storage privato */}
              <img src={u} alt={`Pagina ${i + 1}`} className="w-full" />
              {r && (
                <div className="pointer-events-none absolute rounded-[3px] border-2 border-[oklch(0.58_0.12_180)]"
                  style={{ top: `${r.y_min / 10}%`, left: `${r.x_min / 10}%`, width: `${(r.x_max - r.x_min) / 10}%`, height: `${(r.y_max - r.y_min) / 10}%`, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }} />
              )}
            </div>
          )
        })}
      </div>
    </Modale>
  )
}
