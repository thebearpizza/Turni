'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { raggruppaPerGiornata, formatOre, type Giornata } from '@/lib/turniGiornata'
import { formatInTimeZone } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import type { Turn } from '@/types'

const TZ = 'Europe/Rome'

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
  const giornate = raggruppaPerGiornata(turns)
  const [passati, setPassati] = useState(false)

  // Raggruppate per settimana (lunedì–domenica), oggi in evidenza.
  const lunediDi = (d: string) => {
    const dt = new Date(`${d}T12:00:00Z`)
    const dow = (dt.getUTCDay() + 6) % 7
    dt.setUTCDate(dt.getUTCDate() - dow)
    return dt.toISOString().slice(0, 10)
  }
  const lunediOggi = lunediDi(todayStr)
  const settimane = new Map<string, Giornata[]>()
  for (const g of giornate) {
    if (passati ? g.date >= todayStr : g.date < lunediOggi) continue
    const k = lunediDi(g.date)
    settimane.set(k, [...(settimane.get(k) ?? []), g])
  }
  const elenco = Array.from(settimane).sort((a, b) => (passati ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])))
  if (passati) elenco.forEach(([, gs]) => gs.reverse())

  function etichettaSettimana(lun: string): string {
    if (lun === lunediOggi) return 'Questa settimana'
    const prossimo = new Date(`${lunediOggi}T12:00:00Z`); prossimo.setUTCDate(prossimo.getUTCDate() + 7)
    if (lun === prossimo.toISOString().slice(0, 10)) return 'Prossima settimana'
    const fine = new Date(`${lun}T12:00:00Z`); fine.setUTCDate(fine.getUTCDate() + 6)
    const f = (d: Date, fmt: string) => formatInTimeZone(d, TZ, fmt, { locale: it })
    return `${f(new Date(`${lun}T12:00:00Z`), 'd')}–${f(fine, 'd MMMM')}`
  }

  let indice = 0
  return (
    <div className="flex flex-col gap-3 px-4 pb-6 pt-2">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-[28px] font-semibold tracking-[-0.8px]">I miei turni</h1>
        <button type="button" onClick={() => setPassati(p => !p)} className="h-9 rounded-full border border-line-strong px-3.5 text-[13px] font-medium active:scale-[0.97]">
          {passati ? 'Prossimi' : 'Passati'}
        </button>
      </div>
      {elenco.length === 0 ? (
        <div className="anim-inrise rounded-md border border-dashed border-line-strong px-4 py-10 text-center text-sm text-muted-foreground">
          {passati ? 'Nessun turno passato' : 'Nessun turno programmato'}
        </div>
      ) : elenco.map(([lun, gs]) => (
        <section key={lun} className="flex flex-col gap-2">
          <div className="flex justify-between px-1 pt-1 font-mono text-[11px] font-medium uppercase tracking-[1px] text-muted-foreground">
            <span>{etichettaSettimana(lun)}</span>
            <span>{formatOre(gs.reduce((s, g) => s + g.minuti, 0))}</span>
          </div>
          {gs.map(g => <RigaTurno key={g.date} g={g} oggi={g.date === todayStr} ritardo={indice++ * 70} />)}
        </section>
      ))}
    </div>
  )
}

function RigaTurno({ g, oggi, ritardo }: { g: Giornata; oggi: boolean; ritardo: number }) {
  const giorno = formatInTimeZone(`${g.date}T12:00:00Z`, TZ, 'EEE', { locale: it })
  const numero = formatInTimeZone(`${g.date}T12:00:00Z`, TZ, 'd')
  const orari = g.riposo ? '—' : g.fasce.join(' / ').replace(/–/g, ' – ')
  const dettaglio = g.riposo
    ? 'Giorno libero'
    : [g.reparto, oggi ? 'oggi' : null, g.spezzato ? 'Spezzato' : null, g.note || null].filter(Boolean).join(' · ')
  const tag = oggi ? 'Oggi' : g.riposo ? 'Riposo' : g.straordinario ? 'Straord.' : 'Standard'
  return (
    <div
      className={cn(
        'anim-inrise grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-[8px] border px-3.5 py-3',
        oggi ? 'border-turni bg-card' : g.riposo ? 'border-border bg-transparent' : 'border-border bg-card'
      )}
      style={{ animationDelay: `${ritardo}ms` }}
    >
      <div className="flex flex-col items-center">
        <span className="font-mono text-[11px] font-medium uppercase text-muted-foreground">{giorno}</span>
        <span className="font-mono text-xl font-semibold">{numero}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('font-mono text-[15px] font-medium', g.riposo && 'text-muted-foreground')}>{orari}</span>
        {dettaglio && <span className="truncate text-xs text-muted-foreground">{dettaglio}</span>}
      </div>
      <span className={cn(
        'rounded-full px-[9px] py-[3px] text-[10px] font-semibold uppercase tracking-[.05em]',
        oggi ? 'bg-[oklch(0.94_0.04_240)] text-[oklch(0.42_0.1_240)] dark:bg-[oklch(0.3_0.05_240)] dark:text-[oklch(0.85_0.08_240)]'
          : g.riposo ? 'text-muted-foreground'
          : g.straordinario ? 'bg-warn-tint text-warn'
          : 'bg-secondary text-muted-foreground'
      )}>{tag}</span>
    </div>
  )
}
