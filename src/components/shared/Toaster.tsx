"use client"
import { useToast } from "@/hooks/use-toast"
import { ToastProvider, ToastViewport, Toast, ToastClose, ToastTitle, ToastDescription } from "@/components/ui/toast"

export function Toaster() {
  const { toasts, dismiss } = useToast()
  return (
    <ToastProvider>
      {toasts.map(t => (
        <Toast key={t.id} variant={t.variant} onOpenChange={open => { if (!open) dismiss(t.id) }}>
          <div className="grid gap-1">
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
