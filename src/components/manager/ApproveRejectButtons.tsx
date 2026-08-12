'use client'
import { Button } from '@/components/ui/button'
import { Check, X, Loader2 } from 'lucide-react'

interface Props {
  onApprove: () => void
  onReject: () => void
  disabled?: boolean
  approving?: boolean
  rejecting?: boolean
}

// Stessa coppia Approva/Rifiuta in tutta l'area manager (Approvazioni,
// timbrature di emergenza, account pendenti): prima erano tre rese diverse
// per icone, dimensioni e classi pur trattandosi della stessa identica azione.
export function ApproveRejectButtons({ onApprove, onReject, disabled, approving, rejecting }: Props) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <Button size="sm" onClick={onApprove} disabled={disabled} aria-label="Approva">
        {approving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        Approva
      </Button>
      <Button variant="destructive" size="sm" onClick={onReject} disabled={disabled} aria-label="Rifiuta">
        {rejecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
        Rifiuta
      </Button>
    </div>
  )
}
