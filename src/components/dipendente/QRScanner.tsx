'use client'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface Props {
  onScan: (result: string) => void
  onClose: () => void
}

export function QRScanner({ onScan, onClose }: Props) {
  const scannerRef = useRef<unknown>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let html5QrCode: unknown

    async function startScanner() {
      const { Html5Qrcode } = await import('html5-qrcode')

      if (!containerRef.current) return

      html5QrCode = new Html5Qrcode('qr-reader')
      scannerRef.current = html5QrCode

      try {
        await (html5QrCode as { start: (constraint: unknown, config: unknown, onSuccess: (text: string) => void, onError: () => void) => Promise<void> }).start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (text: string) => {
            onScan(text)
          },
          () => {}
        )
      } catch (err) {
        console.error('Camera error:', err)
      }
    }

    startScanner()

    return () => {
      const qr = scannerRef.current as { stop?: () => Promise<void>; clear?: () => Promise<void> } | null
      if (qr?.stop) {
        qr.stop().then(() => qr.clear?.()).catch(() => {})
      }
    }
  }, [onScan])

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between p-4">
        <p className="text-white font-medium">Inquadra il QR Code del ristorante</p>
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div ref={containerRef} id="qr-reader" className="w-full max-w-sm" />
      </div>
    </div>
  )
}
