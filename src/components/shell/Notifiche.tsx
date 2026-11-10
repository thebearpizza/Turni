'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { AppNotification } from '@/types'

const TZ = 'Europe/Rome'

// Pallino per tipo, come nei prototipi: ambra per ciò che aspetta una
// decisione (assenze, timbrature con foto, modifiche), rosso per ciò che
// manca (chiusura mancante), blu per fatture e comunicati, verde per ciò
// che si è concluso (ODS completato, richiesta approvata), teal per i
// turni pubblicati. Le notifiche non hanno un tipo a DB: si deduce da
// link e titolo.
function colorePallino(n: AppNotification): string {
  const t = `${n.link ?? ''} ${n.title}`.toLowerCase()
  if (/mancant|rifiutat/.test(t)) return 'oklch(0.6 0.13 25)'
  if (/approvat|completat|confermat/.test(t)) return 'oklch(0.55 0.1 150)'
  if (/turni|pubblicat/.test(t)) return 'oklch(0.58 0.12 180)'
  if (/assenz|approvazion|timbratur|modific|richiest/.test(t)) return 'oklch(0.72 0.12 75)'
  if (/ods/.test(t)) return 'oklch(0.55 0.1 150)'
  return 'oklch(0.6 0.11 250)'
}

// "10:58" oggi, "ieri", poi "2 gg".
function quando(iso: string): string {
  const d = new Date(iso)
  const giorno = (x: Date) => formatInTimeZone(x, TZ, 'yyyy-MM-dd')
  const oggi = giorno(new Date())
  if (giorno(d) === oggi) return formatInTimeZone(d, TZ, 'HH:mm')
  const diff = Math.round((Date.parse(oggi) - Date.parse(giorno(d))) / 86400000)
  return diff <= 1 ? 'ieri' : `${diff} gg`
}

export function Notifiche({ onClose, className, tendina }: { onClose: () => void; className?: string; tendina?: boolean }) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [items, setItems] = useState<AppNotification[] | null>(null)

  useEffect(() => {
    supabase.from('notifications').select('id, user_id, title, message, link, read_at, created_at')
      .order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setItems((data ?? []) as AppNotification[]))
  }, [supabase])
  const nonLette = (items ?? []).filter(n => !n.read_at).length

  async function apri(n: AppNotification) {
    onClose()
    if (!n.read_at) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
    if (n.link) router.push(n.link)
  }
  async function tutteLette() {
    const now = new Date().toISOString()
    const prima = items
    setItems(prev => (prev ?? []).map(n => (n.read_at ? n : { ...n, read_at: now })))
    const { error } = await supabase.from('notifications').update({ read_at: now }).is('read_at', null)
    if (error) {
      setItems(prima)
      toast({ title: 'Errore durante l\'aggiornamento. Riprova.', variant: 'destructive' })
    }
  }

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-[16px] border border-border bg-card text-left shadow-[0_20px_60px_rgba(20,30,50,.18)]', className)}>
      <div className="flex flex-none items-baseline gap-2.5 border-b border-border px-[18px] pb-3 pt-4">
        <span className="text-[17px] font-semibold">Notifiche</span>
        <span className="flex-1 text-[13px] text-muted-foreground">{items === null ? '' : nonLette ? `${nonLette} da leggere` : 'Tutte lette'}</span>
        {nonLette > 0 && (
          <button type="button" onClick={tutteLette} className="text-[13px] font-medium text-[oklch(0.5_0.11_180)] active:scale-[0.97] dark:text-[oklch(0.72_0.11_180)]">Segna tutte lette</button>
        )}
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5', tendina && 'flex flex-col gap-0.5')}>
        {items === null ? (
          <div className="space-y-2 p-3">{[0, 1, 2].map(i => <div key={i} className="skeleton-shimmer h-10 rounded-md" />)}</div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nessuna notifica</p>
        ) : items.map(n => (
          <button
            key={n.id}
            type="button"
            onClick={() => apri(n)}
            className={cn(
              'flex w-full items-start gap-3 rounded-[10px] p-3 text-left transition-colors duration-200 active:scale-[0.98]',
              !tendina && 'hover:bg-background',
              !n.read_at && 'bg-[oklch(0.97_0.015_180)] dark:bg-[oklch(0.22_0.02_180)]'
            )}
          >
            <span className={cn('mt-[5px] h-2 w-2 flex-none rounded-full', n.read_at && 'opacity-0')} style={{ background: colorePallino(n) }} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn('text-sm', n.read_at ? 'font-normal' : 'font-semibold')}>{n.title}</span>
              <span className="text-[13px] text-muted-foreground">{n.message}</span>
            </span>
            <span className="flex-none font-mono text-[11px] font-medium text-[oklch(0.55_0.01_250)]">{quando(n.created_at)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
