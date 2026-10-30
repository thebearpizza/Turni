'use client'
import { useEffect, useState } from 'react'
import QRCodeLib from 'qrcode'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// Riga "QR timbratura del locale" (Bacheca del capo servizio, design):
// tocco su "Mostra" apre il QR grande da far inquadrare a chi è senza GPS.
export function QrLocaleRiga({ nome, qrSecret }: { nome: string; qrSecret: string }) {
  const [aperto, setAperto] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    if (!aperto || qr) return
    QRCodeLib.toDataURL(qrSecret, { width: 560, margin: 1, color: { dark: '#14161a', light: '#ffffff' } }).then(setQr)
  }, [aperto, qr, qrSecret])

  function scarica() {
    if (!qr) return
    const a = document.createElement('a')
    a.href = qr
    a.download = `QR-${nome.replace(/\s+/g, '-')}.png`
    a.click()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAperto(true)}
        className="flex items-center gap-3 rounded-[14px] border border-border bg-card px-3.5 py-3 text-left active:scale-[0.99]"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
        </svg>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[15px] font-medium">QR timbratura del locale</span>
          <span className="text-xs text-muted-foreground">Da mostrare a chi è senza GPS</span>
        </span>
        <span className="text-[13px] text-muted-foreground">Mostra →</span>
      </button>
      <Dialog open={aperto} onOpenChange={setAperto}>
        <DialogContent closeOnOutsideInteract className="max-w-sm">
          <DialogHeader><DialogTitle>{nome}</DialogTitle></DialogHeader>
          <div className="mx-auto aspect-square w-full max-w-[280px] rounded-[12px] border border-border bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR generato in locale */}
            {qr ? <img src={qr} alt={`QR ${nome}`} className="h-full w-full" /> : <div className="skeleton-shimmer h-full w-full rounded" />}
          </div>
          <Button variant="outline" onClick={scarica} disabled={!qr}>Scarica il QR da stampare</Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
