'use client'

interface Props {
  onApprove: () => void
  onReject: () => void
  disabled?: boolean
  approving?: boolean
  rejecting?: boolean
}

// Coppia Rifiuta / Approva del design ("Da fare" di MTHome): Rifiuta
// bordato, Approva nero, alti 40 px. Stessa resa in tutte le approvazioni.
export function ApproveRejectButtons({ onApprove, onReject, disabled, approving, rejecting }: Props) {
  return (
    <div className="flex flex-none gap-1.5">
      <button type="button" onClick={onReject} disabled={disabled} className="flex h-10 items-center rounded-[8px] border border-line-strong px-3 text-[13px] font-medium active:scale-[0.97] disabled:opacity-60">
        {rejecting ? 'Rifiuto…' : 'Rifiuta'}
      </button>
      <button type="button" onClick={onApprove} disabled={disabled} className="flex h-10 items-center rounded-[8px] bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground active:scale-[0.97] disabled:opacity-60">
        {approving ? 'Approvo…' : 'Approva'}
      </button>
    </div>
  )
}
