"use client"
import { useToast } from "@/hooks/use-toast"
import { ToastProvider, ToastViewport, Toast, ToastClose, ToastTitle, ToastDescription } from "@/components/ui/toast"

export function Toaster() {
  const { toasts, dismiss } = useToast()
  return (
    <ToastProvider>
      {toasts.map(t => (
        <Toast key={t.id} variant={t.variant} duration={4000} onOpenChange={open => { if (!open) dismiss(t.id) }}>
          {/* Pallino: rosso con ✕ per gli errori, verde con spunta per le conferme. */}
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
          <div className="grid gap-0.5">
            <ToastTitle>{t.title}</ToastTitle>
            {t.description && <ToastDescription>{t.description}</ToastDescription>}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}
