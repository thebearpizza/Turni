"use client"
import { useToast } from "@/hooks/use-toast"
import { ToastProvider, ToastViewport, Toast, ToastClose, ToastTitle, ToastDescription } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

// Toast del design (Errori.dc.html, 1b): pallino rosso con ✕ per gli
// errori, verde con spunta per le conferme, azione facoltativa a destra
// (Componenti.dc.html: "Annulla" a 600 13px, opacità .7). Entra con
// swapin, esce con swapout dopo 4 secondi (tempi in use-toast).
export function Toaster() {
  const { toasts, dismiss } = useToast()
  return (
    <ToastProvider duration={Infinity}>
      {toasts.map(t => (
        <Toast
          key={t.id}
          variant={t.variant}
          duration={Infinity}
          onOpenChange={open => { if (!open) dismiss(t.id) }}
          className={cn(t.uscita ? 'anim-swapout' : 'anim-swapin')}
        >
          <span
            className="flex h-5 w-5 flex-none items-center justify-center rounded-full"
            style={{ background: t.variant === 'destructive' ? 'oklch(0.62 0.17 25)' : 'oklch(0.62 0.13 150)' }}
          >
            {t.variant === 'destructive' ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 5.2l2 2L8 3" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
          </span>
          <div className="grid min-w-0 gap-0.5">
            <ToastTitle>{t.title}</ToastTitle>
            {t.description && <ToastDescription>{t.description}</ToastDescription>}
          </div>
          {t.action && (
            <button
              type="button"
              onClick={() => { t.action?.onClick(); dismiss(t.id) }}
              className="ml-1 flex-none text-[13px] font-semibold opacity-70 transition-opacity hover:opacity-100 active:scale-[0.97]"
            >
              {t.action.label}
            </button>
          )}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}
