'use client'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { CalendarClock, Clock } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import type { Turn } from '@/types'

const TZ = 'Europe/Rome'

const EXTRAORDINARY_BADGE = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800'
const STANDARD_BADGE = 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800'
const RIPOSO_BADGE = 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800'

interface Props {
  initialTurns: Turn[]
  userId:       string
}

export function MieiTurniClient({ initialTurns, userId }: Props) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns)

  // ── Realtime — i turni assegnati dal manager/capo servizio si
  // aggiornano qui istantaneamente, senza ricaricare la pagina ────────
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('rt-miei-turni')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'turns', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const rec = payload.new as Turn
            setTurns(prev => prev.some(t => t.id === rec.id) ? prev : [...prev, rec])
          } else if (payload.eventType === 'UPDATE') {
            const rec = payload.new as Turn
            setTurns(prev => prev.map(t => t.id === rec.id ? rec : t))
          } else if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id: string }).id
            setTurns(prev => prev.filter(t => t.id !== deletedId))
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])

  const todayStr = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')

  const sorted = [...turns].sort((a, b) =>
    a.date === b.date ? a.start_time.localeCompare(b.start_time) : a.date.localeCompare(b.date)
  )
  const upcoming = sorted.filter(t => t.date >= todayStr)
  const past = sorted.filter(t => t.date < todayStr).reverse()

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-5 pb-3 border-b border-border">
        <CalendarClock className="w-5 h-5 text-muted-foreground shrink-0" />
        <div>
          <h1 className="font-semibold text-sm leading-tight">I Miei Turni</h1>
          <p className="text-muted-foreground text-xs">Turni assegnati, passati e futuri</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6 space-y-6">
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Prossimi Turni
          </p>
          {upcoming.length === 0 ? (
            <EmptyState text="Nessun turno programmato" />
          ) : (
            <div className="space-y-1.5">
              <AnimatePresence initial={false} mode="popLayout">
                {upcoming.map(t => <TurnRow key={t.id} turn={t} />)}
              </AnimatePresence>
            </div>
          )}
        </section>

        <section>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Turni Passati
          </p>
          {past.length === 0 ? (
            <EmptyState text="Nessun turno passato" />
          ) : (
            <div className="space-y-1.5">
              <AnimatePresence initial={false} mode="popLayout">
                {past.map(t => <TurnRow key={t.id} turn={t} />)}
              </AnimatePresence>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-10 text-center">
      <CalendarClock className="w-7 h-7 text-muted-foreground/30 mx-auto mb-2" />
      <p className="text-muted-foreground text-sm">{text}</p>
    </motion.div>
  )
}

function TurnRow({ turn }: { turn: Turn }) {
  const dateLabel = formatInTimeZone(`${turn.date}T12:00:00Z`, TZ, 'EEEE d MMMM', { locale: it })
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
      className="bg-card border border-border rounded-sm px-3 py-2.5 flex items-center gap-3"
    >
      <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-sm font-medium text-foreground capitalize">{dateLabel}</span>
          {turn.is_rest_day ? (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border font-medium whitespace-nowrap ${RIPOSO_BADGE}`}>
              Riposo
            </span>
          ) : turn.is_extraordinary ? (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border font-medium whitespace-nowrap ${EXTRAORDINARY_BADGE}`}>
              Straordinario
            </span>
          ) : (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border font-medium whitespace-nowrap ${STANDARD_BADGE}`}>
              Standard
            </span>
          )}
        </div>
        {!turn.is_rest_day && (
          <p className="text-xs text-muted-foreground">
            {turn.start_time.slice(0, 5)} – {turn.end_time.slice(0, 5)}
            {turn.department ? ` · ${turn.department}` : ''}
          </p>
        )}
        {turn.notes && <p className="text-xs text-muted-foreground/80 mt-0.5">{turn.notes}</p>}
      </div>
    </motion.div>
  )
}
