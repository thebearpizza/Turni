'use client'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import QRCodeLib from 'qrcode'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { TelegramLinkButton } from '@/components/manager/TelegramLinkButton'
import { IconaEsci, IconaEsciPhosphor, IconaScarica, IconaXml } from './icone'

export interface RistoranteQr { id: string; name: string; qr_secret: string | null }

// Riga "Tema" (chiaro, scuro, automatico): il design ha i token di
// entrambi i temi (Fondamenta), la scelta resta nel profilo.
function RigaTema({ compatta }: { compatta?: boolean }) {
  const { theme, setTheme } = useTheme()
  return (
    <div className={cn('flex flex-none items-center gap-2.5 border-b border-border text-[15px] font-medium', compatta ? 'min-h-[52px] px-4' : 'h-[52px] px-[18px]')}>
      <span className="flex-1">Tema</span>
      <div className="flex gap-0.5 rounded-[7px] bg-[var(--line)] p-[3px]">
        {([['light', 'Chiaro'], ['dark', 'Scuro'], ['system', 'Auto']] as const).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTheme(k)}
            className={cn('h-8 rounded-[5px] px-2.5 text-[13px] active:scale-[0.97]', theme === k ? 'bg-card font-semibold shadow-[0_1px_2px_rgba(0,0,0,.12)]' : 'font-medium text-muted-foreground')}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}

// Foglio A4 da stampare con il QR del locale (prototipo: "Scarica PDF da
// stampare" apre la stampa del browser, da cui si salva in PDF).
async function stampaQr(r: RistoranteQr) {
  if (!r.qr_secret) return
  try {
    const svg = await QRCodeLib.toString(r.qr_secret, { type: 'svg', margin: 0, color: { dark: '#14161a', light: '#ffffff' } })
    const nome = r.name.replace(/[<>&]/g, '')
    const doc = `<!doctype html><html><head><title>QR timbratura · ${nome}</title><style>@page{size:A4;margin:0}body{margin:0;font-family:Geist,Helvetica,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:18px}h1{font-size:30pt;margin:0}p{font-size:14pt;color:#555;margin:0}.qr{width:420px;height:420px}.qr svg{width:100%;height:100%;shape-rendering:crispEdges}</style></head><body><h1>${nome}</h1><p>Inquadra per timbrare ingresso e uscita</p><div class="qr">${svg}</div></body></html>`
    const w = window.open('', '_blank')
    if (!w) throw new Error('popup')
    w.document.write(doc)
    w.document.close()
    setTimeout(() => w.print(), 300)
  } catch {
    toast({ title: 'Non è stato possibile aprire la stampa. Riprova.', variant: 'destructive' })
  }
}

/** Pannello del profilo di manager e direttore: QR del locale, PDF, XML, Esci. */
export function PannelloProfilo({ nome, descrizione, ristoranti, telefono, conXml, conTelegram, onEsci, onXml, className }: {
  nome: string; descrizione: string; ristoranti: RistoranteQr[]; telefono: boolean
  conXml: boolean; conTelegram: boolean; onEsci: () => void; onXml: () => void; className?: string
}) {
  const conQr = ristoranti.filter(r => r.qr_secret)
  const [sel, setSel] = useState(0)
  const [qr, setQr] = useState<string | null>(null)
  const scelto = conQr[Math.min(sel, conQr.length - 1)]

  useEffect(() => {
    if (!scelto?.qr_secret) return
    QRCodeLib.toDataURL(scelto.qr_secret, { width: 320, margin: 0, color: { dark: '#14161a', light: '#ffffff' } }).then(setQr)
  }, [scelto?.qr_secret])

  // Sul telefono le pillole ci sono anche con un solo locale (Direttore
  // Smartphone), sul tablet solo se c'è da scegliere (Direttore Tablet v2).
  const pillole = conQr.length > 1 || (telefono && conQr.length === 1)

  return (
    <div className={cn('flex flex-col overflow-hidden overflow-y-auto overscroll-contain rounded-[16px] border border-border bg-card shadow-[0_20px_60px_rgba(20,30,50,.18)]', className)}>
      <div className="flex flex-none flex-col gap-0.5 border-b border-border px-[18px] py-4">
        <span className="text-base font-semibold">{nome}</span>
        <span className="text-[13px] text-muted-foreground">{descrizione}</span>
      </div>
      {scelto && (
        <div className="flex flex-none flex-col gap-2.5 border-b border-border px-[18px] py-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">QR timbratura del locale</span>
          {pillole && (
            <div className="flex flex-wrap gap-1.5">
              {conQr.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSel(i)}
                  className={cn('flex h-9 items-center rounded-full border px-3 text-[13px] font-medium transition-colors duration-200 active:scale-[0.97]',
                    r.id === scelto.id ? 'border-primary bg-primary text-primary-foreground' : 'border-[oklch(0.88_0.01_250)] bg-card dark:border-line-strong')}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
          <div className="box-border flex h-[184px] w-[184px] items-center justify-center self-center rounded-[12px] border border-border bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR generato in locale come data URL */}
            {qr ? <img src={qr} alt={`QR ${scelto.name}`} className="h-full w-full [image-rendering:pixelated]" /> : <div className="skeleton-shimmer h-full w-full rounded" />}
          </div>
          <span className="self-center text-center text-xs text-muted-foreground">{scelto.name} · stampalo vicino all&apos;ingresso</span>
          <button type="button" onClick={() => stampaQr(scelto)} className="flex h-11 items-center justify-center gap-2 rounded-[8px] border border-line-strong text-sm font-medium active:scale-[0.98]">
            <IconaScarica />
            Scarica PDF da stampare
          </button>
        </div>
      )}
      {conXml && (
        <button type="button" onClick={onXml} className="flex h-[52px] flex-none items-center gap-2.5 border-b border-border px-[18px] text-left text-[15px] font-medium hover:bg-background active:scale-[0.98]">
          <IconaXml />
          <span className="flex-1">Importa fatture XML</span>
          <span className="text-[13px] font-normal text-muted-foreground">del mese</span>
        </button>
      )}
      {conTelegram && <TelegramLinkButton />}
      <RigaTema />
      <button type="button" onClick={onEsci} className="flex h-[52px] flex-none items-center gap-2.5 px-[18px] text-left text-[15px] font-medium text-[oklch(0.45_0.1_25)] hover:bg-background active:scale-[0.98] dark:text-neg">
        <IconaEsci />
        Esci
      </button>
    </div>
  )
}

/** Tendina del profilo (Dipendente v2, Capo Servizio): nome, ruolo, Esci. */
export function TendinaProfilo({ nome, descrizione, conTelegram, onEsci, className }: {
  nome: string; descrizione: string; conTelegram: boolean; onEsci: () => void; className?: string
}) {
  return (
    <div className={cn('w-[248px] overflow-hidden rounded-[10px] border border-line-strong bg-card shadow-[0_6px_24px_rgba(20,30,50,.10)]', className)}>
      <div className="flex flex-col gap-0.5 border-b border-border px-4 py-3.5">
        <span className="text-base font-semibold">{nome}</span>
        <span className="text-[13px] text-muted-foreground">{descrizione}</span>
      </div>
      {conTelegram && <TelegramLinkButton />}
      <RigaTema compatta />
      <button type="button" onClick={onEsci} className="flex min-h-[52px] w-full items-center gap-2.5 px-4 text-left text-[15px] font-semibold text-[oklch(0.45_0.1_25)] active:bg-[oklch(0.97_0.01_250)] dark:text-neg dark:active:bg-secondary">
        <IconaEsciPhosphor />
        Esci
      </button>
    </div>
  )
}
