'use client'
import { useState } from 'react'
import { ReportClient } from '@/components/manager/ReportClient'
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

// Il consulente del lavoro non ha un design proprio: usa la stessa scheda
// Report del manager (MTReport) in sola lettura, sui locali che gli sono
// assegnati, e i Messaggi con lo stesso linguaggio visivo.
export function ConsultantDashboard({ userId, canViewHours, restaurants, initialManagerId }: Props) {
  const [tab, setTab] = useState<Tab>('report')

  return (
    <div className="flex h-full flex-col">
      {/* Report e Messaggi come segmenti di sezione del design (stesso
          stile dei segmenti del manager), sotto l'intestazione comune. */}
      <div className="mx-4 mb-2.5 flex flex-none gap-[3px] rounded-[14px] border border-border bg-card p-1 shadow-[0_4px_20px_rgba(20,30,50,.08)] sm:mx-auto sm:w-[480px]">
        {([['report', 'Report'], ['messaggi', 'Messaggi']] as const).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex h-10 flex-1 items-center justify-center rounded-[10px] text-[13px] font-medium transition-colors duration-200 active:scale-[0.97] ${tab === k ? 'bg-primary text-primary-foreground' : 'text-foreground'}`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'report' ? (
          <ReportClient
            restaurants={restaurants}
            singolo={restaurants.length <= 1}
            puoModificare={false}
            vedeOre={canViewHours}
            utenteId={userId}
          />
        ) : (
          <ConsultantInbox userId={userId} initialManagerId={initialManagerId} />
        )}
      </div>
    </div>
  )
}
