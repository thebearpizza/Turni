'use client'
import { useState } from 'react'
import { FileSpreadsheet, MessageSquare, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { ConsultantReportClient } from './ConsultantReportClient'
import { ConsultantInbox } from './ConsultantInbox'
import type { Restaurant } from '@/types'

type Tab = 'report' | 'messaggi'

interface Props {
  userId: string
  fullName: string
  canViewHours: boolean
  restaurants: Pick<Restaurant, 'id' | 'name'>[]
}

export function ConsultantDashboard({ userId, fullName, canViewHours, restaurants }: Props) {
  const [tab, setTab] = useState<Tab>('report')
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-[100dvh] flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 h-14 border-b border-border bg-background/95 backdrop-blur">
        <div>
          <span className="font-semibold text-sm">inTurno</span>
          <span className="ml-2 text-xs text-muted-foreground">· Consulente del Lavoro</span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md hover:bg-accent transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Esci
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border bg-background">
        <TabBtn active={tab === 'report'} onClick={() => setTab('report')}>
          <FileSpreadsheet className="w-4 h-4" />
          Report
        </TabBtn>
        <TabBtn active={tab === 'messaggi'} onClick={() => setTab('messaggi')}>
          <MessageSquare className="w-4 h-4" />
          Messaggi
        </TabBtn>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'report' && (
          <div className="p-4 lg:p-6">
            <div className="mb-4">
              <h1 className="text-lg font-semibold">Benvenuto, {fullName}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Vista in sola lettura · nessuna modifica consentita</p>
            </div>
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
            <ConsultantInbox userId={userId} />
          </div>
        )}
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
