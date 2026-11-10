'use client'
import { useEffect, useState } from 'react'
import QRCodeLib from 'qrcode'
import { toast } from '@/hooks/use-toast'
import { FoglioAltro, TestataFoglio, CorpoFoglio, useUscita, ICONA_SCARICA } from './comuni'

// QR di timbratura di un locale: riga "QR timbratura del locale · Mostra →"
// della Bacheca del capo servizio e foglio con il QR grande, aperto anche da
// Ristoranti ("QR timbratura"). "Scarica PDF da stampare" apre la pagina A4
// del prototipo (nome del locale, istruzione, QR) e la stampa.

export interface LocaleQr { name: string; qr_secret: string | null }

export function stampaQr(l: LocaleQr) {
  if (!l.qr_secret) return
  const w = window.open('', '_blank')
  if (!w) { toast({ title: 'Il browser ha bloccato la finestra di stampa', variant: 'destructive' }); return }
  QRCodeLib.toString(l.qr_secret, { type: 'svg', margin: 1, color: { dark: '#14161a', light: '#ffffff' } }).then(svg => {
    const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))
    w.document.write('<!doctype html><html><head><title>QR timbratura · ' + esc(l.name) + '</title><style>@page{size:A4;margin:0}body{margin:0;font-family:Geist,Helvetica,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:18px}h1{font-size:30pt;margin:0}p{font-size:14pt;color:#555;margin:0}svg{width:420px;height:420px}</style></head><body><h1>' + esc(l.name) + '</h1><p>Inquadra per timbrare ingresso e uscita</p>' + svg + '</body></html>')
    w.document.close()
    setTimeout(() => w.print(), 300)
  })
}

export function FoglioQr({ locale, aperto, esce, onChiudi }: { locale: LocaleQr | null; aperto: boolean; esce: boolean; onChiudi: () => void }) {
  const [qr, setQr] = useState<{ s: string; url: string } | null>(null)
  const segreto = locale?.qr_secret ?? null
  useEffect(() => {
    if (!aperto || !segreto) return
    let vivo = true
    QRCodeLib.toDataURL(segreto, { width: 560, margin: 1, color: { dark: '#14161a', light: '#ffffff' } }).then(url => { if (vivo) setQr({ s: segreto, url }) })
    return () => { vivo = false }
  }, [aperto, segreto])
  const img = qr && qr.s === segreto ? qr.url : null
  return (
    <FoglioAltro aperto={aperto && !!locale} esce={esce} onChiudi={onChiudi} larghezza={480} altoTablet={150} testata={<TestataFoglio titolo={locale?.name ?? ''} onChiudi={onChiudi} />}>
      <CorpoFoglio>
        <span className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">QR timbratura del locale</span>
        <div className="box-border aspect-square w-full max-w-[280px] self-center rounded-[12px] border border-border bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- QR generato in locale come data URL */}
          {img ? <img src={img} alt={`QR ${locale?.name ?? ''}`} className="h-full w-full" /> : <div className="skeleton-shimmer h-full w-full rounded" />}
        </div>
        <span className="self-center text-xs text-muted-foreground">{locale?.name} · stampalo vicino all&apos;ingresso</span>
        <button type="button" onClick={() => locale && stampaQr(locale)} disabled={!segreto}
          className="flex h-11 items-center justify-center gap-2 rounded-[8px] border border-line-strong text-sm font-medium active:scale-[0.98] disabled:opacity-40">
          {ICONA_SCARICA}Scarica PDF da stampare
        </button>
      </CorpoFoglio>
    </FoglioAltro>
  )
}

/** Riga della Bacheca del capo servizio (Capo Servizio.dc.html, 7b). */
export function RigaQr({ locale }: { locale: LocaleQr }) {
  const f = useUscita<true>()
  return (
    <>
      <button type="button" onClick={() => f.apri(true)}
        className="flex min-h-[60px] flex-none items-center gap-3 rounded-[14px] border border-border bg-card px-3.5 text-left active:scale-[0.99]">
        <svg width="24" height="24" viewBox="0 0 256 256" fill="currentColor" aria-hidden><path d="M104,40H56A16,16,0,0,0,40,56v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,104,40Zm0,64H56V56h48v48Zm0,32H56a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,104,136Zm0,64H56V152h48v48ZM200,40H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,64H152V56h48v48Zm-64,72V144a8,8,0,0,1,16,0v32a8,8,0,0,1-16,0Zm80-16a8,8,0,0,1-8,8H184v40a8,8,0,0,1-8,8H144a8,8,0,0,1,0-16h24V144a8,8,0,0,1,16,0v8h24A8,8,0,0,1,216,160Zm0,32v16a8,8,0,0,1-16,0V192a8,8,0,0,1,16,0Z" /></svg>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-[15px] font-medium">QR timbratura del locale</span>
          <span className="text-xs text-muted-foreground">Da mostrare a chi è senza GPS</span>
        </span>
        <span className="text-[13px] font-medium text-muted-foreground">Mostra →</span>
      </button>
      <FoglioQr locale={locale} aperto={!!f.dati} esce={f.esce} onChiudi={() => f.chiudi()} />
    </>
  )
}
