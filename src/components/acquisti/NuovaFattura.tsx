'use client'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { IcoDx, IcoPiu, Modale, type Locale } from './comuni'
import type { AvvioCattura } from './FatturaCapture'

// "Nuova fattura" (tablet) e "Scansiona fattura" (MTAcquisti): il menu con
// i tre modi di caricarla e lo scanner con l'inquadratura dal vivo.

export function MenuNuovaFattura({ tel, esce, onChiudi, onScatta, onFile, onXml }: {
  tel: boolean; esce: boolean; onChiudi: () => void; onScatta: () => void; onFile: () => void; onXml: () => void
}) {
  const voci: [string, string, () => void][] = [
    ['Scatta foto', 'scanner · più pagine', onScatta],
    ['Carica PDF o immagini', 'più file insieme', onFile],
    ['Importa XML', 'fatture elettroniche del mese', onXml],
  ]
  return (
    <Modale tel={tel} esce={esce} onChiudi={onChiudi} titolo="Nuova fattura" sotto="Come vuoi caricarla?">
      <div className="flex flex-col gap-0.5 p-2">
        {voci.map(([t, s, on]) => (
          <button key={t} type="button" onClick={on} className="flex min-h-16 items-center gap-3.5 rounded-[10px] px-3.5 py-2.5 text-left hover:bg-background active:scale-[0.98]">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{t}</span>
              <span className="text-[13px] text-muted-foreground">{s}</span>
            </span>
            <IcoDx className="text-muted-foreground" />
          </button>
        ))}
      </div>
    </Modale>
  )
}

/** Fotogramma corrente della fotocamera come JPEG. */
async function fotogramma(v: HTMLVideoElement, n: number): Promise<File | null> {
  if (!v.videoWidth) return null
  const c = document.createElement('canvas')
  c.width = v.videoWidth; c.height = v.videoHeight
  c.getContext('2d')?.drawImage(v, 0, 0)
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.92))
  return blob ? new File([blob], `pagina-${n}.jpg`, { type: 'image/jpeg' }) : null
}

export function ScansionaFattura({ tel, esce, locali, localeIniziale, onChiudi, onFile, onPagine }: {
  tel: boolean; esce: boolean
  /** Vuoto per chi ha un solo locale (direttore): niente scelta. */
  locali: Locale[]
  localeIniziale: string
  onChiudi: () => void
  onFile: (restaurantId: string) => void
  onPagine: (restaurantId: string, pagine: File[], avvio: AvvioCattura) => void
}) {
  const [li, setLi] = useState(localeIniziale)
  const [pagine, setPagine] = useState<File[]>([])
  const [camera, setCamera] = useState<'attesa' | 'ok' | 'no'>('attesa')
  const [lettura, setLettura] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const dopoScatto = useRef<'pagina' | 'fine'>('pagina')

  // Inquadratura dal vivo con la fotocamera posteriore; se il browser non
  // la concede si ripiega sulla fotocamera di sistema (input capture).
  useEffect(() => {
    let flusso: MediaStream | null = null, annullato = false
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!md?.getUserMedia) { setTimeout(() => setCamera('no'), 0); return }
    md.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false })
      .then(s => {
        if (annullato) { s.getTracks().forEach(t => t.stop()); return }
        flusso = s
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}) }
        setCamera('ok')
      })
      .catch(() => { if (!annullato) setCamera('no') })
    return () => { annullato = true; flusso?.getTracks().forEach(t => t.stop()) }
  }, [])

  function fine(tutte: File[]) {
    setLettura(true)
    // Una foto sola passa dal ritaglio; più pagine vanno subito in lettura.
    setTimeout(() => onPagine(li, tutte, tutte.length === 1 ? 'ritaglia' : 'leggi'), 360)
  }

  async function scatta(chiudi: boolean) {
    if (lettura) return
    if (camera !== 'ok' || !video.current) { dopoScatto.current = chiudi ? 'fine' : 'pagina'; input.current?.click(); return }
    const f = await fotogramma(video.current, pagine.length + 1)
    if (!f) return
    const tutte = [...pagine, f]
    setPagine(tutte)
    if (chiudi) fine(tutte)
  }

  function daSistema(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const tutte = [...pagine, f]
    setPagine(tutte)
    if (dopoScatto.current === 'fine') fine(tutte)
  }

  const n = pagine.length + 1
  const cornice = tel ? { h: 300, in: '24px 40px', x: 40 } : { h: 340, in: '28px 90px', x: 90 }

  return (
    <Modale tel={tel} esce={esce} onChiudi={onChiudi} titolo="Scansiona fattura" sotto="Inquadra la fattura intera, anche su più pagine">
      <div className={cn('flex flex-col gap-4 py-4', tel ? 'px-4' : 'px-[22px]')}>
        <div className="relative flex items-center justify-center overflow-hidden rounded-[10px] bg-[oklch(0.22_0.01_250)]" style={{ height: cornice.h }}>
          <video ref={video} playsInline muted className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-300', camera === 'ok' ? 'opacity-100' : 'opacity-0')} />
          <div className="absolute rounded-[8px] border-2 border-white/85" style={{ inset: cornice.in }} />
          <span className="relative px-6 text-center text-sm font-medium text-white/85 [text-shadow:0_1px_6px_rgba(0,0,0,.5)]">
            {lettura ? 'Lettura della fattura…' : camera === 'no' ? 'Tocca Scatta per aprire la fotocamera' : 'Allinea la fattura alla cornice'}
          </span>
          {lettura && <div className="absolute top-7 h-0.5 bg-[oklch(0.75_0.12_180)] shadow-[0_0_12px_oklch(0.75_0.12_180)] [animation:scanline_1400ms_ease-in-out_infinite_alternate]" style={{ left: cornice.x, right: cornice.x }} />}
          <span className="absolute right-3.5 top-3 rounded-full bg-white/15 px-[9px] py-[3px] text-[10px] font-semibold uppercase tracking-[.05em] text-white">{n === 1 ? '1 pagina' : `${n} pagine`}</span>
          <style>{'@keyframes scanline{from{top:28px}to{top:calc(100% - 30px)}}'}</style>
        </div>
        {locali.length > 1 && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">Locale</span>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${tel ? 2 : 4},1fr)` }}>
              {locali.map(l => {
                const on = l.id === li
                return (
                  <button key={l.id} type="button" onClick={() => !lettura && setLi(l.id)}
                    className={cn('flex h-11 items-center justify-center gap-2 rounded-[8px] border text-sm font-medium transition-colors duration-200 active:scale-[0.97]',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-card dark:border-line-strong')}>
                    <span className="h-2 w-2 rounded-full" style={{ background: on ? '#fff' : l.colore }} />
                    <span className="truncate">{l.nome}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <div className={cn('grid grid-cols-[1fr_1fr_1.4fr] gap-2.5 transition-opacity duration-200', lettura && 'pointer-events-none opacity-40')}>
          <button type="button" onClick={() => onFile(li)} className="flex h-[52px] items-center justify-center rounded-[8px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">Carica PDF</button>
          <button type="button" onClick={() => scatta(false)} className="flex h-[52px] items-center justify-center gap-1.5 rounded-[8px] border border-line-strong text-[15px] font-medium active:scale-[0.98]"><IcoPiu s={14} />Pagina</button>
          <button type="button" onClick={() => scatta(true)} className="flex h-[52px] items-center justify-center rounded-[8px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98]">{pagine.length > 0 ? 'Scatta e leggi' : 'Scatta'}</button>
        </div>
        <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" onChange={daSistema} />
      </div>
    </Modale>
  )
}
