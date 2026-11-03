'use client'
import { useSyncExternalStore } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'

// Dialogo di conferma del design ("Eliminare il turno?"): titolo, riga di
// dettaglio, Annulla ed Elimina affiancati. Al posto di window.confirm,
// che su telefono mostra la finestra di sistema fuori stile. Si usa come
// una promessa: if (!(await chiediConferma({ titolo: '…' }))) return

export interface RichiestaConferma {
  titolo: string
  testo?: string
  conferma?: string
  annulla?: string
  /** Azione distruttiva (default): pulsante rosso. */
  distruttiva?: boolean
}

type Stato = (RichiestaConferma & { risolvi: (ok: boolean) => void }) | null
let stato: Stato = null
const ascoltatori = new Set<() => void>()
const emetti = () => ascoltatori.forEach(l => l())

export function chiediConferma(r: RichiestaConferma): Promise<boolean> {
  return new Promise(risolvi => {
    stato?.risolvi(false)
    stato = { ...r, risolvi }
    emetti()
  })
}

function chiudi(ok: boolean) {
  const s = stato
  stato = null
  emetti()
  s?.risolvi(ok)
}

export function ConfermaHost() {
  const s = useSyncExternalStore(
    l => { ascoltatori.add(l); return () => ascoltatori.delete(l) },
    () => stato,
    () => null
  )
  const distruttiva = s?.distruttiva ?? true
  return (
    <DialogPrimitive.Root open={!!s} onOpenChange={o => { if (!o) chiudi(false) }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-[oklch(0.2_0.01_250/0.38)] dark:bg-black/70" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-[91] mx-auto flex w-full max-w-md flex-col gap-3 rounded-t-[18px] border border-b-0 border-border bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-2 shadow-sheet outline-none anim-swapin sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-[16px] sm:border-b sm:pb-5 sm:pt-5"
        >
          <div className="mx-auto h-1 w-9 rounded-full bg-line-strong sm:hidden" />
          <DialogPrimitive.Title className="text-[17px] font-semibold">{s?.titolo}</DialogPrimitive.Title>
          {s?.testo ? (
            <DialogPrimitive.Description className="text-[15px] leading-[1.45] text-muted-foreground text-pretty">{s.testo}</DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">Conferma l&apos;azione</DialogPrimitive.Description>
          )}
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => chiudi(false)} className="h-12 rounded-[10px] border border-line-strong bg-card text-[15px] font-medium active:scale-[0.98]">
              {s?.annulla ?? 'Annulla'}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => chiudi(true)}
              className={cn('h-12 rounded-[10px] text-[15px] font-semibold active:scale-[0.98]', distruttiva ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground')}
            >
              {s?.conferma ?? (distruttiva ? 'Elimina' : 'Conferma')}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
