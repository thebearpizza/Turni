"use client"
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

// Returns true when the originating DOM event happened inside a Radix popper
// layer (Select/Popover/Dropdown/Calendar content is portalled and wrapped in
// `[data-radix-popper-content-wrapper]`). Used to stop those interactions from
// being treated as an "outside click" that would close the surrounding Dialog.
function isInsideRadixPopper(
  e: { detail?: { originalEvent?: Event }; target?: EventTarget | null }
): boolean {
  const originalTarget = e.detail?.originalEvent?.target ?? e.target
  const node = originalTarget as HTMLElement | null
  return !!(
    node &&
    typeof node.closest === "function" &&
    node.closest("[data-radix-popper-content-wrapper]")
  )
}

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    // Di default NESSUN dialog si chiude per un click/tocco fuori dal
    // contenuto — resta comunque chiudibile con Esc, la X o un bottone
    // Annulla, tutti espliciti. Un form perde altrimenti tutti i dati
    // inseriti per un click "vagante": capita spesso perché il box è
    // centrato con una transform (righe sotto) e si riposiziona sullo
    // schermo quando il contenuto cambia altezza mentre si digita (es.
    // una riga di riepilogo che compare/scompare) — il click successivo,
    // puntato dove il box era un attimo prima, atterra sull'overlay.
    // Chi vuole il comportamento classico (dialog di sola visualizzazione,
    // senza nulla da perdere) lo dichiara esplicitamente qui.
    closeOnOutsideInteract?: boolean
  }
>(({ className, children, onPointerDownOutside, onInteractOutside, closeOnOutsideInteract = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onPointerDownOutside={(e) => {
        // Bloccato di default; fa eccezione solo un dialog che ha dichiarato
        // closeOnOutsideInteract — e anche lì, mai quando il pointer-down è
        // dentro un layer popper di Radix (Select/Popover/Dropdown/Calendar):
        // altrimenti scegliere un'opzione in un popper portato fuori dal
        // dialog conterebbe come interazione "esterna".
        if (!closeOnOutsideInteract || isInsideRadixPopper(e)) e.preventDefault()
        onPointerDownOutside?.(e)
      }}
      onInteractOutside={(e) => {
        if (!closeOnOutsideInteract || isInsideRadixPopper(e)) e.preventDefault()
        onInteractOutside?.(e)
      }}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog, DialogPortal, DialogOverlay, DialogClose, DialogTrigger,
  DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
}
