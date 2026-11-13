'use client'
import { useState } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'
import { Tastierino, type TastoTastierino } from '@/components/ui/tastierino'

// Condiviso fra la richiesta del dipendente e la cella del Report.
// Codice del certificato INPS: solo cifre (fino a 12), con il tastierino
// del design invece della tastiera nativa. Non è un numero: gli zeri
// iniziali contano, quindi niente CampoNumerico.
export function CampoCodiceInps({ valore, onChange, facoltativo = true }: { valore: string; onChange: (v: string) => void; facoltativo?: boolean }) {
  const [aperto, setAperto] = useState(false)
  const [digitato, setDigitato] = useState(false)
  const premi = (k: TastoTastierino) => {
    const base = digitato ? valore : ''
    setDigitato(true)
    if (k === 'del') onChange(base.slice(0, -1))
    else if (/^\d$/.test(k) && base.length < 12) onChange(base + k)
    else onChange(base)
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Codice certificato INPS {facoltativo && <span className="font-normal text-muted-foreground">(se ce l&apos;hai)</span>}</span>
      <PopoverPrimitive.Root open={aperto} onOpenChange={o => { setAperto(o); if (o) setDigitato(false) }}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            className={cn(
              'flex h-[52px] items-center rounded-[6px] px-3.5 text-left font-mono text-lg font-medium tracking-[.04em]',
              aperto ? 'border-[1.5px] border-[oklch(0.58_0.12_180)]' : 'border border-line-strong',
              valore ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {valore || 'Tocca per inserire'}
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content side="bottom" align="center" sideOffset={8} collisionPadding={12} onOpenAutoFocus={e => e.preventDefault()} className="anim-swapin z-[80] outline-none">
            <Tastierino senzaVirgola onKey={premi} onDone={() => setAperto(false)} />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  )
}
