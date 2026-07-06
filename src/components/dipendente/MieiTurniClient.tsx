'use client'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { CalendarClock, Clock } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import { EXTRAORDINARY_BADGE, STANDARD_BADGE, RIPOSO_BADGE } from '@/lib/turnColors'
import type { Turn } from '@/types'

const TZ = 'Europe/Rome'

const SPLIT_BADGE = 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700'

interface Props {
  initialTurns: Turn[]
  userId:       string
}

export function MieiTurniClient({ initialTurns, userId }: Props) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns)

  // ── Refetch al mount — la pagina è renderizzata lato server e può
  // arrivare da un layer di cache (Service Worker / Router Cache di Next)
  // con una versione vecchia della lista, in cui manca p.es. il secondo
  // segmento di un turno spezzato. Rileggiamo i turni dal client all'avvio
  // così la lista è sempre autorevole, indipendentemente dalla cache. ──
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('turns')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })
      .then(({ data }) => {
        if (data) setTurns(data as unknown as Turn[])
      })
  }, [userId])

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

  // Raggruppa i turni per giornata: un turno spezzato (più fasce nello
  // stesso giorno) diventa un'unica riga con tutti gli orari insieme.
  const byDate = new Map<string, Turn[]>()
  for (const t of sorted) {
    const list = byDate.get(t.date) ?? []
    list.push(t)
    byDate.set(t.date, list)
  }
  const groups = Array.from(byDate, ([date, dayTurns]) => ({ date, turns: dayTurns }))
  const upcoming = groups.filter(g => g.date >= todayStr)
  const past = groups.filter(g => g.date < todayStr).reverse()

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
              {upcoming.map(g => <TurnRow key={g.date} group={g} />)}
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
              {past.map(g => <TurnRow key={g.date} group={g} />)}
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

function TurnRow({ group }: { group: { date: string; turns: Turn[] } }) {
  const dateLabel = formatInTimeZone(`${group.date}T12:00:00Z`, TZ, 'EEEE d MMMM', { locale: it })

  const isRest = group.turns.some(t => t.is_rest_day)
  const work = group.turns.filter(t => !t.is_rest_day)
  const isExtra = !isRest && work.some(t => t.is_extraordinary)
  const isSplit = work.length > 1
  const dept = work.find(t => t.department)?.department ?? null
  // Tutte le fasce della giornata su un'unica stringa (turno spezzato incluso)
  const ranges = work.map(t => `${t.start_time.slice(0, 5)} – ${t.end_time.slice(0, 5)}`).join('  /  ')
  const notes = Array.from(new Set(group.turns.map(t => t.notes).filter(Boolean))).join(' · ')

  const badgeBase = 'text-[10px] px-1.5 py-0.5 rounded-sm border font-medium whitespace-nowrap'

  return (
    <div className="bg-card border border-border rounded-sm px-3 py-2.5 flex items-center gap-3">
      <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-sm font-medium text-foreground capitalize">{dateLabel}</span>
          {isRest ? (
            <span className={`${badgeBase} ${RIPOSO_BADGE}`}>Riposo</span>
          ) : isExtra ? (
            <span className={`${badgeBase} ${EXTRAORDINARY_BADGE}`}>Straordinario</span>
          ) : (
            <span className={`${badgeBase} ${STANDARD_BADGE}`}>Standard</span>
          )}
          {isSplit && <span className={`${badgeBase} ${SPLIT_BADGE}`}>Spezzato</span>}
        </div>
        {!isRest && (
          <p className="text-xs text-muted-foreground">
            {ranges}
            {dept ? ` · ${dept}` : ''}
          </p>
        )}
        {notes && <p className="text-xs text-muted-foreground/80 mt-0.5">{notes}</p>}
      </div>
    </div>
  )
}
