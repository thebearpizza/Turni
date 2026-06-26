'use client'
import { AlertTriangle } from 'lucide-react'

export function DemoBanner() {
  return (
    <div className="w-full bg-amber-500 dark:bg-amber-600 text-white px-4 py-2.5 flex items-center gap-2.5 text-sm font-medium">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>
        Account in attesa di approvazione — stai esplorando una <strong>demo</strong>.
        Alcune funzionalità sono disabilitate fino all'attivazione del servizio.
      </span>
    </div>
  )
}
