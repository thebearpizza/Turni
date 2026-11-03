'use client'
import { useState } from 'react'
import { FileSpreadsheet, MessageSquare } from 'lucide-react'
import { ConsultantReportClient } from './ConsultantReportClient'
import { ConsultantInbox } from './ConsultantInbox'
import type { Restaurant } from '@/types'

type Tab = 'report' | 'messaggi'

interface Props {
  userId: string
  fullName: string
  canViewHours: boolean
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
  initialManagerId: string | null
}

export function ConsultantDashboard({ userId, fullName, canViewHours, restaurants, initialManagerId }: Props) {
  const [tab, setTab] = useState<Tab>('report')

  return (
    <div className="flex flex-col">
      {/* Report e Messaggi come segmenti del design (stesso stile dei
          segmenti di sezione del manager), sotto l'intestazione comune. */}
      <div className="mx-4 mb-1 flex gap-[3px] rounded-[14px] border border-border bg-card p-1 shadow-[0_4px_20px_rgba(20,30,50,.08)] sm:mx-auto sm:w-[420px]">
        {([['report', 'Report', FileSpreadsheet], ['messaggi', 'Messaggi', MessageSquare]] as const).map(([k, l, Icona]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-medium transition-colors active:scale-[0.97] ${tab === k ? 'bg-primary text-primary-foreground' : ''}`}
          >
            <Icona className="h-4 w-4" /> {l}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1">
        {tab === 'report' && (
          <div className="p-4 lg:p-6">
            <p className="mb-3 text-[13px] text-muted-foreground">Ciao {fullName.split(' ')[0]} · vista in sola lettura</p>
            {restaurants.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessun ristorante assegnato al tuo account. Contatta il manager.</p>
            ) : (
              <ConsultantReportClient
                restaurants={restaurants}
                canViewHours={canViewHours}
              />
            )}
          </div>
        )}
        {tab === 'messaggi' && (
          <div className="p-4 lg:p-6">
            <ConsultantInbox userId={userId} initialManagerId={initialManagerId} />
          </div>
        )}
      </div>
    </div>
  )
}

