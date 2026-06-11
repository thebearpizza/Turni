'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { QrCode, Download } from 'lucide-react'
import QRCodeLib from 'qrcode'

interface Props {
  restaurantName: string
  qrSecret: string
}

export function RestaurantQrCard({ restaurantName, qrSecret }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    QRCodeLib.toDataURL(qrSecret, {
      width: 320,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then(setDataUrl)
  }, [qrSecret])

  function download() {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `QR-${restaurantName.replace(/\s+/g, '-')}.png`
    a.click()
  }

  return (
    <div className="mt-6 bg-card border border-border rounded-md p-4 flex items-center gap-4">
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt={`QR Code ${restaurantName}`} className="w-20 h-20 rounded-sm border border-border" />
      ) : (
        <div className="w-20 h-20 rounded-sm border border-border bg-muted animate-pulse" />
      )}
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <QrCode className="w-4 h-4 text-muted-foreground" />
          QR Code Timbratura
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">{restaurantName}</p>
      </div>
      <Button size="sm" variant="outline" onClick={download} disabled={!dataUrl}>
        <Download className="w-4 h-4" /> Scarica
      </Button>
    </div>
  )
}
