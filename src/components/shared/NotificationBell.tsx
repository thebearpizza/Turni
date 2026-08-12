'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import type { AppNotification } from '@/types'

const TZ = 'Europe/Rome'

// Campanella generica per le notifiche in-app di manager e cassiere.
// Le righe scritte in `notifications` da notificaChiusuraConfermata,
// notificaNuovaPrenotazione, richiedi-modifica, modifica-approve e
// register/route.ts non avevano finora nessuna interfaccia che le
// mostrasse: restavano scritte a DB e mai lette (vedi audit). La RLS
// sulla tabella limita già le righe al proprio user_id, quindi le query
// qui sotto non filtrano esplicitamente per utente — stesso pattern già
// in uso in BottomNav/ManagerSidebar per il badge ODS.
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const router = useRouter()

  const unread = items.filter(n => !n.read_at).length

  const fetchAll = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('notifications')
      .select('id, user_id, title, message, link, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    setItems((data ?? []) as AppNotification[])
  }, [])

  useEffect(() => {
    fetchAll()
    const supabase = createClient()
    const channel = supabase
      .channel('notification_bell')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, fetchAll)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchAll])

  async function handleClick(n: AppNotification) {
    setOpen(false)
    if (!n.read_at) {
      const supabase = createClient()
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
      setItems(prev => prev.map(it => it.id === n.id ? { ...it, read_at: new Date().toISOString() } : it))
    }
    if (n.link) router.push(n.link)
  }

  async function markAllRead() {
    const supabase = createClient()
    const now = new Date().toISOString()
    await supabase.from('notifications').update({ read_at: now }).is('read_at', null)
    setItems(prev => prev.map(it => it.read_at ? it : { ...it, read_at: now }))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="relative p-2 rounded-md hover:bg-accent text-muted-foreground shrink-0" aria-label="Notifiche">
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-h-96 overflow-y-auto p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-semibold">Notifiche</span>
          {unread > 0 && (
            <button type="button" onClick={markAllRead} className="text-xs text-primary hover:underline">
              Segna tutte lette
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nessuna notifica</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map(n => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClick(n)}
                className={`w-full text-left px-3 py-2.5 hover:bg-accent transition-colors ${!n.read_at ? 'bg-accent/40' : ''}`}
              >
                <div className="flex items-start gap-2">
                  {!n.read_at && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-snug">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      {formatInTimeZone(new Date(n.created_at), TZ, 'dd/MM/yyyy HH:mm', { locale: it })}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
